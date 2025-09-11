import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SmartBuffer } from 'smart-buffer'
import { describe, expect, it } from 'vitest'
import {
  getBlockLength,
  readSqpkDataHeader,
} from '../../src/structs/sqpk-data-header'

describe('SqpkDataHeader struct', () => {
  const fixturePath = join(__dirname, '../__fixtures__/sqpk-a-43.bin')
  const fixtureData = readFileSync(fixturePath)

  it('should parse SqpkDataHeader correctly from fixture', () => {
    const buffer = SmartBuffer.fromBuffer(fixtureData.subarray(5))
    const header = readSqpkDataHeader(buffer)

    expect(header).toEqual({
      blockCount: 29,
      blockOffset: 777801,
      byteCount: 3712,
      byteOffset: 99558528,
      file: {
        fileId: 0,
        mainId: 10,
        subId: 0,
      },
      reserved: Buffer.alloc(3),
    })
  })

  it('should calculate block length correctly', () => {
    expect(getBlockLength(0)).toBe(0)
    expect(getBlockLength(1)).toBe(128) // 1 << 7
    expect(getBlockLength(2)).toBe(256) // 2 << 7
    expect(getBlockLength(10)).toBe(1280) // 10 << 7
    expect(getBlockLength(0x100)).toBe(32768) // 256 << 7
  })

  it('should handle test data with non-zero block count', () => {
    // Create test data with non-zero block count
    const testData = Buffer.alloc(19) // 3 (reserved) + 8 (SqpkFile) + 4 (blockOffset) + 4 (blockCount)
    testData.writeUInt8(0x00, 0) // reserved[0]
    testData.writeUInt8(0x00, 1) // reserved[1]
    testData.writeUInt8(0x00, 2) // reserved[2]
    testData.writeUInt16BE(0x0a00, 3) // mainId
    testData.writeUInt16BE(0x0000, 5) // subId
    testData.writeUInt32BE(0x00000000, 7) // fileId
    testData.writeUInt32BE(0x00000001, 11) // blockOffset
    testData.writeUInt32BE(0x00000010, 15) // blockCount

    const buffer = SmartBuffer.fromBuffer(testData)
    const header = readSqpkDataHeader(buffer)

    expect(header.reserved).toEqual(Buffer.from([0x00, 0x00, 0x00]))
    expect(header.file.mainId).toBe(0x0a00)
    expect(header.file.subId).toBe(0x0000)
    expect(header.file.fileId).toBe(0x00000000)
    expect(header.blockOffset).toBe(0x00000001)
    expect(header.blockCount).toBe(0x00000010)
    expect(header.byteCount).toBe(2048) // 16 << 7
    expect(header.byteOffset).toBe(128) // 1 << 7
  })

  it('should handle edge cases', () => {
    const testData = Buffer.alloc(19)
    testData.writeUInt8(0xff, 0) // reserved[0]
    testData.writeUInt8(0xff, 1) // reserved[1]
    testData.writeUInt8(0xff, 2) // reserved[2]
    testData.writeUInt16BE(0xffff, 3) // mainId
    testData.writeUInt16BE(0xffff, 5) // subId
    testData.writeUInt32BE(0xffffffff, 7) // fileId
    testData.writeUInt32BE(0xffffffff, 11) // blockOffset
    testData.writeUInt32BE(0xffffffff, 15) // blockCount

    const buffer = SmartBuffer.fromBuffer(testData)
    const header = readSqpkDataHeader(buffer)

    expect(header.reserved).toEqual(Buffer.from([0xff, 0xff, 0xff]))
    expect(header.file.mainId).toBe(0xffff)
    expect(header.file.subId).toBe(0xffff)
    expect(header.file.fileId).toBe(0xffffffff)
    expect(header.blockOffset).toBe(0xffffffff)
    expect(header.blockCount).toBe(0xffffffff)
    expect(header.byteCount).toBe(0xffffffff * 128) // 0xFFFFFFFF << 7 in JavaScript
    expect(header.byteOffset).toBe(0xffffffff * 128) // 0xFFFFFFFF << 7 in JavaScript
  })
})
