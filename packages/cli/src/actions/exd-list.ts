import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { readExdFileListFromReader } from '@ffcafe/ixion-exd'
import { SqPackReader } from '@ffcafe/ixion-sqpack'
import { exdSqPackFile } from '../config'
import { getTempDir } from '../utils/root'
import { getStorageManager } from '../utils/storage'

export async function readExdFileList(
  server: string,
  version: string,
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

    console.log(`🔍 Checking for EXD files in version '${version}'...`)

    const ret = await readExdFileListFromReader(reader, filter)
    await reader.close()

    return ret
  } finally {
    // Clean up temporary directory
    rmSync(tempDir, { recursive: true, force: true })
  }
}
