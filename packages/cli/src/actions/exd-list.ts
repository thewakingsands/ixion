import { rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  getExdPath,
  readExhHeader,
  readExlFile,
  SqPackReader,
} from '@ffcafe/ixion-sqpack'
import $debug from 'debug'
import { exdSqPackFile } from '../config'
import { getTempDir } from '../utils/root'
import { getStorageManager } from '../utils/storage'

const debug = $debug('ixion:exd-list')

const rootFile = 'exd/root.exl'

export async function readExdFileListFromReader(
  reader: SqPackReader,
  filter?: (path: string) => boolean,
) {
  const root = await reader.readFile(rootFile)
  if (!root) {
    throw new Error('Failed to read root.exl')
  }

  const rootData = readExlFile(root)
  const exdFiles: string[] = [rootFile]
  for (const entry of rootData.entries) {
    if (filter && !filter(entry.name)) {
      continue
    }

    const exhFile = `exd/${entry.name}.exh`
    exdFiles.push(exhFile)

    const exh = await reader.readFile(exhFile)
    if (!exh) {
      throw new Error(`Failed to read ${exhFile}`)
    }

    const exhData = readExhHeader(exh)
    for (const language of exhData.languages) {
      for (const pagination of exhData.paginations) {
        const path = getExdPath(entry.name, pagination.startId, language)
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
