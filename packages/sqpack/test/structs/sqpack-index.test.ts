import { SmartBuffer } from 'smart-buffer'
import { describe, expect, it } from 'vitest'
import {
  type IndexHashData,
  readIndex2HashTableEntry,
  readIndexHashTableEntry,
  writeIndex2HashTableEntry,
  writeIndexHashTableEntry,
} from '../../src/structs/sqpack-index'
import { calculateIndex2Hash, calculateIndexHash } from '../../src/utils/hash'

describe('SqPack Index Structs', () => {
  const data: IndexHashData = {
    isSynonym: true,
    dataFileId: 3,
    offset: 80000,
  }
  const testFile = 'exd/root.exl'

  describe('IndexHashTableEntry', () => {
    const indexHash = calculateIndexHash(testFile)
    it('should round-trip read and write correctly', () => {
      const buffer = new SmartBuffer()
      writeIndexHashTableEntry(buffer, {
        hash: indexHash,
        ...data,
      })

      const entry = readIndexHashTableEntry(buffer)
      expect(entry).toEqual({
        hash: indexHash,
        ...data,
      })
    })
  })

  describe('Index2HashTableEntry', () => {
    const indexHash = calculateIndex2Hash(testFile)
    it('should round-trip read and write correctly', () => {
      const buffer = new SmartBuffer()
      writeIndex2HashTableEntry(buffer, {
        hash: indexHash,
        ...data,
      })

      const entry = readIndex2HashTableEntry(buffer)
      expect(entry).toEqual({
        hash: indexHash,
        ...data,
      })
    })
  })
})
