import { createHash, type Hash } from 'node:crypto'
import { type FileHandle, open } from 'node:fs/promises'
import { deflateRawSync } from 'node:zlib'
import { SmartBuffer } from 'smart-buffer'
import { PlatformId } from './interface'
import {
  createSqPackDataHeader,
  createSqPackHeader,
  type SqPackIndexHeader,
  SqPackType,
  sqPackDataHeaderSize,
  sqPackHeaderSize,
  sqPackIndexHeaderSize,
  writeSqPackIndexHeader,
} from './structs/header'
import {
  blockSize,
  FileType,
  type SqPackStandardChunkInfo,
  sqPackDataChunkHeaderSize,
  sqPackStandardChunkInfoSize,
  writeSqPackDataChunkHeader,
  writeSqPackFileInfo,
  writeSqPackStandardChunkInfo,
} from './structs/sqpack-data'
import {
  type Index2HashTableEntry,
  type IndexHashData,
  type IndexHashTableEntry,
  index2HashTableEntrySize,
  indexHashTableEntrySize,
  writeIndex2HashTableEntry,
  writeIndexHashTableEntry,
} from './structs/sqpack-index'
import {
  calculateIndex2Hash,
  calculateIndexHash,
  createEmptySqPackHash,
} from './utils/hash'

export interface SqPackWriterOptions {
  /**
   * Output prefix path (e.g., "path-to/0a0000.win32")
   */
  prefix: string
  /**
   * Platform ID for the SqPack files
   */
  platformId?: PlatformId
  /**
   * Version number for the SqPack files
   */
  version?: number
  /**
   * Compression level for file data (0-9, default: 6)
   */
  compressionLevel?: number
}

export interface FileEntry {
  path: string
  data: Buffer
}

export class SqPackWriter {
  private dataFileId = 0
  private options: SqPackWriterOptions
  private dataHandles: Map<number, FileHandle> = new Map()
  private indexEntries: Map<bigint, IndexHashData> = new Map()
  private index2Entries: Map<number, IndexHashData> = new Map()
  private pos = 0x800
  private hash: Hash

  constructor(options: SqPackWriterOptions) {
    this.options = {
      platformId: PlatformId.Win32,
      version: 2,
      compressionLevel: 6,
      ...options,
    }

    this.hash = createHash('sha1')
  }

  /**
   * Write files to SqPack format
   */
  async addFile(path: string, data: Buffer): Promise<void> {
    let handle = this.dataHandles.get(this.dataFileId)
    if (!handle) {
      const dataPath = `${this.options.prefix}.dat${this.dataFileId}`
      handle = await open(dataPath, 'w')
      this.dataHandles.set(this.dataFileId, handle)
    }

    const { chunks, chunkInfos, blocksWritten } = this.compressData(data)
    const chunkInfoOffset = 0x18
    const fileInfoSize = this.alignToBlockSize(
      chunkInfoOffset + chunkInfos.length * sqPackStandardChunkInfoSize,
    )

    const fileInfo = Buffer.alloc(fileInfoSize)
    const fileInfoBuffer = SmartBuffer.fromBuffer(fileInfo)
    writeSqPackFileInfo(fileInfoBuffer, {
      size: fileInfoSize,
      type: FileType.Standard,
      rawFileSize: data.length,
      numberOfBlocks: blocksWritten,
      usedNumberOfBlocks: blocksWritten,
    })

    // Write chunk info
    fileInfoBuffer.writeUInt32LE(chunkInfos.length)
    for (const chunkInfo of chunkInfos) {
      writeSqPackStandardChunkInfo(fileInfoBuffer, chunkInfo)
    }

    // Append file info
    const { offset } = await this.appendDataFile(fileInfo)

    // Append chunks
    for (const chunk of chunks) {
      await this.appendDataFile(chunk)
    }

    // Add to index
    const indexData: IndexHashData = {
      isSynonym: false,
      dataFileId: this.dataFileId,
      offset,
    }
    this.indexEntries.set(calculateIndexHash(path), indexData)
    this.index2Entries.set(calculateIndex2Hash(path), indexData)
  }

  /**
   * Close writer
   */
  async close(): Promise<void> {
    await this.closeDataFile()
    await this.writeIndex()
    await this.writeIndex2()

    this.dataHandles.clear()
    this.indexEntries.clear()
    this.index2Entries.clear()
  }

  /**
   * Compress data into chunks
   */
  private compressData(data: Buffer) {
    const chunkInfos: SqPackStandardChunkInfo[] = []
    const chunks: Buffer[] = []
    let blocksWritten = 0

    const chunkRawDataSize = 16000
    const numChunks = Math.ceil(data.length / chunkRawDataSize)
    for (let i = 0; i < numChunks; i++) {
      const dataOffset = i * chunkRawDataSize
      const dataEnd = Math.min(dataOffset + chunkRawDataSize, data.length)

      const rawData = data.subarray(dataOffset, dataEnd)
      const deflatedData = deflateRawSync(rawData, {
        level: this.options.compressionLevel,
      })

      chunkInfos.push({
        offset: blocksWritten * blockSize,
        compressedSize: deflatedData.length,
        uncompressedSize: rawData.length,
      })

      const blockCount = this.getBlockCount(
        deflatedData.length + sqPackDataChunkHeaderSize,
      )
      const chunkSize = blockCount * blockSize
      const alignedChunk = Buffer.alloc(chunkSize)

      const smartBuffer = SmartBuffer.fromBuffer(alignedChunk)
      writeSqPackDataChunkHeader(smartBuffer, {
        size: sqPackDataChunkHeaderSize,
        u1: 0,
        compressedSize: deflatedData.length,
        uncompressedSize: rawData.length,
      })

      smartBuffer.writeBuffer(deflatedData)
      chunks.push(alignedChunk)
      blocksWritten += blockCount
    }

    return {
      chunks,
      chunkInfos,
      blocksWritten,
    }
  }

  /**
   * Append data to data file
   */
  private async appendDataFile(data: Buffer) {
    if (data.length % blockSize !== 0) {
      throw new Error('Data size must be a multiple of block size')
    }

    let handle = this.dataHandles.get(this.dataFileId)
    if (!handle) {
      const dataPath = `${this.options.prefix}.dat${this.dataFileId}`
      handle = await open(dataPath, 'w')
      this.dataHandles.set(this.dataFileId, handle)
    }

    const offset = this.pos
    await handle.write(data, 0, data.length, offset)
    this.hash.update(data)
    this.pos += data.length

    return { offset, size: data.length }
  }

  /**
   * Write headers and close data file
   */
  private async closeDataFile(): Promise<void> {
    const handle = this.dataHandles.get(this.dataFileId)
    if (!handle) {
      return
    }

    const headerSize = sqPackHeaderSize + sqPackDataHeaderSize
    const buffer = Buffer.alloc(headerSize)
    const smartBuffer = SmartBuffer.fromBuffer(buffer)

    const date = new Date()

    createSqPackHeader(smartBuffer, {
      platformId: this.options.platformId ?? PlatformId.Win32,
      type: SqPackType.Data,
      // yyyymmdd
      buildDate:
        date.getFullYear() * 10000 + date.getMonth() * 100 + date.getDate(),
      // hhmmss00
      buildTime:
        date.getHours() * 1000000 +
        date.getMinutes() * 10000 +
        date.getSeconds() * 100,
    })

    createSqPackDataHeader(smartBuffer, {
      blockCount: this.getBlockCount(this.pos - headerSize),
      maxDataSize: 2e9, // 2GB
      fileHash: this.hash.digest(),
    })

    await handle.write(buffer, 0, headerSize, 0)
    await handle.close()
  }

  /**
   * Write index file
   */
  private async writeIndex(): Promise<void> {
    const indexPath = `${this.options.prefix}.index`

    // Calculate index data size
    const indexDataSize = this.indexEntries.size * indexHashTableEntrySize
    const indexDataBuffer = SmartBuffer.fromSize(indexDataSize)
    for (const [hash, indexData] of this.indexEntries) {
      const entry = hash as bigint

      const indexEntry: IndexHashTableEntry = {
        hash: entry,
        ...indexData,
      }

      writeIndexHashTableEntry(indexDataBuffer, indexEntry)
    }

    await this.writeIndexFile(indexPath, {
      numberOfDataFile: this.dataHandles.size,
      indexData: indexDataBuffer.toBuffer(),
    })
  }

  /**
   * Write index2 file
   */
  private async writeIndex2(): Promise<void> {
    const indexPath = `${this.options.prefix}.index2`

    // Calculate index data size
    const indexDataSize = this.index2Entries.size * index2HashTableEntrySize
    const indexDataBuffer = SmartBuffer.fromSize(indexDataSize)
    for (const [hash, indexData] of this.index2Entries) {
      const entry = hash as number

      const indexEntry: Index2HashTableEntry = {
        hash: entry,
        ...indexData,
      }

      writeIndex2HashTableEntry(indexDataBuffer, indexEntry)
    }

    await this.writeIndexFile(indexPath, {
      numberOfDataFile: this.dataHandles.size,
      indexData: indexDataBuffer.toBuffer(),
    })
  }

  private async writeIndexFile(
    path: string,
    {
      numberOfDataFile,
      indexData,
      synonymData,
      emptyBlockData,
      dirIndexData,
    }: {
      numberOfDataFile: number
      indexData?: Buffer
      synonymData?: Buffer
      emptyBlockData?: Buffer
      dirIndexData?: Buffer
    },
  ) {
    const headerSize = sqPackHeaderSize + sqPackIndexHeaderSize
    const buffer = SmartBuffer.fromSize(headerSize)

    // write sqpack header
    createSqPackHeader(buffer, {
      platformId: this.options.platformId ?? PlatformId.Win32,
      type: SqPackType.Index,
      // build date and time are not used for index files
      buildDate: 0,
      buildTime: 0,
    })

    const indexHeader: SqPackIndexHeader = {
      size: sqPackIndexHeaderSize,
      version: this.options.version ?? 2,
      indexDataOffset: headerSize,
      indexDataSize: indexData?.length ?? 0,
      indexDataHash: createEmptySqPackHash(),
      numberOfDataFile,
      synonymOffset: 0,
      synonymSize: synonymData?.length ?? 0,
      synonymHash: createEmptySqPackHash(),
      emptyBlockOffset: 0,
      emptyBlockSize: emptyBlockData?.length ?? 0,
      emptyBlockHash: createEmptySqPackHash(),
      dirIndexOffset: 0,
      dirIndexSize: dirIndexData?.length ?? 0,
      dirIndexHash: createEmptySqPackHash(),
    }

    indexHeader.synonymOffset =
      indexHeader.indexDataOffset + indexHeader.indexDataSize
    indexHeader.emptyBlockOffset =
      indexHeader.synonymOffset + indexHeader.synonymSize
    indexHeader.dirIndexOffset =
      indexHeader.emptyBlockOffset + indexHeader.emptyBlockSize

    writeSqPackIndexHeader(buffer, indexHeader)

    const handle = await open(path, 'w')
    await handle.write(buffer.toBuffer(), 0, headerSize)
    if (indexData) {
      await handle.write(indexData, 0, indexData.length)
    }
    if (synonymData) {
      await handle.write(synonymData, 0, synonymData.length)
    }
    if (emptyBlockData) {
      await handle.write(emptyBlockData, 0, emptyBlockData.length)
    }
    if (dirIndexData) {
      await handle.write(dirIndexData, 0, dirIndexData.length)
    }
    await handle.close()
  }

  private getBlockCount(dataSize: number) {
    return Math.ceil(dataSize / blockSize)
  }

  private alignToBlockSize(dataSize: number) {
    return this.getBlockCount(dataSize) * blockSize
  }
}
