import { type FileHandle, open, readFile } from 'node:fs/promises'
import { inflateRawSync } from 'node:zlib'
import { SmartBuffer } from 'smart-buffer'
import type { SqPackFileIndex } from './interface'
import {
  readSqPackHeader,
  readSqPackIndexHeader,
  validateSqPackMagic,
} from './structs/header'
import {
  blockSize,
  FileType,
  readSqPackDataBlockHeader,
  readSqPackFileInfo,
  readSqPackStandardBlockInfo,
  type SqPackFileInfo,
} from './structs/sqpack-data'
import {
  type IndexHashData,
  readIndex2HashTableEntry,
  readIndexHashTableEntry,
} from './structs/sqpack-index'
import { calculateIndex2Hash, calculateIndexHash } from './utils/hash'

export interface SqPackReaderOptions {
  /**
   * path-to/0a0000.win32
   */
  prefix: string
  /**
   * Use index2 file instead of index file
   */
  useIndex2?: boolean
}

export class SqPackReader {
  private dataHandles: Map<number, FileHandle> = new Map()
  private indexEntries: Map<number | bigint, IndexHashData> = new Map()
  private options: SqPackReaderOptions

  constructor(options: SqPackReaderOptions) {
    this.options = options
  }

  /**
   * Open a SqPack repository
   */
  static async open(options: SqPackReaderOptions): Promise<SqPackReader> {
    const reader = new SqPackReader(options)
    await reader.loadIndex()
    return reader
  }

  /**
   * Load index file and build hash table
   */
  private async loadIndex(): Promise<void> {
    const ext = this.options.useIndex2 ? 'index2' : 'index'
    const indexPath = `${this.options.prefix}.${ext}`

    const data = await readFile(indexPath)
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
    const entrySize = this.options.useIndex2 ? 8 : 16 // Index2: 8 bytes, Index: 16 bytes

    while (entryBuffer.remaining() >= entrySize) {
      const entry = this.options.useIndex2
        ? readIndex2HashTableEntry(entryBuffer)
        : readIndexHashTableEntry(entryBuffer)

      this.indexEntries.set(entry.hash, entry)
    }
  }

  /**
   * Get file information by path
   */
  async getFileIndex(filePath: string): Promise<SqPackFileIndex | null> {
    const hash = this.options.useIndex2
      ? calculateIndex2Hash(filePath)
      : calculateIndexHash(filePath)

    const entry = this.indexEntries.get(hash)
    if (!entry) {
      return null
    }

    return {
      path: filePath,
      dataFileId: entry.dataFileId,
      offset: entry.offset,
    }
  }

  /**
   * Read file data
   */
  async readFile(filePath: string): Promise<Buffer | null> {
    const fileIndex = await this.getFileIndex(filePath)
    if (!fileIndex) {
      return null
    }

    // Get or open data file handle
    let handle = this.dataHandles.get(fileIndex.dataFileId)
    if (!handle) {
      const dataPath = `${this.options.prefix}.dat${fileIndex.dataFileId}`
      handle = await open(dataPath, 'r')
      this.dataHandles.set(fileIndex.dataFileId, handle)
    }

    const buffer = Buffer.alloc(blockSize) // File header size

    // Read file header
    await handle.read(buffer, 0, blockSize, fileIndex.offset)
    const fileHeader = readSqPackFileInfo(SmartBuffer.fromBuffer(buffer))
    if (fileHeader.rawFileSize === 0) {
      return null
    }

    if (fileHeader.type === FileType.Standard) {
      return this.readStandardFile(handle, fileIndex.offset, fileHeader)
    }

    // TODO: Handle other file types
    return null
  }

  async readStandardFile(
    handle: FileHandle,
    offset: number,
    fileInfo: SqPackFileInfo,
  ): Promise<Buffer | null> {
    // Header can be larger than blockSize, so we need to read it again
    const headerBuffer = Buffer.alloc(fileInfo.size)
    await handle.read(headerBuffer, 0, fileInfo.size, offset)

    // Read blocks
    const smartBuffer = SmartBuffer.fromBuffer(headerBuffer)
    smartBuffer.readOffset = 0x14 // skip 5 uint32le
    const chunkCount = smartBuffer.readUInt32LE()
    const chunks: Buffer[] = []

    let bytesRead = 0
    for (let i = 0; i < chunkCount; i++) {
      const chunkInfo = readSqPackStandardBlockInfo(smartBuffer)
      const chunkOffset = offset + fileInfo.size + chunkInfo.offset
      const chunkHeaderBuffer = Buffer.alloc(16)
      await handle.read(chunkHeaderBuffer, 0, 16, chunkOffset)
      const chunkHeader = readSqPackDataBlockHeader(
        SmartBuffer.fromBuffer(chunkHeaderBuffer),
      )
      // chunkInfo.compressedSize is aligned to blockSize
      if (chunkHeader.compressedSize > chunkInfo.compressedSize) {
        throw new Error('Invalid chunk compressed size')
      }
      if (chunkHeader.uncompressedSize !== chunkInfo.uncompressedSize) {
        throw new Error('Invalid chunk uncompressed size')
      }
      const chunk = Buffer.alloc(chunkInfo.compressedSize)
      await handle.read(
        chunk,
        0,
        chunkInfo.compressedSize,
        chunkOffset + chunkHeader.size,
      )

      const inflated = inflateRawSync(chunk)
      if (inflated.length !== chunkInfo.uncompressedSize) {
        throw new Error('Invalid file size')
      }

      chunks.push(inflated)
      bytesRead += inflated.length
    }

    if (bytesRead !== fileInfo.rawFileSize) {
      throw new Error('Invalid file size')
    }

    return Buffer.concat(chunks)
  }

  /**
   * Check if a file exists
   */
  async hasFile(filePath: string): Promise<boolean> {
    const fileInfo = await this.getFileIndex(filePath)
    return fileInfo !== null
  }

  /**
   * Close all file handles
   */
  async close(): Promise<void> {
    for (const handle of this.dataHandles.values()) {
      await handle.close()
    }

    this.dataHandles.clear()
    this.indexEntries.clear()
  }
}
