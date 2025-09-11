import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SmartBuffer } from 'smart-buffer'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SqPackReader } from '../src'
import { readExcelDataHeader } from '../src/structs/excel/exd'
import { readExhHeader } from '../src/structs/excel/exh'
import { readExlFile } from '../src/structs/excel/exl'
import {
  readSqPackHeader,
  readSqPackIndexHeader,
  validateSqPackMagic,
} from '../src/structs/header'
import {
  readIndex2HashTableEntry,
  readIndexHashTableEntry,
} from '../src/structs/sqpack-index'

describe('SqPack Fixture Tests', () => {
  let indexBuffer: Buffer
  let index2Buffer: Buffer

  beforeAll(() => {
    // Load fixture files
    indexBuffer = readFileSync(
      join(__dirname, '__fixtures__/0a0000.win32.index'),
    )
    index2Buffer = readFileSync(
      join(__dirname, '__fixtures__/0a0000.win32.index2'),
    )
  })

  describe('Index File Tests', () => {
    it('should read SqPack header from index file', () => {
      const smartBuffer = SmartBuffer.fromBuffer(indexBuffer)
      const header = readSqPackHeader(smartBuffer)
      expect(validateSqPackMagic(header.magic)).toBe(true)
      expect(header.platformId).toBe(0) // Win32 = 0
      expect(header.size).toBe(0x400)
      expect(header.version).toBe(1)
      expect(header.type).toBe(2)
    })

    it('should read SqPack index header from index file', () => {
      const smartBuffer = SmartBuffer.fromBuffer(indexBuffer)
      const sqPackHeader = readSqPackHeader(smartBuffer)
      smartBuffer.readOffset = sqPackHeader.size

      const indexHeader = readSqPackIndexHeader(smartBuffer)
      expect(indexHeader.size).toBe(0x400)
      expect(indexHeader.version).toBe(1)
      expect(indexHeader.indexDataOffset).toBe(0x800)
      expect(indexHeader.indexDataSize).toBeLessThanOrEqual(
        indexBuffer.length - 0x800,
      )
    })

    it('should read index hash table entries', () => {
      const smartBuffer = SmartBuffer.fromBuffer(indexBuffer)
      const sqPackHeader = readSqPackHeader(smartBuffer)
      smartBuffer.readOffset = sqPackHeader.size
      const indexHeader = readSqPackIndexHeader(smartBuffer)

      // Skip to index data - ensure we don't go beyond buffer bounds
      const indexDataBuffer = indexBuffer.subarray(
        indexHeader.indexDataOffset,
        indexHeader.indexDataOffset + indexHeader.indexDataSize,
      )
      const entryBuffer = SmartBuffer.fromBuffer(indexDataBuffer)
      const entries: any[] = []

      // Read first few entries
      while (entryBuffer.remaining() >= 16 && entries.length < 10) {
        const entry = readIndexHashTableEntry(entryBuffer)
        entries.push(entry)
      }

      expect(entries.length).toBeGreaterThan(0)

      // Validate entry structure
      entries.forEach((entry) => {
        expect(typeof entry.hash).toBe('bigint')
        expect(entry.hash).toBeGreaterThan(0n)
        expect(entry.dataFileId).toBeGreaterThanOrEqual(0)
        expect(entry.dataFileId).toBeLessThan(8) // Should be 3 bits max
        expect(entry.offset).toBeGreaterThanOrEqual(0)
      })
    })
  })

  describe('Index2 File Tests', () => {
    it('should read SqPack header from index2 file', () => {
      const smartBuffer = SmartBuffer.fromBuffer(index2Buffer)
      const header = readSqPackHeader(smartBuffer)

      expect(validateSqPackMagic(header.magic)).toBe(true)
      expect(header.platformId).toBe(0) // Win32 = 0
      expect(header.size).toBe(0x400)
      expect(header.version).toBe(1)
      expect(header.type).toBe(2)
    })

    it('should read SqPack index header from index2 file', () => {
      const smartBuffer = SmartBuffer.fromBuffer(index2Buffer)
      const sqPackHeader = readSqPackHeader(smartBuffer)
      smartBuffer.readOffset = sqPackHeader.size

      const indexHeader = readSqPackIndexHeader(smartBuffer)
      expect(indexHeader.size).toBe(0x400)
      expect(indexHeader.version).toBe(1)
      expect(indexHeader.indexDataOffset).toBe(0x800)
      expect(indexHeader.indexDataSize).toBeLessThanOrEqual(
        indexBuffer.length - 0x800,
      )
    })

    it('should read index2 hash table entries', () => {
      const smartBuffer = SmartBuffer.fromBuffer(indexBuffer)
      const sqPackHeader = readSqPackHeader(smartBuffer)
      smartBuffer.readOffset = sqPackHeader.size
      const indexHeader = readSqPackIndexHeader(smartBuffer)

      // Skip to index data - ensure we don't go beyond buffer bounds
      const indexDataBuffer = indexBuffer.subarray(
        indexHeader.indexDataOffset,
        indexHeader.indexDataOffset + indexHeader.indexDataSize,
      )
      const entryBuffer = SmartBuffer.fromBuffer(indexDataBuffer)
      const entries: any[] = []

      // Read first few entries
      while (entryBuffer.remaining() >= 16 && entries.length < 10) {
        const entry = readIndex2HashTableEntry(entryBuffer)
        entries.push(entry)
      }

      expect(entries.length).toBeGreaterThan(0)

      // Validate entry structure
      entries.forEach((entry) => {
        expect(typeof entry.hash).toBe('number')
        expect(entry.hash).toBeGreaterThan(0n)
        expect(entry.dataFileId).toBeGreaterThanOrEqual(0)
        expect(entry.dataFileId).toBeLessThan(8) // Should be 3 bits max
        expect(entry.offset).toBeGreaterThanOrEqual(0)
      })
    })
  })

  describe('SqPackReader Integration Tests', () => {
    const prefix = join(__dirname, '__fixtures__/0a0000.win32')
    const testPath = 'exd/root.exl'

    it('should create SqPackReader with index file', async () => {
      const reader = await SqPackReader.open({ prefix, useIndex2: false })

      expect(reader).toBeInstanceOf(SqPackReader)
      await reader.close()
    })

    it('should create SqPackReader with index2 file', async () => {
      const reader = await SqPackReader.open({ prefix, useIndex2: true })

      expect(reader).toBeInstanceOf(SqPackReader)
      await reader.close()
    })

    it('should handle file operations with index file', async () => {
      const reader = await SqPackReader.open({ prefix, useIndex2: false })

      try {
        const hasFile = await reader.hasFile(testPath)
        const fileInfo = await reader.getFileIndex(testPath)

        expect(hasFile).toBe(true)
        expect(fileInfo).toEqual({
          dataFileId: 0,
          offset: 20182272,
          path: 'exd/root.exl',
        })
      } finally {
        await reader.close()
      }
    })

    it('should handle file operations with index2 file', async () => {
      const reader = await SqPackReader.open({ prefix, useIndex2: true })

      try {
        const hasFile = await reader.hasFile(testPath)
        const fileInfo = await reader.getFileIndex(testPath)

        expect(hasFile).toBe(true)
        expect(fileInfo).toEqual({
          dataFileId: 0,
          offset: 20182272,
          path: 'exd/root.exl',
        })
      } finally {
        await reader.close()
      }
    })

    describe('Excel File Tests', () => {
      let reader: SqPackReader
      beforeAll(async () => {
        reader = await SqPackReader.open({ prefix, useIndex2: false })
      })

      afterAll(async () => {
        await reader.close()
      })

      it('should read exl file with index file', async () => {
        const fileData = await reader.readFile(testPath)
        expect(fileData).toBeTruthy()

        const exlFile = readExlFile(fileData)
        expect(exlFile.magic).toBe('EXLT')
        expect(exlFile.version).toBe(2)
        expect(exlFile.entries.length).toBeGreaterThan(0)
        expect(exlFile.entries[0].name).toBe('AchievementCategory')
        expect(exlFile.entries[0].id).toBeGreaterThan(0)
      })

      it('should read exh file with index file', async () => {
        const fileData = await reader.readFile('exd/AchievementCategory.exh')
        expect(fileData).toBeTruthy()
        const exhFile = readExhHeader(SmartBuffer.fromBuffer(fileData))
        expect(exhFile).toEqual({
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
        })
      })

      it('should read exd file with index file', async () => {
        const fileData = await reader.readFile(
          'exd/AchievementCategory_0_chs.exd',
        )
        expect(fileData).toBeTruthy()

        const exdFile = readExcelDataHeader(SmartBuffer.fromBuffer(fileData))
        expect(exdFile.offsetMap.size).toBe(83)
        expect(exdFile.dataSize).toBe(2244)
        expect(exdFile.indexSize).toBe(664)
        expect(exdFile.u1).toBe(0)
        expect(exdFile.version).toBe(2)
        expect(exdFile.magic).toBe('EXDF')
      })
    })
  })
})
