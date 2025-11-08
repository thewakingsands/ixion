import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import { compressDirectoryToFile } from '@ffcafe/ixion-utils'
import { createActionAuth } from '@octokit/auth-action'
import { Octokit } from '@octokit/rest'
import { configExists } from '../utils/config'
import { getTempDir, getWorkingDir } from '../utils/root'
import { getStorageManager } from '../utils/storage'
import { buildExdFiles, createExdFilter, type ServerVersion } from './exd-build'
import { type UpdateOptions, updateCommand } from './update'

const serversToCheck = ['sdo', 'squareEnix'] as const
const mergedVersionServer = 'sdo'
const mergedVersionName = 'merged'

const configTemplatePath = '.ixion-config.ci.json'
const configPath = '.ixion-config.json'
const ciVersionsPath = '.ci/versions.json'

/**
 * Create config file from template with secrets
 */
function createConfigFromTemplate(): void {
  if (configExists(configPath)) {
    console.log('📝 Config file already exists, skipping creation')
    return
  }

  if (!existsSync(configTemplatePath)) {
    throw new Error(`Template file not found: ${configTemplatePath}`)
  }

  const template = readFileSync(configTemplatePath, 'utf-8')
  const config = template.replace(/\{\{(.*)\}\}/g, (_, p1) => {
    const value = process.env[p1]
    if (!value) {
      throw new Error(`Environment variable ${p1} not found`)
    }
    return value
  })

  writeFileSync(configPath, config, 'utf-8')
  console.log('✅ Created config file from template')
}

/**
 * Read released versions from .ci/versions.json
 */
function readReleasedVersions(): Record<string, string> {
  if (!existsSync(ciVersionsPath)) {
    return {}
  }

  try {
    const content = readFileSync(ciVersionsPath, 'utf-8')
    return JSON.parse(content) as Record<string, string>
  } catch (error) {
    console.warn(`⚠️ Failed to read ${ciVersionsPath}:`, error)
    return {}
  }
}

/**
 * Create zip archive from version files
 */
async function createServerArchive(
  server: string,
  version: string,
  outputPath: string,
): Promise<void> {
  const storageManager = getStorageManager()
  const tempDir = await getTempDir()
  console.log(`📂 Created temporary directory: ${tempDir}`)

  try {
    await storageManager.downloadVersion(server, version, tempDir)

    // write ffxivgame.ver to temp dir
    const verPath = join(tempDir, 'ffxivgame.ver')
    if (existsSync(verPath)) {
      writeFileSync(verPath, version, 'utf-8')
    }

    await compressDirectoryToFile(tempDir, outputPath)
  } finally {
    // Clean up temporary directory
    console.log(`\n🧹 Cleaning up temporary directory: ${tempDir}`)
    rmSync(tempDir, { recursive: true, force: true })
  }
}

async function createMergedArchive(
  version: string,
  serverVersions: ServerVersion[],
  outputPath: string,
): Promise<void> {
  const tempDir = await getTempDir()
  console.log(`📂 Created temporary directory: ${tempDir}`)

  try {
    const { filter } = createExdFilter(undefined, true)

    await buildExdFiles({
      serverVersions,
      outputPrefix: tempDir,
      filter,
    })

    // write ffxivgame.ver to temp dir
    const verPath = join(tempDir, 'ffxivgame.ver')
    if (existsSync(verPath)) {
      writeFileSync(verPath, version, 'utf-8')
    }

    await compressDirectoryToFile(tempDir, outputPath)
  } finally {
    // Clean up temporary directory
    console.log(`\n🧹 Cleaning up temporary directory: ${tempDir}`)
    rmSync(tempDir, { recursive: true, force: true })
  }
}

/**
 * Check if running in GitHub Actions
 */
function isGitHubActions(): boolean {
  return process.env.GITHUB_ACTIONS === 'true'
}

interface Archive extends ServerVersion {
  path: string
}

/**
 * Create GitHub release
 */
async function createGitHubRelease(
  title: string,
  archives: Archive[],
): Promise<void> {
  const octokit = new Octokit({
    authStrategy: createActionAuth,
  })

  const [owner, repo] = (process.env.GITHUB_REPOSITORY || '').split('/')
  if (!owner || !repo) {
    throw new Error('GITHUB_REPOSITORY environment variable is required')
  }

  // Create release
  const release = await octokit.repos.createRelease({
    owner,
    repo,
    tag_name: title,
    name: title,
    body: [
      '| Server | Version |',
      '| ------ | ------- |',
      ...archives.map(({ server, version }) => `| ${server} | ${version} |`),
    ].join('\n'),
    draft: false,
    prerelease: false,
  })

  console.log(`✅ Created GitHub release: ${title}`)

  // Upload assets
  for (const { path } of archives) {
    const archiveName = basename(path)
    const fileData = readFileSync(path)
    await octokit.repos.uploadReleaseAsset({
      owner,
      repo,
      release_id: release.data.id,
      name: archiveName,
      data: fileData as unknown as string,
    })

    console.log(`✅ Uploaded ${archiveName} to release`)
  }
}

export const ciCommand = async () => {
  try {
    console.log('🔍 Running CI actions...')

    // Step 1: Create config from template if needed
    createConfigFromTemplate()

    const storageManager = getStorageManager()
    const currentVersions: Record<string, string> = {}

    // Step 2: Print and record current remote versions
    console.log('\n📡 Checking remote versions...')
    for (const serverName of serversToCheck) {
      const remoteVersion = await storageManager.getLatestVersion(serverName)
      if (remoteVersion) {
        console.log(`  ${serverName}: ${remoteVersion}`)
        currentVersions[serverName] = remoteVersion
      } else {
        console.log(`  ${serverName}: No remote version found`)
      }
    }

    // Step 3: Run update for both servers
    console.log('\n🔄 Running updates...')
    for (const serverName of serversToCheck) {
      const updateResult = await updateCommand({
        server: serverName,
      } as UpdateOptions)

      currentVersions[serverName] = updateResult.afterVersion
    }

    // Step 4: Check if versions changed and create releases
    const releasedVersions = readReleasedVersions()
    let updated = false
    for (const serverName of serversToCheck) {
      const currentVersion = currentVersions[serverName]
      const releasedVersion = releasedVersions[serverName]
      if (currentVersion && currentVersion !== releasedVersion) {
        console.log(
          `📦 ${serverName} version changed: ${releasedVersion || 'none'} -> ${currentVersion}`,
        )
        updated = true
      }
    }

    if (!updated) {
      console.log('\n✅ All versions are up to date, no release needed')
      return
    }

    // Create archives
    console.log('\n📦 Creating archives...')
    const cwd = getWorkingDir()
    const archiveDir = join(cwd, '.ci/archives')
    if (!existsSync(archiveDir)) {
      mkdirSync(archiveDir, { recursive: true })
    }

    const serverVersions = serversToCheck.map((serverName) => ({
      server: serverName,
      version: currentVersions[serverName] || '',
    }))
    const mergedVersion = {
      server: mergedVersionServer,
      version: currentVersions[mergedVersionServer] || '',
    }
    const archives: Archive[] = [...serverVersions, mergedVersion].map(
      (archive) => ({
        ...archive,
        path: join(archiveDir, `${archive.server}-${archive.version}.zip`),
      }),
    )

    // Create archives for each server
    for (const { server, version, path } of archives) {
      if (server === mergedVersionServer) {
        console.log(`📂 Creating merged archive for ${mergedVersion}`)
        await createMergedArchive(version, serverVersions, path)
      } else {
        console.log(`📂 Creating archive for ${server}: ${version}`)
        await createServerArchive(server, version, path)
      }
    }

    // Create GitHub release or print file names
    if (isGitHubActions()) {
      console.log('\n🚀 Creating GitHub release...')
      const today = new Date().toISOString().replace(/[-:]/g, '').split('T')[0]
      await createGitHubRelease(today, archives)
    } else {
      console.log('\n📁 Archive files created:')
      for (const { path } of archives) {
        console.log(`  - ${path}`)
      }
    }

    console.log('\n✅ CI actions completed successfully')
  } catch (error) {
    console.error('❌ CI actions failed:', error)
    process.exit(1)
  }
}
