import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createExdFilter } from '@ffcafe/ixion-exd'
import { compressDirectoryToFile } from '@ffcafe/ixion-utils'
import { kebabCase } from '../../../utils/case'
import { calculateHashForArchive } from '../../../utils/hash'
import { getTempDir, getWorkingDir } from '../../../utils/root'
import { getStorageManager } from '../../../utils/storage'
import { buildExdFiles, type ServerVersion } from '../../exd-build'
import {
  mergedVersionReference,
  mergedVersionServer,
  serversToCheck,
} from '../constants'
import { createGitHubRelease, isGitHubActions } from '../github'
import type { Archive } from '../interface'
import { readReleasedVersions } from '../version'

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

export async function createRelease(
  currentVersions: Record<string, string>,
): Promise<void> {
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
}
