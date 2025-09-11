import type { SmartBuffer } from 'smart-buffer'
import type { Language } from '../../interface'

export enum ExcelVariant {
  Unknown = 0,
  Default = 1,
  Subrows = 2,
}

export enum ExcelColumnType {
  String = 0,
  Int = 1,
  Float = 2,
}

export interface ExcelColumn {
  type: ExcelColumnType
  offset: number
}

export enum ExcelColumnDataType {
  String = 0x0,
  Bool = 0x1,
  Int8 = 0x2,
  UInt8 = 0x3,
  Int16 = 0x4,
  UInt16 = 0x5,
  Int32 = 0x6,
  UInt32 = 0x7,
  // unused?
  Unk = 0x8,
  Float32 = 0x9,
  Int64 = 0xa,
  UInt64 = 0xb,
  // unused?
  Unk2 = 0xc,

  // 0 is read like data & 1, 1 is like data & 2, 2 = data & 4, etc...
  PackedBool0 = 0x19,
  PackedBool1 = 0x1a,
  PackedBool2 = 0x1b,
  PackedBool3 = 0x1c,
  PackedBool4 = 0x1d,
  PackedBool5 = 0x1e,
  PackedBool6 = 0x1f,
  PackedBool7 = 0x20,
}

export interface ExcelDataPagination {
  startId: number
  rowCount: number
}

export interface ExhHeader {
  magic: string
  version: number
  dataOffset: number
  columnCount: number
  pageCount: number
  languageCount: number
  unknown1: number
  u2: number
  variant: ExcelVariant
  u3: number
  rowCount: number
  u4: number
  u5: number

  columns: ExcelColumn[]
  paginations: ExcelDataPagination[]
  languages: Language[]
}

export const readExhHeader = (buffer: SmartBuffer): ExhHeader => {
  const magic = buffer.readString(4)
  const version = buffer.readUInt16BE()
  const dataOffset = buffer.readUInt16BE()
  const columnCount = buffer.readUInt16BE()
  const pageCount = buffer.readUInt16BE()
  const languageCount = buffer.readUInt16BE()
  const unknown1 = buffer.readUInt16BE()
  const u2 = buffer.readUInt8()
  const variant = buffer.readUInt8() as ExcelVariant
  const u3 = buffer.readUInt16BE()
  const rowCount = buffer.readUInt32BE()
  const u4 = buffer.readUInt32BE()
  const u5 = buffer.readUInt32BE()

  const columns: ExcelColumn[] = []
  for (let i = 0; i < columnCount; i++) {
    const type = buffer.readUInt16BE() as ExcelColumnType
    const offset = buffer.readUInt16BE()
    columns.push({ type, offset })
  }

  const paginations: ExcelDataPagination[] = []
  for (let i = 0; i < pageCount; i++) {
    const startId = buffer.readUInt32BE()
    const rowCount = buffer.readUInt32BE()
    paginations.push({ startId, rowCount })
  }

  const languages: Language[] = []
  for (let i = 0; i < languageCount; i++) {
    const language = buffer.readUInt8()
    languages.push(language)
  }

  return {
    magic,
    version,
    dataOffset,
    columnCount,
    pageCount,
    languageCount,
    unknown1,
    u2,
    variant,
    u3,
    rowCount,
    u4,
    u5,
    columns,
    paginations,
    languages,
  }
}
