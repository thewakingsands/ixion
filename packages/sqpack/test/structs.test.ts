import { SmartBuffer } from 'smart-buffer'
import { describe, expect, it } from 'vitest'
import { PlatformId } from '../src/interface'
import {
  readSqPackHeader,
  readSqPackIndexHeader,
  validateSqPackMagic,
} from '../src/structs/header'
import {
  readIndex2HashTableEntry,
  readIndexHashTableEntry,
} from '../src/structs/sqpack-index'

describe('SqPack Structs', () => {
  describe('SqPackHeader', () => {
    it('should read SqPack header correctly', () => {
      const buffer = Buffer.alloc(32)
      // Write magic "SqPack\0\0"
      buffer.write('SqPack\0\0', 0)
      // Write platform ID (Win32 = 0)
      buffer.writeUInt8(PlatformId.Win32, 8)
      // Write padding (3 bytes)
      buffer.writeUInt8(0, 9)
      buffer.writeUInt8(0, 10)
      buffer.writeUInt8(0, 11)
      // Write size, version, type
      buffer.writeUInt32BE(0x400, 12)
      buffer.writeUInt32BE(1, 16)
      buffer.writeUInt32BE(2, 20)

      const smartBuffer = SmartBuffer.fromBuffer(buffer)
      const header = readSqPackHeader(smartBuffer)

      expect(header.platformId).toBe(PlatformId.Win32)
      expect(header.size).toBe(0x400)
      expect(header.version).toBe(1)
      expect(header.type).toBe(2)
    })
  })

  describe('SqPackIndexHeader', () => {
    it('should read SqPack index header correctly', () => {
      const buffer = Buffer.alloc(16)
      buffer.writeUInt32BE(0x400, 0) // size
      buffer.writeUInt32BE(1, 4) // version
      buffer.writeUInt32BE(0x500, 8) // indexDataOffset
      buffer.writeUInt32BE(0x1000, 12) // indexDataSize

      const smartBuffer = SmartBuffer.fromBuffer(buffer)
      const header = readSqPackIndexHeader(smartBuffer)

      expect(header.size).toBe(0x400)
      expect(header.version).toBe(1)
      expect(header.indexDataOffset).toBe(0x500)
      expect(header.indexDataSize).toBe(0x1000)
    })
  })

  describe('validateSqPackMagic', () => {
    it('should validate correct magic', () => {
      const magic = Buffer.from([
        0x53, 0x71, 0x50, 0x61, 0x63, 0x6b, 0x00, 0x00,
      ]) // "SqPack\0\0"
      expect(validateSqPackMagic(magic)).toBe(true)
    })

    it('should reject incorrect magic', () => {
      const magic = Buffer.from([
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ])
      expect(validateSqPackMagic(magic)).toBe(false)
    })
  })

  describe('IndexHashTableEntry', () => {
    it('should read index hash table entry correctly', () => {
      const buffer = Buffer.alloc(16)
      // Write 64-bit hash
      buffer.writeBigUInt64BE(0x1234567890abcdefn, 0)
      // Write data with bit fields: unknown=1, dataFileId=3, offset=0x1234567
      const data = 0x1 | (3 << 1) | (0x1234567 << 4)
      buffer.writeUInt32BE(data, 8)
      buffer.writeUInt32BE(0, 12) // padding

      const smartBuffer = SmartBuffer.fromBuffer(buffer)
      const entry = readIndexHashTableEntry(smartBuffer)

      expect(entry.hash).toBe(0x1234567890abcdefn)
      expect(entry.isSynonym).toBe(true)
      expect(entry.dataFileId).toBe(3)
      expect(entry.offset).toBe(0x1234567)
    })
  })

  describe('Index2HashTableEntry', () => {
    it('should read index2 hash table entry correctly', () => {
      const buffer = Buffer.alloc(8)
      // Write 32-bit hash
      buffer.writeUInt32BE(0x12345678, 0)
      // Write data with bit fields: unknown=1, dataFileId=3, offset=0x1234567
      const data = 0x1 | (3 << 1) | (0x1234567 << 4)
      buffer.writeUInt32BE(data, 4)

      const smartBuffer = SmartBuffer.fromBuffer(buffer)
      const entry = readIndex2HashTableEntry(smartBuffer)

      expect(entry.hash).toBe(0x12345678)
      expect(entry.isSynonym).toBe(true)
      expect(entry.dataFileId).toBe(3)
      expect(entry.offset).toBe(0x1234567)
    })
  })
})
