import { describe, expect, it } from 'vitest'
import {
  calculateIndex2Hash,
  calculateIndexHash,
  crc32,
} from '../src/utils/hash'

describe('Hash Utilities', () => {
  describe('crc32', () => {
    it('should calculate CRC32 hash correctly', () => {
      const data = Buffer.from('test')
      const hash = crc32(data)
      expect(hash).toBe(0x278081f3)
    })

    it('should calculate CRC32 hash for string', () => {
      const hash = crc32('test')
      expect(hash).toBe(0x278081f3)
    })

    it('should handle empty data', () => {
      const hash = crc32('')
      expect(hash).toBe(0xffffffff)
    })
  })

  describe('calculateIndexHash', () => {
    it('should calculate index hash for file path', () => {
      const path = 'exd/root.exl'
      const hash = calculateIndexHash(path)

      expect(hash).toEqual({
        dirHash: 0xe39b7999,
        fileHash: 0x51b57ebc,
      })
    })

    it('should handle paths with no directory', () => {
      expect(() => calculateIndexHash('filename.txt')).toThrow(
        'Invalid file path',
      )
    })
  })

  describe('calculateIndex2Hash', () => {
    it('should calculate index2 hash for file path', () => {
      const path = 'exd/root.exl'
      const hash = calculateIndex2Hash(path)

      // Should be a 32-bit number
      expect(hash).toBe(0x3e16266c)
    })
  })
})
