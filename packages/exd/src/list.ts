import {
  getExdPath,
  readExhHeader,
  readExlFile,
  type SqPackReader,
} from '@ffcafe/ixion-sqpack'
import $debug from 'debug'
import { rootExlFile } from './const'

const debug = $debug('ixion:exd:list')

export async function readExdFileListFromReader(
  reader: SqPackReader,
  filter?: (sheet: string) => boolean,
) {
  const root = await reader.readFile(rootExlFile)
  if (!root) {
    throw new Error(`Failed to read ${rootExlFile}`)
  }

  const rootData = readExlFile(root)
  const exdFiles: string[] = [rootExlFile]
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
    debug('%d languages: %j', exhData.languageCount, exhData.languages)
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
