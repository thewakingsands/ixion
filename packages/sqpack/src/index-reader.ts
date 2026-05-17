import { SmartBuffer } from 'smart-buffer'
import {
  readSqPackHeader,
  readSqPackIndexHeader,
  validateSqPackMagic,
} from './structs/header'
import {
  type IndexDirectoryHashTableEntry,
  type IndexHashData,
  index2HashTableEntrySize,
  indexDirectoryHashTableEntrySize,
  indexHashTableEntrySize,
  readIndex2HashTableEntry,
  readIndexDirectoryHashTableEntry,
  readIndexHashTableEntry,
} from './structs/sqpack-index'

export interface ReadIndexEntriesResult {
  indexEntries: Map<number | bigint, IndexHashData>
  dirIndexEntries: Map<number, IndexDirectoryHashTableEntry>
}

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

  const dirIndexEntries = new Map<number, IndexDirectoryHashTableEntry>()
  if (!useIndex2 && indexHeader.dirIndexSize > 0) {
    const dirIndexBuffer = SmartBuffer.fromBuffer(
      data.subarray(
        indexHeader.dirIndexOffset,
        indexHeader.dirIndexOffset + indexHeader.dirIndexSize,
      ),
    )

    while (dirIndexBuffer.remaining() >= indexDirectoryHashTableEntrySize) {
      const entry = readIndexDirectoryHashTableEntry(dirIndexBuffer)
      dirIndexEntries.set(entry.dirHash, entry)
    }
  }

  return {
    indexEntries,
    dirIndexEntries,
  }
}
