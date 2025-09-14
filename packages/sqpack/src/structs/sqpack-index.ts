import type { SmartBuffer } from 'smart-buffer'
import { mergeIndexHash } from '../utils/hash'

export interface IndexHashData {
  isSynonym: boolean
  dataFileId: number
  offset: number
}

export interface IndexHashTableEntry extends IndexHashData {
  hash: bigint // 64-bit hash (directoryHash + filenameHash)
}

export interface Index2HashTableEntry extends IndexHashData {
  hash: number // 32-bit hash (entire path)
}

const parseData = (data: number): IndexHashData => {
  const isSynonym = data % 2 === 1
  const dataFileId = (data % 8) >> 1
  const offset = (data - (data % 16)) * 8

  return { isSynonym, dataFileId, offset }
}

/**
 * Encode index data into the format used in index files
 */
const encodeIndexData = (data: IndexHashData): number => {
  const offset = Math.floor(data.offset / 8)
  const dataFileId = (data.dataFileId % 8) * 2
  const isSynonym = data.isSynonym ? 1 : 0

  return offset - (offset % 16) + dataFileId + isSynonym
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

/**
 * Write index hash table entry (index files)
 */
export const writeIndexHashTableEntry = (
  buffer: SmartBuffer,
  entry: IndexHashTableEntry,
): void => {
  buffer.writeBigUInt64LE(entry.hash)
  buffer.writeUInt32LE(encodeIndexData(entry))
  buffer.writeUInt32LE(0) // Padding
}

/**
 * Write index2 hash table entry (index2 files)
 */
export const writeIndex2HashTableEntry = (
  buffer: SmartBuffer,
  entry: Index2HashTableEntry,
): void => {
  buffer.writeUInt32LE(entry.hash)
  buffer.writeUInt32LE(encodeIndexData(entry))
}
