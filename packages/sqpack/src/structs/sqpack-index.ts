import type { SmartBuffer } from 'smart-buffer'
import { mergeIndexHash } from '../utils/hash'

export interface IndexHashData {
  isSynonym: boolean
  dataFileId: number // 3 bits
  offset: number // 28 bits
  padding: number // 32 bits
}

export interface IndexHashTableEntry extends IndexHashData {
  hash: bigint // 64-bit hash (directoryHash + filenameHash)
  fileHash: number // 32-bit hash (directoryHash)
  dirHash: number // 32-bit hash (filenameHash)
}

export interface Index2HashTableEntry extends IndexHashData {
  hash: number // 32-bit hash (entire path)
}

const parseData = (data: number): IndexHashData => {
  const isSynonym = data % 2 === 1
  const dataFileId = (data % 8) >> 1
  const offset = (data - (data % 16)) * 8
  const padding = data % 2

  return { isSynonym, dataFileId, offset, padding }
}

/**
 * Index hash table entry (index files)
 * @see https://xiv.dev/data-files/sqpack#reading-index
 */
export const readIndexHashTableEntry = (
  buffer: SmartBuffer,
): IndexHashTableEntry => {
  const fileHash = buffer.readUInt32LE()
  const dirHash = buffer.readUInt32LE()
  const data = buffer.readUInt32LE()
  buffer.readOffset += 4

  return {
    hash: mergeIndexHash(dirHash, fileHash),
    fileHash,
    dirHash,
    ...parseData(data),
  }
}

/**
 * Index2 hash table entry (index2 files)
 * @see https://xiv.dev/data-files/sqpack#reading-index2
 */
export const readIndex2HashTableEntry = (
  buffer: SmartBuffer,
): Index2HashTableEntry => {
  const hash = buffer.readUInt32LE()
  const data = buffer.readUInt32LE()

  return {
    hash,
    ...parseData(data),
  }
}
