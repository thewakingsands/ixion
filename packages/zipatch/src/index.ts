import { type FileHandle, open } from 'node:fs/promises'
import { processChunk } from './chunks'
import { FileSystem } from './fs'
import type { ZipatchChunk, ZipatchContext } from './interface'

const zipatchMagic = [
  0x91, 0x5a, 0x49, 0x50, 0x41, 0x54, 0x43, 0x48, 0x0d, 0x0a, 0x1a, 0x0a,
]

// chunk: 4byte size, 4byte name, payload, crc32
const CHUNK_HEADER_SIZE = 8
const CRC32_SIZE = 4

export class ZipatchReader {
  private handle!: FileHandle
  private pos = 0
  private fileSize = 0

  /**
   * Open a zipatch file.
   */
  static async open(path: string) {
    const reader = new ZipatchReader()
    reader.handle = await open(path)

    const stat = await reader.handle.stat()
    reader.fileSize = stat.size

    // check the file magic
    const { buffer } = await reader.read(null, zipatchMagic.length)
    if (!zipatchMagic.every((c, i) => c === buffer[i])) {
      throw new Error('Zipatch magic mismatch')
    }

    reader.pos = zipatchMagic.length
    return reader
  }

  /**
   * Iterate over the chunks in the zipatch file.
   */
  async *chunks(): AsyncGenerator<ZipatchChunk> {
    const header = Buffer.alloc(8)
    while (this.pos < this.fileSize) {
      const { bytesRead } = await this.read(header, CHUNK_HEADER_SIZE)
      if (bytesRead !== CHUNK_HEADER_SIZE) break

      const size = header.readUint32BE(0)
      const name = header.subarray(4).toString()

      const posOfPayload = this.pos
      yield { name, size, read: this.read }
      this.pos = posOfPayload + size + CRC32_SIZE
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
    await this.handle.close()
  }

  private read = async (buf: Buffer | null, length: number) => {
    if (this.pos >= this.fileSize) {
      throw new Error('Moved out of file')
    }

    const ret = await this.handle.read(
      buf || Buffer.alloc(length),
      0,
      length,
      this.pos,
    )
    this.pos += ret.bytesRead

    return ret
  }
}
