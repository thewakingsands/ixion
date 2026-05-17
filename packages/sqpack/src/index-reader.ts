import { SmartBuffer } from 'smart-buffer'
import {
  readSqPackHeader,
  readSqPackIndexHeader,
  validateSqPackMagic,
} from './structs/header'
import {
  type IndexHashData,
  index2HashTableEntrySize,
  indexHashTableEntrySize,
  readIndex2HashTableEntry,
  readIndexHashTableEntry,
} from './structs/sqpack-index'

export function readIndexEntries(data: Buffer, useIndex2: boolean) {
  const buffer = SmartBuffer.fromBuffer(data)
  const sqPackHeader = readSqPackHeader(buffer)

  if (!validateSqPackMagic(sqPackHeader.magic)) {
    throw new Error('Invalid SqPack magic')
  }

  // Skip to index data
  buffer.readOffset = sqPackHeader.size
  const indexHeader = readSqPackIndexHeader(buffer)

  // Read index entries
  const indexDataBuffer = data.subarray(
    indexHeader.indexDataOffset,
    indexHeader.indexDataOffset + indexHeader.indexDataSize,
  )
  const entryBuffer = SmartBuffer.fromBuffer(indexDataBuffer)
  const entrySize = useIndex2
    ? index2HashTableEntrySize
    : indexHashTableEntrySize

  const indexEntries: Map<number | bigint, IndexHashData> = new Map()
  while (entryBuffer.remaining() >= entrySize) {
    const entry = useIndex2
      ? readIndex2HashTableEntry(entryBuffer)
      : readIndexHashTableEntry(entryBuffer)

    indexEntries.set(entry.hash, entry)
  }

  return indexEntries
}
