import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Language } from '@ffcafe/ixion-utils'
import { SmartBuffer } from 'smart-buffer'
import { describe, expect, it } from 'vitest'
import {
  type ExcelDataHeader,
  getExdPath,
  readExcelDataHeader,
  readExcelDataRowHeader,
  writeExcelDataHeader,
} from '../../../src/structs/excel/exd'

describe('Excel EXD Data Structs', () => {
  const fixtureBuffer = readFileSync(
    join(__dirname, '../../__fixtures__/AchievementCategory_0.exd'),
  )

  let exdFile: ExcelDataHeader

  describe('ExcelDataHeader', () => {
    it('should read Excel data header correctly', () => {
      const buffer = SmartBuffer.fromBuffer(fixtureBuffer)
      exdFile = readExcelDataHeader(buffer)
      expect(exdFile.offsetMap.size).toBe(83)
      expect(exdFile.dataSize).toBe(2244)
      expect(exdFile.indexSize).toBe(664)
      expect(exdFile.u1).toBe(0)
      expect(exdFile.version).toBe(2)
      expect(exdFile.magic).toBe('EXDF')
    })

    it('should write Excel data header correctly', () => {
      const buffer = new SmartBuffer()
      writeExcelDataHeader(buffer, exdFile)

      expect(buffer.toBuffer()).toEqual(
        fixtureBuffer.subarray(0, buffer.length),
      )
    })
  })

  describe('ExcelDataRowHeader', () => {
    it('should read Excel data row header correctly', () => {
      const buffer = SmartBuffer.fromBuffer(fixtureBuffer)

      buffer.readOffset = exdFile.offsetMap.get(0) as number
      const { dataSize, rowCount } = readExcelDataRowHeader(buffer)
      expect(dataSize).toBe(10)
      expect(rowCount).toBe(1)
    })
  })

  describe('getExdPath', () => {
    it('should generate correct EXD paths for different languages', () => {
      expect(getExdPath('Item', 0, Language.None)).toBe('exd/Item_0.exd')
      expect(getExdPath('Item', 0, Language.Japanese)).toBe('exd/Item_0_ja.exd')
      expect(getExdPath('Item', 0, Language.English)).toBe('exd/Item_0_en.exd')
      expect(getExdPath('Item', 0, Language.German)).toBe('exd/Item_0_de.exd')
      expect(getExdPath('Item', 0, Language.French)).toBe('exd/Item_0_fr.exd')
      expect(getExdPath('Item', 0, Language.ChineseSimplified)).toBe(
        'exd/Item_0_chs.exd',
      )
      expect(getExdPath('Item', 0, Language.ChineseTraditional)).toBe(
        'exd/Item_0_cht.exd',
      )
      expect(getExdPath('Item', 0, Language.Korean)).toBe('exd/Item_0_ko.exd')
    })

    it('should generate correct EXD paths with different start IDs', () => {
      expect(getExdPath('Action', 100, Language.English)).toBe(
        'exd/Action_100_en.exd',
      )
      expect(getExdPath('Action', 1000, Language.English)).toBe(
        'exd/Action_1000_en.exd',
      )
      expect(getExdPath('Action', 0xffffffff, Language.English)).toBe(
        'exd/Action_4294967295_en.exd',
      )
    })

    it('should generate correct EXD paths with different sheet names', () => {
      expect(getExdPath('Item', 0, Language.English)).toBe('exd/Item_0_en.exd')
      expect(getExdPath('Action', 0, Language.English)).toBe(
        'exd/Action_0_en.exd',
      )
      expect(getExdPath('Status', 0, Language.English)).toBe(
        'exd/Status_0_en.exd',
      )
      expect(getExdPath('Quest', 0, Language.English)).toBe(
        'exd/Quest_0_en.exd',
      )
    })

    it('should throw error for invalid language', () => {
      expect(() => getExdPath('Item', 0, 999 as Language)).toThrow(
        'Invalid language: 999',
      )
    })

    it('should handle special characters in sheet names', () => {
      expect(getExdPath('Item-With-Dashes', 0, Language.English)).toBe(
        'exd/Item-With-Dashes_0_en.exd',
      )
      expect(getExdPath('Item_With_Underscores', 0, Language.English)).toBe(
        'exd/Item_With_Underscores_0_en.exd',
      )
      expect(getExdPath('Item With Spaces', 0, Language.English)).toBe(
        'exd/Item With Spaces_0_en.exd',
      )
    })
  })
})
