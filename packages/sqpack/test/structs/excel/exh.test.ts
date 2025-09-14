import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SmartBuffer } from 'smart-buffer'
import { describe, expect, it } from 'vitest'
import { Language } from '../../../src/interface'
import {
  type ExcelColumn,
  ExcelColumnType,
  ExcelVariant,
  type ExhHeader,
  readExhHeader,
  writeExhHeader,
} from '../../../src/structs/excel/exh'

describe('Excel EXH Header Structs', () => {
  const fixtureBuffer = readFileSync(
    join(__dirname, '../../__fixtures__/AchievementCategory.exh'),
  )

  const parsed = {
    columnCount: 5,
    columns: [
      { offset: 0, type: 0 },
      { offset: 4, type: 3 },
      { offset: 6, type: 25 },
      { offset: 6, type: 26 },
      { offset: 5, type: 3 },
    ],
    dataOffset: 8,
    languageCount: 1,
    languages: [5],
    magic: 'EXHF',
    pageCount: 1,
    paginations: [{ rowCount: 83, startId: 0 }],
    rowCount: 83,
    u2: 0,
    u3: 0,
    u4: 0,
    u5: 0,
    unknown1: 0,
    variant: 1,
    version: 3,
  }

  describe('ExhHeader', () => {
    it('should read EXH header correctly', () => {
      expect(readExhHeader(SmartBuffer.fromBuffer(fixtureBuffer))).toEqual(
        parsed,
      )
    })

    it('should write EXH header correctly', () => {
      const buffer = new SmartBuffer()
      writeExhHeader(buffer, parsed)

      expect(buffer.toBuffer()).toEqual(fixtureBuffer)
    })

    it('should round-trip read and write correctly', () => {
      const originalHeader: ExhHeader = {
        magic: 'EXHF',
        version: 3,
        dataOffset: 0x200,
        columnCount: 4,
        pageCount: 3,
        languageCount: 2,
        unknown1: 0x5678,
        u2: 0x9a,
        variant: ExcelVariant.Unknown,
        u3: 0xbcde,
        rowCount: 2000,
        u4: 0x11223344,
        u5: 0x55667788,
        columns: [
          { type: ExcelColumnType.String, offset: 0 },
          { type: ExcelColumnType.Int, offset: 8 },
          { type: ExcelColumnType.Float, offset: 12 },
          { type: ExcelColumnType.String, offset: 16 },
        ],
        paginations: [
          { startId: 0, rowCount: 500 },
          { startId: 500, rowCount: 750 },
          { startId: 1250, rowCount: 750 },
        ],
        languages: [Language.Japanese, Language.English],
      }

      // Write header
      const writeBuffer = new SmartBuffer()
      writeExhHeader(writeBuffer, originalHeader)
      const writtenData = writeBuffer.toBuffer()

      // Read header back
      const readBuffer = SmartBuffer.fromBuffer(writtenData)
      const readHeader = readExhHeader(readBuffer)

      expect(readHeader.magic).toBe(originalHeader.magic)
      expect(readHeader.version).toBe(originalHeader.version)
      expect(readHeader.dataOffset).toBe(originalHeader.dataOffset)
      expect(readHeader.columnCount).toBe(originalHeader.columnCount)
      expect(readHeader.pageCount).toBe(originalHeader.pageCount)
      expect(readHeader.languageCount).toBe(originalHeader.languageCount)
      expect(readHeader.unknown1).toBe(originalHeader.unknown1)
      expect(readHeader.u2).toBe(originalHeader.u2)
      expect(readHeader.variant).toBe(originalHeader.variant)
      expect(readHeader.u3).toBe(originalHeader.u3)
      expect(readHeader.rowCount).toBe(originalHeader.rowCount)
      expect(readHeader.u4).toBe(originalHeader.u4)
      expect(readHeader.u5).toBe(originalHeader.u5)

      expect(readHeader.columns).toEqual(originalHeader.columns)
      expect(readHeader.paginations).toEqual(originalHeader.paginations)
      expect(readHeader.languages).toEqual(originalHeader.languages)
    })

    it('should handle empty columns, paginations, and languages', () => {
      const header: ExhHeader = {
        magic: 'EXHF',
        version: 1,
        dataOffset: 0x50,
        columnCount: 0,
        pageCount: 0,
        languageCount: 0,
        unknown1: 0,
        u2: 0,
        variant: ExcelVariant.Default,
        u3: 0,
        rowCount: 0,
        u4: 0,
        u5: 0,
        columns: [],
        paginations: [],
        languages: [],
      }

      const buffer = new SmartBuffer()
      writeExhHeader(buffer, header)
      const writtenData = buffer.toBuffer()

      const readBuffer = SmartBuffer.fromBuffer(writtenData)
      const readHeader = readExhHeader(readBuffer)

      expect(readHeader.columnCount).toBe(0)
      expect(readHeader.pageCount).toBe(0)
      expect(readHeader.languageCount).toBe(0)
      expect(readHeader.columns).toHaveLength(0)
      expect(readHeader.paginations).toHaveLength(0)
      expect(readHeader.languages).toHaveLength(0)
    })

    it('should handle all column types', () => {
      const columnTypes = [
        ExcelColumnType.String,
        ExcelColumnType.Int,
        ExcelColumnType.Float,
      ]
      const columns: ExcelColumn[] = columnTypes.map((type, index) => ({
        type,
        offset: index * 4,
      }))

      const header: ExhHeader = {
        magic: 'EXHF',
        version: 1,
        dataOffset: 0x50,
        columnCount: columnTypes.length,
        pageCount: 1,
        languageCount: 1,
        unknown1: 0,
        u2: 0,
        variant: ExcelVariant.Default,
        u3: 0,
        rowCount: 100,
        u4: 0,
        u5: 0,
        columns,
        paginations: [{ startId: 0, rowCount: 100 }],
        languages: [Language.English],
      }

      const buffer = new SmartBuffer()
      writeExhHeader(buffer, header)
      const writtenData = buffer.toBuffer()

      const readBuffer = SmartBuffer.fromBuffer(writtenData)
      const readHeader = readExhHeader(readBuffer)

      expect(readHeader.columns).toEqual(columns)
    })

    it('should handle all variants', () => {
      const variants = [
        ExcelVariant.Unknown,
        ExcelVariant.Default,
        ExcelVariant.Subrows,
      ]

      for (const variant of variants) {
        const header: ExhHeader = {
          magic: 'EXHF',
          version: 1,
          dataOffset: 0x50,
          columnCount: 1,
          pageCount: 1,
          languageCount: 1,
          unknown1: 0,
          u2: 0,
          variant,
          u3: 0,
          rowCount: 100,
          u4: 0,
          u5: 0,
          columns: [{ type: ExcelColumnType.String, offset: 0 }],
          paginations: [{ startId: 0, rowCount: 100 }],
          languages: [Language.English],
        }

        const buffer = new SmartBuffer()
        writeExhHeader(buffer, header)
        const writtenData = buffer.toBuffer()

        const readBuffer = SmartBuffer.fromBuffer(writtenData)
        const readHeader = readExhHeader(readBuffer)

        expect(readHeader.variant).toBe(variant)
      }
    })
  })
})
