import {
  getExdPath,
  readExhHeader,
  type SqPackReader,
} from '@ffcafe/ixion-sqpack'
import $debug from 'debug'
import { rootExlFile } from './const'
import { listExdSheetsFromReader } from './utils'

const debug = $debug('ixion:exd:list')

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
