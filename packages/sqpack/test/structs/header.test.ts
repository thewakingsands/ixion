import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
import {
  calculateSqPackHash,
  parseSqPackHashFromHex,
} from '../../src/utils/hash'

describe('Header Structs', () => {
  const fixtureBuffer = readFileSync(
    join(__dirname, '../__fixtures__/0a0000.win32.index'),
  )

  describe('SqPackHeader', () => {
    const headerBuffer = fixtureBuffer.subarray(0, 0x400)
    const parsed: SqPackHeader = {
      magic: 'SqPack\0\0',
      platformId: PlatformId.Win32,
      size: 0x400,
      version: 1,
      type: 2,
      buildDate: 0,
      buildTime: 0,
    }

    it('should read SqPack header correctly', () => {
      const buffer = SmartBuffer.fromBuffer(headerBuffer)
      const header = readSqPackHeader(buffer)

      expect(header).toEqual(parsed)
    })

    it('should write SqPack header correctly', () => {
      const buffer = new SmartBuffer()
      writeSqPackHeader(buffer, parsed)

      expect(buffer.toBuffer()).toEqual(headerBuffer)
    })
  })

  describe('SqPackIndexHeader', () => {
    const headerBuffer = fixtureBuffer.subarray(0x400, 0x800)
    const parsed: SqPackIndexHeader = {
      size: 0x400,
      version: 1,
      indexDataOffset: 0x800,
      indexDataSize: 245456,
      indexDataHash: parseSqPackHashFromHex(
        '32e073184be459326aae8fdb23aca64a9777d447',
      ),
      numberOfDataFile: 1,
      synonymOffset: 247504,
      synonymSize: 256,
      synonymHash: parseSqPackHashFromHex(
        '5e9d28d0485da838f62d713c3db6961a6e13d83b',
      ),
      emptyBlockOffset: 247760,
      emptyBlockSize: 5968,
      emptyBlockHash: parseSqPackHashFromHex(
        '55ad3ada42881bd63814f289cc369189b12ab1fb',
      ),
      dirIndexOffset: 253728,
      dirIndexSize: 1728,
      dirIndexHash: parseSqPackHashFromHex(
        '05bfde7c0d9573e9c98663bec9924084ca0f7875',
      ),
    }

    it('should read SqPack index header correctly', () => {
      const buffer = SmartBuffer.fromBuffer(headerBuffer)
      const header = readSqPackIndexHeader(buffer)

      expect(header).toEqual(parsed)
    })

    it('should write SqPack index header correctly', () => {
      const buffer = new SmartBuffer()
      writeSqPackIndexHeader(buffer, parsed)

      expect(buffer.toBuffer()).toEqual(headerBuffer)
    })
  })

  describe('validateSqPackMagic', () => {
    it('should validate correct magic', () => {
      expect(validateSqPackMagic('SqPack\0\0')).toBe(true)
    })
  })

  it('test index hash', () => {
    const data = fixtureBuffer.subarray(0x800, 0x800 + 245456)
    console.log(data.length)
    console.log(calculateSqPackHash(data).toString('hex'))
  })
})
