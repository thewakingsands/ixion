import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import { createExdFilter } from '@ffcafe/ixion-exd'
import { compressDirectoryToFile } from '@ffcafe/ixion-utils'
import { createActionAuth } from '@octokit/auth-action'
import { Octokit } from '@octokit/rest'
import { $ } from 'execa'
import { configExists } from '../utils/config'
import { getTempDir, getWorkingDir } from '../utils/root'
import { getStorageManager } from '../utils/storage'
import { buildExdFiles, type ServerVersion } from './exd-build'
import { type UpdateOptions, updateCommand } from './update'

const serversToCheck = ['sdo', 'squareEnix', 'actoz'] as const
const mergedVersionReference = 'sdo'
const mergedVersionServer = 'merged'

const configTemplatePath = '.ixion-config.ci.json'
const configPath = '.ixion-config.json'
const ciVersionsPath = '.ci/versions.json'
const ciVersionMessage = 'ci: update released versions'

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
  const config = template.replace(/\{\{\s*(.*?)\s*\}\}/g, (_, p1) => {
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

function calculateHashForFile(
  path: string,
  type: 'sha1' | 'sha256' = 'sha1',
): string | undefined {
  try {
    const hash = createHash(type)
    hash.update(readFileSync(path))
    return hash.digest('hex').slice(0, 8)
  } catch (e) {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') {
      return undefined
    }

    console.warn(`⚠️ Failed to calculate hash for ${path}:`, e)
    return undefined
  }
}

function calculateHashForArchive(
  path: string,
): Record<string, string | undefined> {
  return {
    exe: calculateHashForFile(join(path, 'ffxiv_dx11.exe')),
    excel: calculateHashForFile(join(path, 'sqpack/ffxiv/0a0000.win32.dat0')),
  }
}

/**
 * Create zip archive from version files
 */
async function createServerArchive(
  server: string,
  version: string,
  outputPath: string,
) {
  const storageManager = getStorageManager()
  const tempDir = await getTempDir()
  console.log(`📂 Created temporary directory: ${tempDir}`)

  try {
    await storageManager.downloadVersion(server, version, tempDir)

    // write ffxivgame.ver to temp dir
    const verPath = join(tempDir, 'ffxivgame.ver')
    writeFileSync(verPath, version, 'utf-8')

    await compressDirectoryToFile(tempDir, outputPath)
    return calculateHashForArchive(tempDir)
  } finally {
    // Clean up temporary directory
    console.log(`\n🧹 Cleaning up temporary directory: ${tempDir}`)
    rmSync(tempDir, { recursive: true, force: true })
  }
}

/**
 * Create merged archive from EXD files of different servers
 */
async function createMergedArchive(
  version: string,
  serverVersions: ServerVersion[],
  outputPath: string,
) {
  const tempDir = await getTempDir()
  console.log(`📂 Created temporary directory: ${tempDir}`)

  try {
    const { filter } = createExdFilter(undefined, true)
    const outputDir = join(tempDir, 'sqpack/ffxiv')
    mkdirSync(outputDir, { recursive: true })

    await buildExdFiles({
      serverVersions,
      outputPrefix: join(outputDir, '0a0000.win32'),
      filter,
    })

    // write ffxivgame.ver to temp dir
    const verPath = join(tempDir, 'ffxivgame.ver')
    writeFileSync(verPath, version, 'utf-8')

    await compressDirectoryToFile(tempDir, outputPath)
    return calculateHashForArchive(tempDir)
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
  hash?: Record<string, string | undefined>
}

async function configGit(): Promise<void> {
  const name = process.env.GITHUB_ACTOR ?? ''
  const email = `${name}@users.noreply.github.com`

  await $`git config user.name ${name}`
  await $`git config user.email ${email}`
}

/**
 * Create GitHub release
 */
async function createGitHubRelease(
  versions: Record<string, string>,
  archives: Archive[],
): Promise<void> {
  const octokit = new Octokit({
    authStrategy: createActionAuth,
  })

  const [owner, repo] = (process.env.GITHUB_REPOSITORY || '').split('/')
  if (!owner || !repo) {
    throw new Error('GITHUB_REPOSITORY environment variable is required')
  }

  // Write versions to file and commit
  writeFileSync(ciVersionsPath, JSON.stringify(versions, null, 2), 'utf-8')

  await configGit()
  await $`git add ${ciVersionsPath}`
  await $`git commit -m ${ciVersionMessage}`
  await $`git push`

  const hash = await $`git rev-parse HEAD`
  const date = new Date().toISOString().replace(/[-:]/g, '').split('T')[0]
  const name = `${date}-${hash.stdout.trim().slice(0, 7)}`

  // calc sha256sum of merged archive
  const mergedArchive = archives.find(
    ({ server }) => server === mergedVersionServer,
  )
  const sha256sum = mergedArchive
    ? calculateHashForFile(mergedArchive.path, 'sha256') || ''
    : ''

  // Create release
  const release = await octokit.repos.createRelease({
    owner,
    repo,
    tag_name: `publish/${name}`,
    name,
    body: [
      '| Server | Version | exeHash | 0aHash |',
      '| ------ | ------- | ------- | ------ |',
      ...archives.map(
        ({ server, version, hash }) =>
          `| ${kebabCase(server)} | ${version} | ${hash?.exe || '-'} | ${hash?.excel || '-'} |`,
      ),
      `\nsha256sum of merged archive:\n\`\`\`\n${sha256sum}\n\`\`\``,
    ].join('\n'),
    draft: false,
    prerelease: false,
  })

  console.log(`✅ Created GitHub release: ${name}`)

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
      version: currentVersions[mergedVersionReference] || '',
    }
    const archives: Archive[] = [...serverVersions, mergedVersion].map(
      (archive) => ({
        ...archive,
        path: join(
          archiveDir,
          `${kebabCase(archive.server)}-${archive.version}.zip`,
        ),
      }),
    )

    // Create archives for each server
    for (const item of archives) {
      const { server, version, path } = item
      if (server === mergedVersionServer) {
        console.log(`📂 Creating merged archive for ${mergedVersionServer}`)
        item.hash = await createMergedArchive(version, serverVersions, path)
      } else {
        console.log(`📂 Creating archive for ${server}: ${version}`)
        item.hash = await createServerArchive(server, version, path)
      }
    }

    // Create GitHub release or print file names
    if (isGitHubActions()) {
      console.log('\n🚀 Creating GitHub release...')
      await createGitHubRelease(currentVersions, archives)
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

function kebabCase(input: string) {
  return input
    .replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
    .replace(/^[-_]+/, '')
    .replace(/[-_]+$/, '')
    .replace(/[-_]+/g, '-')
}
