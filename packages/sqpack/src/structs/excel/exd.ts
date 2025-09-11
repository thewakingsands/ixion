import type { SmartBuffer } from 'smart-buffer'
import { Language } from '../../interface'

const languageSuffix: Partial<Record<Language, string>> = {
  [Language.None]: '',
  [Language.Japanese]: '_ja',
  [Language.English]: '_en',
  [Language.German]: '_de',
  [Language.French]: '_fr',
  [Language.ChineseSimplified]: '_chs',
  [Language.ChineseTraditional]: '_cht',
  [Language.Korean]: '_kr',
}

export function getExdPath(sheet: string, startId: number, language: Language) {
  const suffix = languageSuffix[language]
  if (!suffix) {
    throw new Error(`Invalid language: ${language}`)
  }

  return `exd/${sheet}_${startId}${suffix}.exd`
}

export interface ExcelDataHeader {
  magic: string
  version: number
  u1: number
  indexSize: number
  dataSize: number
  offsetMap: Map<number, number>
}

export interface ExcelDataOffset {
  rowId: number
  offset: number
}

export const readExcelDataHeader = (buffer: SmartBuffer): ExcelDataHeader => {
  const magic = buffer.readString(4)
  const version = buffer.readUInt16BE()
  const u1 = buffer.readUInt16BE()
  const indexSize = buffer.readUInt32BE()
  const dataSize = buffer.readUInt32BE()

  buffer.readOffset += 16

  const count = indexSize / 8
  const offsetMap = new Map<number, number>()
  for (let i = 0; i < count; i++) {
    const rowId = buffer.readUInt32BE()
    const offset = buffer.readUInt32BE()
    offsetMap.set(rowId, offset)
  }

  return { magic, version, u1, indexSize, dataSize, offsetMap }
}
