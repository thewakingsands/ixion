import { rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { SqPackReader } from '@ffcafe/ixion-sqpack'
import { exdSqPackFile } from '../config'
import { getTempDir } from '../utils/root'
import { getStorageManager } from '../utils/storage'
import { readExdFileListFromReader } from './exd-list'

export async function extractExdFilesFromReader(
  reader: SqPackReader,
  outputDir: string,
  filter?: (path: string) => boolean,
) {
  console.log(`📦 Extracting EXD files to '${outputDir}'...`)
  const exdFiles = await readExdFileListFromReader(reader, filter)

  for (const filePath of exdFiles) {
    const fileData = await reader.readFile(filePath)
    if (!fileData) {
      console.log(`  ❌ Failed to read ${filePath}`)
      continue
    }

    const outputPath = join(outputDir, filePath)
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, fileData)
    console.log(`  ✅ ${filePath}`)
  }

  console.log(`📊 Extraction complete`)
}

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
