import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { SqPackReader } from '@ffcafe/ixion-sqpack'
import { readExdFileListFromReader } from './list'

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
