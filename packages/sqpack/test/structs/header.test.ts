import { SmartBuffer } from 'smart-buffer'
import { describe, expect, it } from 'vitest'
import { PlatformId } from '../../src/interface'
import {
  readSqPackHeader,
  readSqPackIndexHeader,
  type SqPackHeader,
  type SqPackIndexHeader,
  validateSqPackMagic,
  writeSqPackHeader,
  writeSqPackIndexHeader,
} from '../../src/structs/header'

describe('Header Structs', () => {
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
      buffer.writeUInt32LE(0x400, 12)
      buffer.writeUInt32LE(1, 16)
      buffer.writeUInt32LE(2, 20)

      const smartBuffer = SmartBuffer.fromBuffer(buffer)
      const header = readSqPackHeader(smartBuffer)

      expect(header.magic.toString()).toBe('SqPack\0\0')
      expect(header.platformId).toBe(PlatformId.Win32)
      expect(header.size).toBe(0x400)
      expect(header.version).toBe(1)
      expect(header.type).toBe(2)
    })

    it('should write SqPack header correctly', () => {
      const header: SqPackHeader = {
        magic: Buffer.from([0x53, 0x71, 0x50, 0x61, 0x63, 0x6b, 0x00, 0x00]), // "SqPack\0\0"
        platformId: PlatformId.Win32,
        size: 0x400,
        version: 1,
        type: 2,
      }

      const buffer = new SmartBuffer()
      writeSqPackHeader(buffer, header)
      const writtenData = buffer.toBuffer()

      // Verify the written data
      expect(writtenData.toString('ascii', 0, 8)).toBe('SqPack\0\0')
      expect(writtenData.readUInt8(8)).toBe(PlatformId.Win32)
      expect(writtenData.readUInt8(9)).toBe(0) // Padding
      expect(writtenData.readUInt8(10)).toBe(0) // Padding
      expect(writtenData.readUInt8(11)).toBe(0) // Padding
      expect(writtenData.readUInt32LE(12)).toBe(0x400)
      expect(writtenData.readUInt32LE(16)).toBe(1)
      expect(writtenData.readUInt32LE(20)).toBe(2)
    })

    it('should round-trip read and write correctly', () => {
      const originalHeader: SqPackHeader = {
        magic: Buffer.from([0x53, 0x71, 0x50, 0x61, 0x63, 0x6b, 0x00, 0x00]),
        platformId: PlatformId.PS4,
        size: 0x800,
        version: 3,
        type: 0x12345678,
      }

      // Write header
      const writeBuffer = new SmartBuffer()
      writeSqPackHeader(writeBuffer, originalHeader)
      const writtenData = writeBuffer.toBuffer()

      // Read header back
      const readBuffer = SmartBuffer.fromBuffer(writtenData)
      const readHeader = readSqPackHeader(readBuffer)

      expect(readHeader.magic).toEqual(originalHeader.magic)
      expect(readHeader.platformId).toBe(originalHeader.platformId)
      expect(readHeader.size).toBe(originalHeader.size)
      expect(readHeader.version).toBe(originalHeader.version)
      expect(readHeader.type).toBe(originalHeader.type)
    })
  })

  describe('SqPackIndexHeader', () => {
    it('should read SqPack index header correctly', () => {
      const buffer = Buffer.alloc(16)
      buffer.writeUInt32LE(0x400, 0) // size
      buffer.writeUInt32LE(1, 4) // version
      buffer.writeUInt32LE(0x500, 8) // indexDataOffset
      buffer.writeUInt32LE(0x1000, 12) // indexDataSize

      const smartBuffer = SmartBuffer.fromBuffer(buffer)
      const header = readSqPackIndexHeader(smartBuffer)

      expect(header.size).toBe(0x400)
      expect(header.version).toBe(1)
      expect(header.indexDataOffset).toBe(0x500)
      expect(header.indexDataSize).toBe(0x1000)
    })

    it('should write SqPack index header correctly', () => {
      const header: SqPackIndexHeader = {
        size: 0x400,
        version: 1,
        indexDataOffset: 0x500,
        indexDataSize: 0x1000,
      }

      const buffer = new SmartBuffer()
      writeSqPackIndexHeader(buffer, header)
      const writtenData = buffer.toBuffer()

      expect(writtenData.readUInt32LE(0)).toBe(0x400)
      expect(writtenData.readUInt32LE(4)).toBe(1)
      expect(writtenData.readUInt32LE(8)).toBe(0x500)
      expect(writtenData.readUInt32LE(12)).toBe(0x1000)
    })

    it('should round-trip read and write correctly', () => {
      const originalHeader: SqPackIndexHeader = {
        size: 0x800,
        version: 2,
        indexDataOffset: 0x1000,
        indexDataSize: 0x2000,
      }

      // Write header
      const writeBuffer = new SmartBuffer()
      writeSqPackIndexHeader(writeBuffer, originalHeader)
      const writtenData = writeBuffer.toBuffer()

      // Read header back
      const readBuffer = SmartBuffer.fromBuffer(writtenData)
      const readHeader = readSqPackIndexHeader(readBuffer)

      expect(readHeader.size).toBe(originalHeader.size)
      expect(readHeader.version).toBe(originalHeader.version)
      expect(readHeader.indexDataOffset).toBe(originalHeader.indexDataOffset)
      expect(readHeader.indexDataSize).toBe(originalHeader.indexDataSize)
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

    it('should reject magic with wrong length', () => {
      const magic = Buffer.from([0x53, 0x71, 0x50, 0x61]) // Too short
      expect(validateSqPackMagic(magic)).toBe(false)
    })

    it('should reject magic with correct prefix but wrong suffix', () => {
      const magic = Buffer.from([
        0x53, 0x71, 0x50, 0x61, 0x63, 0x6b, 0x01, 0x01,
      ]) // "SqPack\1\1"
      expect(validateSqPackMagic(magic)).toBe(false)
    })
  })
})
