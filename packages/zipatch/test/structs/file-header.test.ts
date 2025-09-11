import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SmartBuffer } from 'smart-buffer'
import { describe, expect, it } from 'vitest'
import {
  alignBlockSize,
  readFileBlockHeader,
  readFileHeader,
} from '../../src/structs/file-header'

describe('FileHeader struct', () => {
  const fixturePath = join(__dirname, '../__fixtures__/sqpk-fa-35.bin')
  const fixtureData = readFileSync(fixturePath)

  it('should parse FileHeader correctly', () => {
    const buffer = SmartBuffer.fromBuffer(fixtureData.subarray(5))
    const header = readFileHeader(buffer)

    expect(header).toEqual({
      expansionId: 0,
      filePath: 'ffxiv_dx11.exe',
      filePathSize: 15,
      offset: 46400000n,
      operation: 65,
      size: 1600000n,
    })
  })

  it('should handle FileBlockHeader parsing', () => {
    // Create test data for FileBlockHeader
    const testData = Buffer.alloc(16)
    testData.writeUInt32LE(0x00000010, 0) // headerSize
    testData.writeUInt32LE(0x00000000, 4) // padding
    testData.writeUInt32LE(0x00000080, 8) // compressedSize
    testData.writeUInt32LE(0x00000002, 12) // decompressedSize

    const buffer = SmartBuffer.fromBuffer(testData)
    const blockHeader = readFileBlockHeader(buffer)

    expect(blockHeader.headerSize).toBe(0x10)
    expect(blockHeader.compressedSize).toBe(0x80)
    expect(blockHeader.decompressedSize).toBe(0x02)
    expect(blockHeader.isBlockCompressed).toBe(true) // compressedSize !== 32000
    expect(blockHeader.blockSize).toBe(0x80) // compressedSize since it's compressed
    expect(blockHeader.alignedBlockSize).toBe(alignBlockSize(0x80))
  })

  it('should handle uncompressed blocks correctly', () => {
    // Create test data for uncompressed block (compressedSize = 32000)
    const testData = Buffer.alloc(16)
    testData.writeUInt32LE(0x00000010, 0) // headerSize
    testData.writeUInt32LE(0x00000000, 4) // padding
    testData.writeUInt32LE(32000, 8) // compressedSize (uncompressed marker)
    testData.writeUInt32LE(0x00001000, 12) // decompressedSize

    const buffer = SmartBuffer.fromBuffer(testData)
    const blockHeader = readFileBlockHeader(buffer)

    expect(blockHeader.isBlockCompressed).toBe(false)
    expect(blockHeader.blockSize).toBe(0x1000) // decompressedSize since it's uncompressed
    expect(blockHeader.alignedBlockSize).toBe(alignBlockSize(0x1000))
  })

  it('should calculate aligned block size correctly', () => {
    expect(alignBlockSize(0x80)).toBe(0x100)
    expect(alignBlockSize(0x81)).toBe(0x100)
    expect(alignBlockSize(0x100)).toBe(0x180)
    expect(alignBlockSize(0x101)).toBe(0x180)
  })
})
