import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SmartBuffer } from 'smart-buffer'
import { describe, expect, it } from 'vitest'
import {
  FileKind,
  HeaderKind,
  readSqpkHeaderUpdate,
} from '../../src/structs/sqpk-header-update'

describe('SqpkHeaderUpdate struct', () => {
  const fixturePath = join(__dirname, '../__fixtures__/sqpk-hdd-45.bin')
  const fixtureData = readFileSync(fixturePath)

  it('should parse SqpkHeaderUpdate correctly from fixture', () => {
    const buffer = SmartBuffer.fromBuffer(fixtureData.subarray(5))
    const headerUpdate = readSqpkHeaderUpdate(buffer)

    expect(headerUpdate.file).toEqual({
      fileId: 0,
      mainId: 10,
      subId: 0,
    })
    expect(headerUpdate.data.length).toBe(1024)
    expect(headerUpdate.fileKind).toBe(68)
    expect(headerUpdate.headerKind).toBe(68)
  })

  it('should handle FileKind enum values', () => {
    expect(FileKind.Dat).toBe(68) // 'D'
    expect(FileKind.Index).toBe(73) // 'I'
  })

  it('should handle HeaderKind enum values', () => {
    expect(HeaderKind.Version).toBe(86) // 'V'
    expect(HeaderKind.Data).toBe(68) // 'D'
    expect(HeaderKind.Index).toBe(73) // 'I'
  })

  it('should parse test data with known values', () => {
    // Create test data with known values
    const testData = Buffer.alloc(1035) // 3 + 8 + 1024
    testData.writeUInt8(FileKind.Dat, 0) // fileKind
    testData.writeUInt8(HeaderKind.Data, 1) // headerKind
    testData.writeUInt16BE(0x0a00, 3) // mainId
    testData.writeUInt16BE(0x0000, 5) // subId
    testData.writeUInt32BE(0x00000000, 7) // fileId
    // Fill the rest with test data
    for (let i = 11; i < 1035; i++) {
      testData.writeUInt8(i & 0xff, i)
    }

    const buffer = SmartBuffer.fromBuffer(testData)
    const headerUpdate = readSqpkHeaderUpdate(buffer)

    expect(headerUpdate.fileKind).toBe(FileKind.Dat)
    expect(headerUpdate.headerKind).toBe(HeaderKind.Data)
    expect(headerUpdate.file.mainId).toBe(0x0a00)
    expect(headerUpdate.file.subId).toBe(0x0000)
    expect(headerUpdate.file.fileId).toBe(0x00000000)
    expect(headerUpdate.data).toHaveLength(1024)

    // Check that the data buffer contains the expected values
    for (let i = 0; i < 1024; i++) {
      expect(headerUpdate.data[i]).toBe((i + 11) & 0xff)
    }
  })

  it('should handle Index file kind', () => {
    const testData = Buffer.alloc(1035)
    testData.writeUInt8(FileKind.Index, 0) // fileKind
    testData.writeUInt8(HeaderKind.Index, 1) // headerKind
    testData.writeUInt16BE(0x0a00, 3) // mainId
    testData.writeUInt16BE(0x0000, 5) // subId
    testData.writeUInt32BE(0x00000001, 7) // fileId

    const buffer = SmartBuffer.fromBuffer(testData)
    const headerUpdate = readSqpkHeaderUpdate(buffer)

    expect(headerUpdate.fileKind).toBe(FileKind.Index)
    expect(headerUpdate.headerKind).toBe(HeaderKind.Index)
    expect(headerUpdate.file.fileId).toBe(0x00000001)
  })

  it('should handle Version header kind', () => {
    const testData = Buffer.alloc(1034)
    testData.writeUInt8(FileKind.Dat, 0) // fileKind
    testData.writeUInt8(HeaderKind.Version, 1) // headerKind
    testData.writeUInt16BE(0x0a00, 3) // mainId
    testData.writeUInt16BE(0x0000, 5) // subId
    testData.writeUInt32BE(0x00000000, 7) // fileId

    const buffer = SmartBuffer.fromBuffer(testData)
    const headerUpdate = readSqpkHeaderUpdate(buffer)

    expect(headerUpdate.fileKind).toBe(FileKind.Dat)
    expect(headerUpdate.headerKind).toBe(HeaderKind.Version)
  })
})
