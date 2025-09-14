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
  [Language.ChineseTraditional2]: '_cht',
}

export function getExdPath(sheet: string, startId: number, language: Language) {
  const suffix = languageSuffix[language]
  if (typeof suffix !== 'string') {
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

/**
 * Write Excel data header structure
 */
export const writeExcelDataHeader = (
  buffer: SmartBuffer,
  header: ExcelDataHeader,
): void => {
  buffer.writeString(header.magic)
  buffer.writeUInt16BE(header.version)
  buffer.writeUInt16BE(header.u1)
  buffer.writeUInt32BE(header.indexSize)
  buffer.writeUInt32BE(header.dataSize)

  // Write 16 bytes of padding
  buffer.writeUInt32BE(0)
  buffer.writeUInt32BE(0)
  buffer.writeUInt32BE(0)
  buffer.writeUInt32BE(0)

  // Write offset map
  for (const [rowId, offset] of header.offsetMap) {
    buffer.writeUInt32BE(rowId)
    buffer.writeUInt32BE(offset)
  }
}
