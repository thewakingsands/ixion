import { SmartBuffer } from 'smart-buffer'
import { describe, expect, it } from 'vitest'
import { readSqpkAddData } from '../../src/structs/sqpk-add-data'

describe('SqpkAddData struct', () => {
  it('should parse SqpkAddData correctly from test data', () => {
    // Create test data for SqpkAddData
    const blockCount = 2
    const blockDeleteCount = 1
    const dataSize = blockCount << 7 // 256 bytes

    const testData = Buffer.alloc(19 + 4 + dataSize) // header + blockDeleteCount + data
    testData.writeUInt8(0x00, 0) // reserved[0]
    testData.writeUInt8(0x00, 1) // reserved[1]
    testData.writeUInt8(0x00, 2) // reserved[2]
    testData.writeUInt16BE(0x0a00, 3) // mainId
    testData.writeUInt16BE(0x0000, 5) // subId
    testData.writeUInt32BE(0x00000000, 7) // fileId
    testData.writeUInt32BE(0x00000001, 11) // blockOffset
    testData.writeUInt32BE(blockCount, 15) // blockCount
    testData.writeUInt32BE(blockDeleteCount, 19) // blockDeleteCount

    // Fill data section with test pattern
    for (let i = 0; i < dataSize; i++) {
      testData.writeUInt8(i & 0xff, 23 + i)
    }

    const buffer = SmartBuffer.fromBuffer(testData)
    const addData = readSqpkAddData(buffer)

    expect(addData.reserved).toEqual(Buffer.from([0x00, 0x00, 0x00]))
    expect(addData.file.mainId).toBe(0x0a00)
    expect(addData.file.subId).toBe(0x0000)
    expect(addData.file.fileId).toBe(0x00000000)
    expect(addData.blockOffset).toBe(0x00000001)
    expect(addData.blockCount).toBe(blockCount)
    expect(addData.byteCount).toBe(dataSize)
    expect(addData.byteOffset).toBe(128) // blockOffset << 7
    expect(addData.blockDeleteCount).toBe(blockDeleteCount)
    expect(addData.byteDeleteCount).toBe(128) // blockDeleteCount << 7
    expect(addData.data).toHaveLength(dataSize)

    // Verify data content
    for (let i = 0; i < dataSize; i++) {
      expect(addData.data[i]).toBe(i & 0xff)
    }
  })

  it('should handle zero block count', () => {
    const testData = Buffer.alloc(23) // header + blockDeleteCount + 0 data
    testData.writeUInt8(0x00, 0) // reserved[0]
    testData.writeUInt8(0x00, 1) // reserved[1]
    testData.writeUInt8(0x00, 2) // reserved[2]
    testData.writeUInt16BE(0x0a00, 3) // mainId
    testData.writeUInt16BE(0x0000, 5) // subId
    testData.writeUInt32BE(0x00000000, 7) // fileId
    testData.writeUInt32BE(0x00000000, 11) // blockOffset
    testData.writeUInt32BE(0x00000000, 15) // blockCount
    testData.writeUInt32BE(0x00000000, 19) // blockDeleteCount

    const buffer = SmartBuffer.fromBuffer(testData)
    const addData = readSqpkAddData(buffer)

    expect(addData.blockCount).toBe(0)
    expect(addData.byteCount).toBe(0)
    expect(addData.byteOffset).toBe(0)
    expect(addData.blockDeleteCount).toBe(0)
    expect(addData.byteDeleteCount).toBe(0)
    expect(addData.data).toHaveLength(0)
  })

  it('should handle large block counts', () => {
    const blockCount = 0x100 // 256 blocks
    const blockDeleteCount = 0x10 // 16 blocks
    const dataSize = blockCount << 7 // 32768 bytes

    const testData = Buffer.alloc(19 + 4 + dataSize)
    testData.writeUInt8(0xff, 0) // reserved[0]
    testData.writeUInt8(0xff, 1) // reserved[1]
    testData.writeUInt8(0xff, 2) // reserved[2]
    testData.writeUInt16BE(0xffff, 3) // mainId
    testData.writeUInt16BE(0xffff, 5) // subId
    testData.writeUInt32BE(0xffffffff, 7) // fileId
    testData.writeUInt32BE(0x00001000, 11) // blockOffset
    testData.writeUInt32BE(blockCount, 15) // blockCount
    testData.writeUInt32BE(blockDeleteCount, 19) // blockDeleteCount

    // Fill with pattern
    for (let i = 0; i < dataSize; i++) {
      testData.writeUInt8((i * 7) & 0xff, 23 + i)
    }

    const buffer = SmartBuffer.fromBuffer(testData)
    const addData = readSqpkAddData(buffer)

    expect(addData.reserved).toEqual(Buffer.from([0xff, 0xff, 0xff]))
    expect(addData.file.mainId).toBe(0xffff)
    expect(addData.file.subId).toBe(0xffff)
    expect(addData.file.fileId).toBe(0xffffffff)
    expect(addData.blockOffset).toBe(0x00001000)
    expect(addData.blockCount).toBe(blockCount)
    expect(addData.byteCount).toBe(dataSize)
    expect(addData.byteOffset).toBe(0x00080000) // 0x00001000 << 7
    expect(addData.blockDeleteCount).toBe(blockDeleteCount)
    expect(addData.byteDeleteCount).toBe(2048) // 0x10 << 7
    expect(addData.data).toHaveLength(dataSize)

    // Verify data content
    for (let i = 0; i < dataSize; i++) {
      expect(addData.data[i]).toBe((i * 7) & 0xff)
    }
  })
})
