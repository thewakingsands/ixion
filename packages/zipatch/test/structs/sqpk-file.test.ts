import { SmartBuffer } from 'smart-buffer'
import { describe, expect, it } from 'vitest'
import {
  getSqpkExpansion,
  getSqpkFileName,
  getSqpkFilePath,
  readSqpkFile,
} from '../../src/structs/sqpk-file'

describe('SqpkFile struct', () => {
  it('should parse SqpkFile correctly from test data', () => {
    // Create test data for SqpkFile (8 bytes)
    const testData = Buffer.alloc(8)
    testData.writeUInt16BE(0x0a00, 0) // mainId
    testData.writeUInt16BE(0x0000, 2) // subId
    testData.writeUInt32BE(0x00000000, 4) // fileId

    const buffer = SmartBuffer.fromBuffer(testData)
    const file = readSqpkFile(buffer)

    expect(file.mainId).toBe(0x0a00)
    expect(file.subId).toBe(0x0000)
    expect(file.fileId).toBe(0x00000000)
  })

  it('should generate correct file names', () => {
    const file = { mainId: 0x0a00, subId: 0x0000, fileId: 0 }

    expect(getSqpkFileName(file, false)).toBe('a000000.win32.dat0')
    expect(getSqpkFileName(file, true)).toBe('a000000.win32.index0')

    const fileWithId = { mainId: 0x0a00, subId: 0x0000, fileId: 1 }
    expect(getSqpkFileName(fileWithId, false)).toBe('a000000.win32.dat1')
    expect(getSqpkFileName(fileWithId, true)).toBe('a000000.win32.index1')
  })

  it('should calculate expansion correctly', () => {
    const baseFile = { mainId: 0x0a00, subId: 0x0000, fileId: 0 }
    expect(getSqpkExpansion(baseFile)).toBe(0) // ffxiv

    const ex1File = { mainId: 0x0a00, subId: 0x0100, fileId: 0 }
    expect(getSqpkExpansion(ex1File)).toBe(1) // ex1

    const ex2File = { mainId: 0x0a00, subId: 0x0200, fileId: 0 }
    expect(getSqpkExpansion(ex2File)).toBe(2) // ex2
  })

  it('should generate correct file paths', () => {
    const ffxivFile = { mainId: 0x0a00, subId: 0x0000, fileId: 0 }
    expect(getSqpkFilePath(ffxivFile, false)).toBe(
      'sqpack/ffxiv/a000000.win32.dat0',
    )
    expect(getSqpkFilePath(ffxivFile, true)).toBe(
      'sqpack/ffxiv/a000000.win32.index0',
    )

    const ex1File = { mainId: 0x0a00, subId: 0x0100, fileId: 0 }
    expect(getSqpkFilePath(ex1File, false)).toBe(
      'sqpack/ex1/a000100.win32.dat0',
    )
    expect(getSqpkFilePath(ex1File, true)).toBe(
      'sqpack/ex1/a000100.win32.index0',
    )
  })

  it('should handle edge cases', () => {
    const maxFile = { mainId: 0xffff, subId: 0xffff, fileId: 0xffffffff }
    expect(getSqpkFileName(maxFile, false)).toBe('ffffffff.win32.dat4294967295')
    expect(getSqpkExpansion(maxFile)).toBe(0xff) // 255
  })
})
