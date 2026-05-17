import { open, readFile } from 'node:fs/promises'
import { inflateRawSync } from 'node:zlib'
import $debug from 'debug'
import { SmartBuffer } from 'smart-buffer'
import { readIndexEntries } from './index-reader'
import type { SqPackFileIndex } from './interface'
import {
  blockSize,
  FileType,
  readSqPackDataChunkHeader,
  readSqPackFileInfo,
  readSqPackStandardChunkInfo,
  type SqPackFileInfo,
  type SqPackStandardChunkInfo,
} from './structs/sqpack-data'
import type { IndexHashData } from './structs/sqpack-index'
import {
  readSqPackTextureChunkInfo,
  type SqPackTextureChunkInfo,
  sqPackTextureHeaderSize,
} from './structs/texture'
import { calculateIndex2Hash, calculateIndexHash } from './utils/hash'

const debug = $debug('ixion:sqpack:reader')
const uncompressedChunk = 32000

export interface SqPackFileReader {
  read<T extends NodeJS.ArrayBufferView>(
    buffer: T,
    offset?: number,
    length?: number,
    position?: number,
  ): Promise<unknown>
  close(): Promise<unknown>
}

export type SqPackFileOpenHandler = (path: string) => Promise<SqPackFileReader>

const fsOpenHandler: SqPackFileOpenHandler = (path: string) => open(path, 'r')

export interface SqPackReaderOptions {
  open?: SqPackFileOpenHandler
  indexEntries?: Map<number | bigint, IndexHashData>

  /**
   * path-to/0a0000.win32
   */
  prefix: string
  /**
   * Use index2 file instead of index file
   */
  useIndex2?: boolean
}
interface ReadFileOptions {
  handle: SqPackFileReader
  offset: number

  fileInfo: SqPackFileInfo
  fileInfoBuffer: Buffer
}

interface ChunkExpections {
  compressedSize: number
  uncompressedSize: number
}

interface ReadChunkOptions extends ChunkExpections {
  offset: number
  blockSizes?: number[]
}

export class SqPackReader {
  private dataHandles: Map<number, SqPackFileReader> = new Map()
  private indexEntries: Map<number | bigint, IndexHashData>
  private options: SqPackReaderOptions
  private openHandler: SqPackFileOpenHandler

  constructor(options: SqPackReaderOptions) {
    this.options = options
    this.indexEntries = options.indexEntries || new Map()
    this.openHandler = options.open || fsOpenHandler
  }

  /**
   * Open a SqPack repository
   */
  static async open(options: SqPackReaderOptions): Promise<SqPackReader> {
    const reader = new SqPackReader(options)
    if (!options.indexEntries) {
      await reader.loadIndex()
    }
    return reader
  }

  /**
   * Load index file and build hash table
   */
  private async loadIndex(): Promise<void> {
    const useIndex2 = !!this.options.useIndex2
    const ext = useIndex2 ? 'index2' : 'index'
    const indexPath = `${this.options.prefix}.${ext}`

    const data = await readFile(indexPath)
    this.indexEntries = readIndexEntries(data, useIndex2)
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
    debug(
      'reading file %s from data file %d with offset %d',
      filePath,
      fileIndex.dataFileId,
      fileIndex.offset,
    )

    let handle = this.dataHandles.get(fileIndex.dataFileId)
    if (!handle) {
      const dataPath = `${this.options.prefix}.dat${fileIndex.dataFileId}`
      handle = await this.openHandler(dataPath)
      this.dataHandles.set(fileIndex.dataFileId, handle)
    }

    const [fileInfo, fileInfoBuffer] = await this.readFileInfo(
      handle,
      fileIndex.offset,
    )
    if (fileInfo.rawFileSize === 0) {
      throw new Error(`File ${filePath} is empty`)
    }

    const options: ReadFileOptions = {
      handle,
      offset: fileIndex.offset,
      fileInfo,
      fileInfoBuffer,
    }

    if (fileInfo.type === FileType.Standard) {
      return this.readStandardFile(options)
    }

    if (fileInfo.type === FileType.Texture) {
      return this.readTextureFile(options)
    }

    // TODO: Handle other file types
    throw new Error(
      `Unsupported file type: ${FileType[fileInfo.type] || fileInfo.type}`,
    )
  }

  async readFileInfo(
    handle: SqPackFileReader,
    offset: number,
  ): Promise<[SqPackFileInfo, Buffer]> {
    const buffer = await this.#read(handle, offset)
    const info = readSqPackFileInfo(SmartBuffer.fromBuffer(buffer))
    if (info.size === blockSize) {
      return [info, buffer]
    }

    if (info.size > blockSize) {
      const wholeBuffer = Buffer.alloc(info.size)
      buffer.copy(wholeBuffer, 0, 0, blockSize)

      await handle.read(
        wholeBuffer,
        blockSize,
        info.size - blockSize,
        offset + blockSize,
      )

      return [info, wholeBuffer]
    }

    return [info, buffer.subarray(0, info.size)]
  }

  async readStandardFile({
    handle,
    offset,
    fileInfo,
    fileInfoBuffer,
  }: ReadFileOptions): Promise<Buffer> {
    // Read blocks
    const smartBuffer = SmartBuffer.fromBuffer(fileInfoBuffer)
    smartBuffer.readOffset = 0x14 // skip 5 uint32le
    const chunkCount = smartBuffer.readUInt32LE()
    const chunkInfos: SqPackStandardChunkInfo[] = []

    for (let i = 0; i < chunkCount; i++) {
      const chunkInfo = readSqPackStandardChunkInfo(smartBuffer)
      chunkInfos.push(chunkInfo)
    }

    return this.readDataChunks(
      handle,
      chunkInfos,
      offset + fileInfo.size,
      fileInfo.rawFileSize,
    )
  }

  async readTextureFile({
    handle,
    offset,
    fileInfo,
    fileInfoBuffer,
  }: ReadFileOptions): Promise<Buffer> {
    const smartBuffer = SmartBuffer.fromBuffer(fileInfoBuffer)
    smartBuffer.readOffset = 0x14 // skip 5 uint32le

    const chunkCount = smartBuffer.readUInt32LE()
    const chunkInfos: SqPackTextureChunkInfo[] = []

    let subBlockCount = 0
    for (let i = 0; i < chunkCount; ++i) {
      const chunkInfo = readSqPackTextureChunkInfo(smartBuffer)
      chunkInfos.push(chunkInfo)
      subBlockCount += chunkInfo.blockCount
    }

    const blockSizes: number[] = []
    for (let i = 0; i < subBlockCount; ++i) {
      blockSizes.push(smartBuffer.readUInt16LE())
    }

    const textureHeaderBuffer = await this.#read(
      handle,
      offset + fileInfo.size,
      sqPackTextureHeaderSize,
    )
    const buffer = await this.readDataChunks(
      handle,
      chunkInfos.map((info) => ({
        ...info,
        blockSizes: blockSizes.slice(
          info.blockOffset,
          info.blockOffset + info.blockCount,
        ),
      })),
      offset + fileInfo.size,
      fileInfo.rawFileSize - sqPackTextureHeaderSize,
    )

    return Buffer.concat([textureHeaderBuffer, buffer])
  }

  private async readDataChunk(
    handle: SqPackFileReader,
    offset: number,
  ): Promise<Buffer> {
    const chunkHeaderBuffer = await this.#read(handle, offset, 16)
    const chunkHeader = readSqPackDataChunkHeader(
      SmartBuffer.fromBuffer(chunkHeaderBuffer),
    )

    const dataOffset = offset + chunkHeader.size
    let compressed = true
    if (chunkHeader.compressedSize === uncompressedChunk) {
      compressed = false
    }

    const size = compressed
      ? chunkHeader.compressedSize
      : chunkHeader.uncompressedSize
    const chunk = await this.#read(handle, dataOffset, size)

    if (!compressed) {
      return chunk
    }

    const inflated = inflateRawSync(chunk)
    if (inflated.length !== chunkHeader.uncompressedSize) {
      throw new Error('Invalid file size')
    }

    return inflated
  }

  private async readDataChunks(
    handle: SqPackFileReader,
    chunkInfos: ReadChunkOptions[],
    baseOffset: number,
    expectedSize: number,
  ) {
    const chunks: Buffer[] = []
    let bytesRead = 0

    for (const { offset, blockSizes } of chunkInfos) {
      if (blockSizes) {
        let blockOffset = 0
        for (const size of blockSizes) {
          const chunk = await this.readDataChunk(
            handle,
            offset + baseOffset + blockOffset,
          )

          chunks.push(chunk)
          bytesRead += chunk.length
          blockOffset += size
        }
      } else {
        const chunk = await this.readDataChunk(handle, offset + baseOffset)

        chunks.push(chunk)
        bytesRead += chunk.length
      }
    }

    if (bytesRead !== expectedSize) {
      throw new Error(
        `Invalid file size: expected(${expectedSize}) !== actual(${bytesRead})`,
      )
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

  async #read(handle: SqPackFileReader, offset: number, length = blockSize) {
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, offset)

    return buffer
  }
}
