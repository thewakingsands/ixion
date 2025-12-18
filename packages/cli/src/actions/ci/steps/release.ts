import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import { createExdFilter } from '@ffcafe/ixion-exd'
import { compressDirectoryToFile } from '@ffcafe/ixion-utils'
import { exdSqPackFile, files } from '../../../config'
import { kebabCase } from '../../../utils/case'
import { calculateHashForArchive } from '../../../utils/hash'
import { parseInputDefinitions } from '../../../utils/input'
import { getTempDir, getWorkingDir } from '../../../utils/root'
import { getStorageManager } from '../../../utils/storage'
import type { ServerVersion } from '../../exd-base'
import { buildExdFiles } from '../../exd-build'
import { exportExdStrings } from '../../exd-strings-export'
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
async function createServerArchive({
  server,
  version,
  outputPath,
  sqpackPath,
}: {
  server: string
  version: string
  outputPath: string
  sqpackPath: string
}) {
  const storageManager = getStorageManager()
  const tempDir = await getTempDir()
  console.log(`📂 Created temporary directory: ${tempDir}`)

  try {
    await storageManager.downloadVersion(server, version, tempDir)

    // write ffxivgame.ver to temp dir
    const verPath = join(tempDir, 'ffxivgame.ver')
    writeFileSync(verPath, version, 'utf-8')

    // copy sqpack to sqpack dir
    const sqpackDir = join(sqpackPath, server)
    mkdirSync(sqpackDir, { recursive: true })
    for (const file of files) {
      copyFileSync(join(tempDir, file), join(sqpackDir, basename(file)))
    }

    await compressDirectoryToFile(tempDir, outputPath)
    return calculateHashForArchive(tempDir)
  } finally {
    // Clean up temporary directory
    console.log(`🧹 Cleaning up temporary directory: ${tempDir}\n`)
    rmSync(tempDir, { recursive: true, force: true })
  }
}

/**
 * Create merged archive from EXD files of different servers
 */
async function createMergedArchive({
  version,
  serverVersions,
  outputPath,
}: {
  version: string
  serverVersions: ServerVersion[]
  outputPath: string
}) {
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
    console.log(`🧹 Cleaning up temporary directory: ${tempDir}\n`)
    rmSync(tempDir, { recursive: true, force: true })
  }
}

async function createStringsArchive({
  serverVersions,
  outputPath,
}: {
  serverVersions: ServerVersion[]
  outputPath: string
}): Promise<string> {
  const tempDir = await getTempDir()
  console.log(`📂 Created temporary directory: ${tempDir}`)

  try {
    await exportExdStrings({
      serverVersions,
      outputDir: join(tempDir, 'sqpack/ffxiv'),
      definitions: parseInputDefinitions(),
    })

    await compressDirectoryToFile(tempDir, outputPath)
    return outputPath
  } finally {
    // Clean up temporary directory
    console.log(`🧹 Cleaning up temporary directory: ${tempDir}\n`)
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
  const sqpackPath = join(cwd, '.ci/sqpack')
  const serverArchives: Archive[] = []

  // Create archives for each server
  for (const item of serverVersions) {
    const { server, version } = item
    console.log(`📂 Creating archive for ${server}: ${version}`)
    const path = join(archiveDir, `${kebabCase(server)}-${version}.zip`)
    const hash = await createServerArchive({
      server,
      version,
      outputPath: path,
      sqpackPath,
    })

    serverArchives.push({
      server,
      version,
      sqpackPrefix: join(sqpackPath, server, basename(exdSqPackFile)),
      path,
      hash,
    })
  }

  // Create merged archive
  console.log(`📂 Creating merged archive for ${mergedVersionServer}`)
  const mergedVersion = currentVersions[mergedVersionReference] || ''
  const mergedPath = join(
    archiveDir,
    `${kebabCase(mergedVersionServer)}-${mergedVersion}.zip`,
  )
  const mergedHash = await createMergedArchive({
    version: mergedVersion,
    serverVersions: serverArchives,
    outputPath: mergedPath,
  })
  const archives = [
    ...serverArchives,
    {
      server: mergedVersionServer,
      version: mergedVersion,
      path: mergedPath,
      hash: mergedHash,
    },
  ]

  // export strings
  const extraAssets: string[] = [
    await createStringsArchive({
      serverVersions: serverArchives,
      outputPath: join(archiveDir, 'strings.zip'),
    }),
  ]

  // Create GitHub release or print file names
  if (isGitHubActions()) {
    console.log('\n🚀 Creating GitHub release...')
    await createGitHubRelease(currentVersions, archives, extraAssets)
  } else {
    console.log('\n📁 Archive files created:')
    for (const { path } of archives) {
      console.log(`  - ${path}`)
    }
  }
}
