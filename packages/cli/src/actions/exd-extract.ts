import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { extractExdFilesFromReader } from '@ffcafe/ixion-exd'
import { SqPackReader } from '@ffcafe/ixion-sqpack'
import { exdSqPackFile } from '../config'
import { getTempDir } from '../utils/root'
import { getStorageManager } from '../utils/storage'

export async function extractExdFiles(
  server: string,
  version: string,
  outputDir: string,
  filter?: (path: string) => boolean,
) {
  const storageManager = getStorageManager()
  // Download version to temporary directory
  const tempDir = await getTempDir()
  try {
    await storageManager.downloadVersion(server, version, tempDir)

    // Find the SqPack files in the downloaded version
    const sqPackPrefix = join(tempDir, exdSqPackFile)
    const reader = await SqPackReader.open({ prefix: sqPackPrefix })

    console.log(`🔍 Extracting EXD files in version '${version}'...`)

    await extractExdFilesFromReader(reader, outputDir, filter)
    await reader.close()
  } finally {
    // Clean up temporary directory
    rmSync(tempDir, { recursive: true, force: true })
  }
}
