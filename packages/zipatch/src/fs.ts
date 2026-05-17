import {
  createWriteStream,
  existsSync,
  type WriteStream,
  writeFileSync,
} from 'node:fs'
import { type FileHandle, mkdir, open, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { finished } from 'node:stream/promises'
import $debug from 'debug'

const debug = $debug('zipatch:fs')
const zeroBuffer = Buffer.alloc(1024, 0)
const MAX_TEMP_FILES = 1000

const isPathAllowed = (path: string, allowList: string[]) => {
  return (
    !allowList.length ||
    allowList.some((pattern) =>
      pattern.endsWith('*')
        ? path.startsWith(pattern.slice(0, -1))
        : pattern === path,
    )
  )
}

export interface FileRangeBase {
  path: string
  start: number
  end: number
}

export interface WriteFileRange extends FileRangeBase {
  type: 'write'
  dataPath: string
}

export interface EraseFileRange extends FileRangeBase {
  type: 'erase'
}

export type FileRange = WriteFileRange | EraseFileRange

export interface ZipatchFileSystem {
  workspace: string
  close(): Promise<void>
  isPathAllowed(path: string): boolean
  write(path: string, buf: Buffer, offset?: number): Promise<boolean>
  erase(path: string, length: number, offset: number): Promise<boolean>
  createDirectory(path: string): Promise<void>
  removeDirectory(path: string): Promise<void>
}

export class FileSystem implements ZipatchFileSystem {
  private fileHandles = new Map<string, FileHandle>()

  constructor(
    private root: string,
    private allowList: string[] = [],
  ) {}

  get workspace(): string {
    return this.root
  }

  /**
   * Close all open file handles
   */
  async close(): Promise<void> {
    const closePromises = Array.from(this.fileHandles.entries()).map(
      ([path, handle]) => {
        debug('close %s', path)
        return handle.close().catch((e) => {
          // Silently ignore close errors
          console.error('Error closing file: %s', e)
        })
      },
    )
    await Promise.all(closePromises)
    this.fileHandles.clear()
  }

  /**
   * Check if a path is allowed based on the allowlist
   */
  isPathAllowed(path: string): boolean {
    return isPathAllowed(path, this.allowList)
  }

  /**
   * Get file handle for either a string path or SqpkFile, opening it if necessary
   */
  async getFileHandle(path: string): Promise<FileHandle | null> {
    if (!this.isPathAllowed(path)) {
      return null
    }

    if (this.fileHandles.has(path)) {
      return this.fileHandles.get(path) ?? null
    }

    await this.createDirectory(dirname(path))
    return this.openFile(path)
  }

  /**
   * Write buffer to file at specified offset
   */
  async write(path: string, buf: Buffer, offset?: number): Promise<boolean> {
    const handle = await this.getFileHandle(path)
    if (!handle) {
      return false
    }

    debug('write %s offset=%d, len=%d', path, offset, buf.length)

    await handle.write(buf, 0, buf.length, offset)
    return true
  }

  /**
   * Write zeros to file at specified offset
   */
  async erase(path: string, length: number, offset: number): Promise<boolean> {
    const handle = await this.getFileHandle(path)
    if (!handle) {
      return false
    }

    debug('erase %s offset=%d, len=%d', path, offset, length)

    for (let i = 0; i < length; i += zeroBuffer.length) {
      await handle.write(
        zeroBuffer,
        0,
        Math.min(length - i, zeroBuffer.length),
        offset + i,
      )
    }
    return true
  }

  /**
   * Create a directory
   */
  async createDirectory(path: string): Promise<void> {
    const fullPath = join(this.root, path)
    debug('mkdir %s', fullPath)
    await mkdir(fullPath, { recursive: true })
  }

  /**
   * Remove a directory
   */
  async removeDirectory(path: string): Promise<void> {
    const fullPath = join(this.root, path)
    debug('rmdir %s', fullPath)
    await rm(fullPath, { recursive: true })
  }

  /**
   * Open a file
   */
  private async openFile(path: string) {
    const fullPath = join(this.root, path)

    if (!existsSync(fullPath)) {
      writeFileSync(fullPath, Buffer.alloc(0))
    }

    const mode = 'r+'
    debug('open %s with mode %s', path, mode)

    const handle = await open(fullPath, mode)
    this.fileHandles.set(path, handle)

    return handle
  }
}

export class VirtualFileSystem implements ZipatchFileSystem {
  private counter = 0
  private ranges = new Map<string, FileRange[]>()
  private lastWrite: WriteFileRange | null = null
  private lastWriteStream: WriteStream | null = null

  constructor(
    private root: string,
    private allowList: string[] = [],
  ) {}

  get workspace(): string {
    return this.root
  }

  async close(): Promise<void> {
    await this.closeLastWriteStream()
  }

  isPathAllowed(path: string): boolean {
    return isPathAllowed(path, this.allowList)
  }

  async write(path: string, buf: Buffer, offset: number = 0): Promise<boolean> {
    await this.recordRange(path, offset, offset + buf.length, buf)
    return true
  }

  async erase(path: string, length: number, offset: number): Promise<boolean> {
    await this.recordRange(path, offset, offset + length)
    return true
  }

  async createDirectory(_path: string): Promise<void> {
    // do nothing
  }

  async removeDirectory(_path: string): Promise<void> {
    // do nothing
  }

  getFileRanges(path: string): FileRange[] | null {
    const ranges = this.ranges.get(path)
    if (!ranges) {
      return null
    }

    return ranges.map((range) => ({ ...range }))
  }

  getRecordedRanges(): Map<string, FileRange[]> {
    return new Map(
      [...this.ranges.entries()].map(([path, ranges]) => [
        path,
        ranges.map((range) => ({ ...range })),
      ]),
    )
  }

  async clear() {
    for (const ranges of this.ranges.values()) {
      for (const range of ranges) {
        if (range.type === 'write' && range.dataPath) {
          await rm(range.dataPath)
        }
      }
    }

    this.ranges.clear()
  }

  private async recordRange(
    path: string,
    start: number,
    end: number,
    data?: Buffer,
  ) {
    if (!this.isPathAllowed(path)) {
      return
    }

    const ranges = this.ranges.get(path) ?? []
    if (data) {
      await mkdir(this.root, { recursive: true })

      if (
        this.lastWrite?.path === path &&
        start === this.lastWrite.end &&
        this.lastWriteStream
      ) {
        debug('[record] append %s, start=%d, end=%d', path, start, end)
        this.lastWriteStream.write(data)
        this.lastWrite.end = end
      } else {
        const fileName = this.createTempFileName(path)
        const dataPath = join(this.root, fileName)

        await this.closeLastWriteStream()

        debug(
          '[record] write %s, file=%s, start=%d, end=%d',
          path,
          fileName,
          start,
          end,
        )
        const stream = createWriteStream(dataPath)
        stream.write(data)

        const write = { type: 'write', path, dataPath, start, end } as const
        this.lastWriteStream = stream
        this.lastWrite = write

        if (this.counter > MAX_TEMP_FILES) {
          throw new Error('Too many temp files')
        }

        ranges.push(write)
      }
    } else {
      debug('[record] erase %s, start=%d, end=%d', path, start, end)
      ranges.push({ type: 'erase', path, start, end })
    }

    this.ranges.set(path, ranges)
  }

  private createTempFileName(path: string) {
    const sanitized = path.replace(/[\\/.:*?"<>|]/g, '_')
    const index = this.counter.toString().padStart(6, '0')
    this.counter += 1
    return `${index}-${sanitized}.bin`
  }

  private async closeLastWriteStream() {
    if (!this.lastWriteStream) return

    const stream = this.lastWriteStream
    this.lastWriteStream = null
    this.lastWrite = null

    stream.close()
    await finished(stream)
  }
}
