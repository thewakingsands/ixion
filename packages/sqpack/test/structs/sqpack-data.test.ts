import { SmartBuffer } from 'smart-buffer'
import { describe, expect, it } from 'vitest'
import {
  FileType,
  readSqPackDataChunkHeader,
  readSqPackFileInfo,
  readSqPackStandardChunkInfo,
  type SqPackDataChunkHeader,
  type SqPackFileInfo,
  type SqPackStandardChunkInfo,
  writeSqPackDataChunkHeader,
  writeSqPackFileInfo,
  writeSqPackStandardChunkInfo,
} from '../../src/structs/sqpack-data'

describe('SqPack Data Structs', () => {
  describe('SqPackFileInfo', () => {
    it('should read SqPack file info correctly', () => {
      const buffer = Buffer.alloc(20)
      buffer.writeUInt32LE(0x100, 0) // size
      buffer.writeUInt32LE(FileType.Standard, 4) // type
      buffer.writeUInt32LE(0x2000, 8) // rawFileSize
      buffer.writeUInt32LE(4, 12) // numberOfBlocks
      buffer.writeUInt32LE(3, 16) // usedNumberOfBlocks

      const smartBuffer = SmartBuffer.fromBuffer(buffer)
      const fileInfo = readSqPackFileInfo(smartBuffer)

      expect(fileInfo.size).toBe(0x100)
      expect(fileInfo.type).toBe(FileType.Standard)
      expect(fileInfo.rawFileSize).toBe(0x2000)
      expect(fileInfo.numberOfBlocks).toBe(4)
      expect(fileInfo.usedNumberOfBlocks).toBe(3)
    })

    it('should write SqPack file info correctly', () => {
      const fileInfo: SqPackFileInfo = {
        size: 0x100,
        type: FileType.Standard,
        rawFileSize: 0x2000,
        numberOfBlocks: 4,
        usedNumberOfBlocks: 3,
      }

      const buffer = new SmartBuffer()
      writeSqPackFileInfo(buffer, fileInfo)
      const writtenData = buffer.toBuffer()

      expect(writtenData.readUInt32LE(0)).toBe(0x100)
      expect(writtenData.readUInt32LE(4)).toBe(FileType.Standard)
      expect(writtenData.readUInt32LE(8)).toBe(0x2000)
      expect(writtenData.readUInt32LE(12)).toBe(4)
      expect(writtenData.readUInt32LE(16)).toBe(3)
    })

    it('should round-trip read and write correctly', () => {
      const originalFileInfo: SqPackFileInfo = {
        size: 0x200,
        type: FileType.Texture,
        rawFileSize: 0x4000,
        numberOfBlocks: 8,
        usedNumberOfBlocks: 6,
      }

      // Write file info
      const writeBuffer = new SmartBuffer()
      writeSqPackFileInfo(writeBuffer, originalFileInfo)
      const writtenData = writeBuffer.toBuffer()

      // Read file info back
      const readBuffer = SmartBuffer.fromBuffer(writtenData)
      const readFileInfo = readSqPackFileInfo(readBuffer)

      expect(readFileInfo.size).toBe(originalFileInfo.size)
      expect(readFileInfo.type).toBe(originalFileInfo.type)
      expect(readFileInfo.rawFileSize).toBe(originalFileInfo.rawFileSize)
      expect(readFileInfo.numberOfBlocks).toBe(originalFileInfo.numberOfBlocks)
      expect(readFileInfo.usedNumberOfBlocks).toBe(
        originalFileInfo.usedNumberOfBlocks,
      )
    })

    it('should handle all file types', () => {
      const fileTypes = [
        FileType.Empty,
        FileType.Standard,
        FileType.Model,
        FileType.Texture,
      ]

      for (const fileType of fileTypes) {
        const fileInfo: SqPackFileInfo = {
          size: 0x100,
          type: fileType,
          rawFileSize: 0x1000,
          numberOfBlocks: 1,
          usedNumberOfBlocks: 1,
        }

        const buffer = new SmartBuffer()
        writeSqPackFileInfo(buffer, fileInfo)
        const writtenData = buffer.toBuffer()

        const readBuffer = SmartBuffer.fromBuffer(writtenData)
        const readFileInfo = readSqPackFileInfo(readBuffer)

        expect(readFileInfo.type).toBe(fileType)
      }
    })
  })

  describe('SqPackDataBlockHeader', () => {
    it('should read SqPack data block header correctly', () => {
      const buffer = Buffer.alloc(16)
      buffer.writeUInt32LE(16, 0) // size
      buffer.writeUInt32LE(0x12345678, 4) // __unknown
      buffer.writeUInt32LE(0x1000, 8) // compressedSize
      buffer.writeUInt32LE(0x2000, 12) // uncompressedSize

      const smartBuffer = SmartBuffer.fromBuffer(buffer)
      const blockHeader = readSqPackDataChunkHeader(smartBuffer)

      expect(blockHeader.size).toBe(16)
      expect(blockHeader.u1).toBe(0x12345678)
      expect(blockHeader.compressedSize).toBe(0x1000)
      expect(blockHeader.uncompressedSize).toBe(0x2000)
    })

    it('should write SqPack data block header correctly', () => {
      const blockHeader: SqPackDataChunkHeader = {
        size: 16,
        u1: 0x12345678,
        compressedSize: 0x1000,
        uncompressedSize: 0x2000,
      }

      const buffer = new SmartBuffer()
      writeSqPackDataChunkHeader(buffer, blockHeader)
      const writtenData = buffer.toBuffer()

      expect(writtenData.readUInt32LE(0)).toBe(16)
      expect(writtenData.readUInt32LE(4)).toBe(0x12345678)
      expect(writtenData.readUInt32LE(8)).toBe(0x1000)
      expect(writtenData.readUInt32LE(12)).toBe(0x2000)
    })

    it('should round-trip read and write correctly', () => {
      const originalBlockHeader: SqPackDataChunkHeader = {
        size: 20,
        u1: 0x87654321,
        compressedSize: 0x3000,
        uncompressedSize: 0x5000,
      }

      // Write block header
      const writeBuffer = new SmartBuffer()
      writeSqPackDataChunkHeader(writeBuffer, originalBlockHeader)
      const writtenData = writeBuffer.toBuffer()

      // Read block header back
      const readBuffer = SmartBuffer.fromBuffer(writtenData)
      const readBlockHeader = readSqPackDataChunkHeader(readBuffer)

      expect(readBlockHeader.size).toBe(originalBlockHeader.size)
      expect(readBlockHeader.u1).toBe(originalBlockHeader.u1)
      expect(readBlockHeader.compressedSize).toBe(
        originalBlockHeader.compressedSize,
      )
      expect(readBlockHeader.uncompressedSize).toBe(
        originalBlockHeader.uncompressedSize,
      )
    })
  })

  describe('SqPackStandardBlockInfo', () => {
    it('should read SqPack standard block info correctly', () => {
      const buffer = Buffer.alloc(8)
      buffer.writeUInt32LE(0x1000, 0) // offset
      buffer.writeUInt16LE(0x800, 4) // compressedSize
      buffer.writeUInt16LE(0x1000, 6) // uncompressedSize

      const smartBuffer = SmartBuffer.fromBuffer(buffer)
      const blockInfo = readSqPackStandardChunkInfo(smartBuffer)

      expect(blockInfo.offset).toBe(0x1000)
      expect(blockInfo.compressedSize).toBe(0x800)
      expect(blockInfo.uncompressedSize).toBe(0x1000)
    })

    it('should write SqPack standard block info correctly', () => {
      const blockInfo: SqPackStandardChunkInfo = {
        offset: 0x1000,
        compressedSize: 0x800,
        uncompressedSize: 0x1000,
      }

      const buffer = new SmartBuffer()
      writeSqPackStandardChunkInfo(buffer, blockInfo)
      const writtenData = buffer.toBuffer()

      expect(writtenData.readUInt32LE(0)).toBe(0x1000)
      expect(writtenData.readUInt16LE(4)).toBe(0x800)
      expect(writtenData.readUInt16LE(6)).toBe(0x1000)
    })

    it('should round-trip read and write correctly', () => {
      const originalBlockInfo: SqPackStandardChunkInfo = {
        offset: 0x2000,
        compressedSize: 0x1200,
        uncompressedSize: 0x2400,
      }

      // Write block info
      const writeBuffer = new SmartBuffer()
      writeSqPackStandardChunkInfo(writeBuffer, originalBlockInfo)
      const writtenData = writeBuffer.toBuffer()

      // Read block info back
      const readBuffer = SmartBuffer.fromBuffer(writtenData)
      const readBlockInfo = readSqPackStandardChunkInfo(readBuffer)

      expect(readBlockInfo.offset).toBe(originalBlockInfo.offset)
      expect(readBlockInfo.compressedSize).toBe(
        originalBlockInfo.compressedSize,
      )
      expect(readBlockInfo.uncompressedSize).toBe(
        originalBlockInfo.uncompressedSize,
      )
    })

    it('should handle maximum values for 16-bit fields', () => {
      const blockInfo: SqPackStandardChunkInfo = {
        offset: 0xffffffff,
        compressedSize: 0xffff,
        uncompressedSize: 0xffff,
      }

      const buffer = new SmartBuffer()
      writeSqPackStandardChunkInfo(buffer, blockInfo)
      const writtenData = buffer.toBuffer()

      const readBuffer = SmartBuffer.fromBuffer(writtenData)
      const readBlockInfo = readSqPackStandardChunkInfo(readBuffer)

      expect(readBlockInfo.offset).toBe(0xffffffff)
      expect(readBlockInfo.compressedSize).toBe(0xffff)
      expect(readBlockInfo.uncompressedSize).toBe(0xffff)
    })
  })
})
