import { rmSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CSVExporter,
  type DefinitionProvider,
  ExdCSVFormat,
} from '@ffcafe/ixion-exd'
import { SqPackReader } from '@ffcafe/ixion-sqpack'
import type { Language } from '@ffcafe/ixion-utils'
import { exdSqPackFile } from '../config'
import { getTempDir } from '../utils/root'
import { getStorageManager } from '../utils/storage'
import { isGitHubActions, writeGithubOutput } from './ci/github'
import { ExdBase, type ServerVersion } from './exd-base'

export async function exportExdFilesToCSV({
  server,
  version,
  outputDir,
  languages,
  format,
  definitions,
  crlf,
  filter,
}: {
  server: string
  version?: string
  outputDir: string
  languages: Language[]
  format: ExdCSVFormat
  definitions: DefinitionProvider
  crlf: boolean
  filter?: (path: string) => boolean
}) {
  const storageManager = getStorageManager()
  let localVersion = version || null
  if (!localVersion) {
    localVersion = await storageManager.getLatestVersion(server)
    if (!localVersion) {
      throw new Error(`❌ No versions found for server ${server}`)
    }
  }

  if (isGitHubActions()) {
    writeGithubOutput('version', localVersion)
  }

  // Download version to temporary directory
  const tempDir = await getTempDir()
  try {
    const csvExporter = new CSVExporter({
      definitions,
      crlf,
    })
    await storageManager.downloadVersion(server, localVersion, tempDir)

    // Find the SqPack files in the downloaded version
    const sqPackPrefix = join(tempDir, exdSqPackFile)
    const reader = await SqPackReader.open({ prefix: sqPackPrefix })

    // Ensure output directory exists
    await mkdir(outputDir, { recursive: true })
    await csvExporter.export([{ reader, languages }], format, outputDir, filter)
    await reader.close()

    console.log(`✅ CSV export completed`)
  } finally {
    // Clean up temporary directory
    rmSync(tempDir, { recursive: true, force: true })
  }
}

export async function exportAllRawExd({
  definitions,
  crlf,
  serverVersions,
  outputDir,
  filter,
}: {
  definitions: DefinitionProvider
  crlf: boolean
  serverVersions: ServerVersion[]
  outputDir: string
  filter?: (path: string) => boolean
}) {
  const exdBase = new ExdBase(serverVersions)
  try {
    const csvExporter = new CSVExporter({
      definitions,
      crlf,
    })

    console.log(`🔍 Downloading EXD files...`)
    await exdBase.prepareReaders()

    // Ensure output directory exists
    await mkdir(outputDir, { recursive: true })

    console.log(`🔍 Exporting allrawexd...`)
    await csvExporter.export(
      exdBase.readers,
      ExdCSVFormat.Multiple,
      outputDir,
      filter,
    )

    console.log(`✅ allrawexd export completed`)
  } finally {
    await exdBase.close()
  }
}
