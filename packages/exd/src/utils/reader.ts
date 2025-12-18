import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  getExdPath,
  readExhHeader,
  readExlFile,
  type SqPackReader,
} from '@ffcafe/ixion-sqpack'
import $debug from 'debug'
import { rootExlFile } from '../const'

const debug = $debug('ixion:exd:utils')

export async function listExdSheetsFromReader(reader: SqPackReader) {
  const root = await reader.readFile(rootExlFile)
  if (!root) {
    throw new Error(`Failed to read ${rootExlFile}`)
  }

  const rootData = readExlFile(root)
  return rootData.entries.map((entry) => entry.name)
}

export async function readExhHeaderFromReader(
  reader: SqPackReader,
  sheet: string,
) {
  const exhFile = `exd/${sheet}.exh`
  const exhData = await reader.readFile(exhFile)
  if (!exhData) {
    throw new Error(`Failed to read ${exhFile}`)
  }
  return readExhHeader(exhData)
}

export async function readExdFileListFromReader(
  reader: SqPackReader,
  filter?: (sheet: string) => boolean,
) {
  const sheets = await listExdSheetsFromReader(reader)
  const exdFiles: string[] = [rootExlFile]
  for (const sheet of sheets) {
    if (filter && !filter(sheet)) {
      continue
    }

    const exhFile = `exd/${sheet}.exh`
    exdFiles.push(exhFile)

    const exh = await reader.readFile(exhFile)
    if (!exh) {
      throw new Error(`Failed to read ${exhFile}`)
    }

    const exhData = readExhHeader(exh)
    debug('%d languages: %j', exhData.languageCount, exhData.languages)
    for (const language of exhData.languages) {
      for (const pagination of exhData.paginations) {
        const path = getExdPath(sheet, pagination.startId, language)
        const valid = await reader.hasFile(path)
        if (!valid) {
          debug('%s not found', path)
          continue
        }
        exdFiles.push(path)
      }
    }
  }
  return exdFiles
}

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
