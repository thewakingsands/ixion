import { processChunk } from './chunks'
import {
  createChunkReader,
  createFileDataSource,
  createHttpDataSource,
  isHttpUrl,
  type ZipatchDataSource,
  type ZipatchOpenOptions,
  type ZipatchPreloadData,
  type ZipatchPreloadedChunk,
} from './datasource'
import { FileSystem } from './fs'
import type { ZipatchChunk, ZipatchContext } from './interface'

const zipatchMagic = [
  0x91, 0x5a, 0x49, 0x50, 0x41, 0x54, 0x43, 0x48, 0x0d, 0x0a, 0x1a, 0x0a,
]

// chunk: 4byte size, 4byte name, payload, crc32
const CHUNK_HEADER_SIZE = 8
const CRC32_SIZE = 4

export type {
  ZipatchOpenOptions,
  ZipatchPreloadData,
  ZipatchPreloadedChunk,
} from './datasource'

export class ZipatchReader {
  private source!: ZipatchDataSource
  private preloaded?: ZipatchPreloadData

  /**
   * Open a zipatch file.
   */
  static async open(path: string, options: ZipatchOpenOptions = {}) {
    const reader = new ZipatchReader()
    reader.preloaded = options.chunks ?? options.preloaded
    reader.source = isHttpUrl(path)
      ? await createHttpDataSource(path, reader.preloaded)
      : await createFileDataSource(path)

    // check the file magic
    const { buffer } = await reader.source.readAt(0, zipatchMagic.length)
    if (!zipatchMagic.every((c, i) => c === buffer[i])) {
      throw new Error('Zipatch magic mismatch')
    }

    return reader
  }

  /**
   * Preload chunk headers for local or remote zipatch access.
   */
  static async preload(path: string): Promise<ZipatchPreloadData> {
    const source = isHttpUrl(path)
      ? await createHttpDataSource(path)
      : await createFileDataSource(path)

    try {
      const { buffer } = await source.readAt(0, zipatchMagic.length)
      if (!zipatchMagic.every((c, i) => c === buffer[i])) {
        throw new Error('Zipatch magic mismatch')
      }

      const chunks: ZipatchPreloadedChunk[] = []
      let pos = zipatchMagic.length
      const header = Buffer.alloc(CHUNK_HEADER_SIZE)

      while (pos < source.fileSize) {
        const { bytesRead, buffer: headerBuffer } = await source.readAt(
          pos,
          CHUNK_HEADER_SIZE,
          header,
        )
        if (bytesRead !== CHUNK_HEADER_SIZE) {
          break
        }

        const size = headerBuffer.readUInt32BE(0)
        const name = headerBuffer.subarray(4).toString()
        const offset = pos + CHUNK_HEADER_SIZE
        chunks.push({ name, size, offset })
        pos = offset + size + CRC32_SIZE
      }

      return {
        fileSize: source.fileSize,
        chunks,
      }
    } finally {
      await source.close()
    }
  }

  /**
   * Iterate over the chunks in the zipatch file.
   */
  async *chunks(): AsyncGenerator<ZipatchChunk> {
    if (this.preloaded) {
      for (const chunk of this.preloaded.chunks) {
        yield createChunkReader(this.source, chunk)
      }
      return
    }

    let pos = zipatchMagic.length
    const header = Buffer.alloc(CHUNK_HEADER_SIZE)
    while (pos < this.source.fileSize) {
      const { bytesRead, buffer: headerBuffer } = await this.source.readAt(
        pos,
        CHUNK_HEADER_SIZE,
        header,
      )
      if (bytesRead !== CHUNK_HEADER_SIZE) break

      const size = headerBuffer.readUint32BE(0)
      const name = headerBuffer.subarray(4).toString()
      const offset = pos + CHUNK_HEADER_SIZE

      yield createChunkReader(this.source, { name, size, offset })
      pos = offset + size + CRC32_SIZE
    }
  }

  /**
   * Extract the zipatch file to a directory.
   */
  async applyTo(path: string, allowList: string[] = []) {
    // Ensure the extraction directory exists
    const fs = new FileSystem(path, allowList)
    await fs.createDirectory('/')
    const context: ZipatchContext = {
      platform: 'win32',
      workspace: path,
      allowList,
      fs,
    }

    for await (const chunk of this.chunks()) {
      await processChunk(chunk, context)
    }

    await fs.close()
  }

  /**
   * Close the file handle.
   */
  async close() {
    await this.source.close()
  }
}
