import { existsSync, writeFileSync } from 'node:fs'
import { type FileHandle, mkdir, open, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import $debug from 'debug'

const debug = $debug('zipatch:fs')

const zeroBuffer = Buffer.alloc(1024, 0)
export interface FileRange {
  start: number
  end: number
}

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
    return (
      !this.allowList.length ||
      this.allowList.some((pattern) =>
        pattern.endsWith('*')
          ? path.startsWith(pattern.slice(0, -1))
          : pattern === path,
      )
    )
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
  private ranges = new Map<string, FileRange[]>()

  constructor(
    private root: string,
    private allowList: string[] = [],
  ) {}

  get workspace(): string {
    return this.root
  }

  async close(): Promise<void> {
    // do nothing
  }

  isPathAllowed(path: string): boolean {
    return (
      !this.allowList.length ||
      this.allowList.some((pattern) =>
        pattern.endsWith('*')
          ? path.startsWith(pattern.slice(0, -1))
          : pattern === path,
      )
    )
  }

  async write(path: string, buf: Buffer, offset: number = 0): Promise<boolean> {
    this.recordRange(path, offset, offset + buf.length)
    return true
  }

  async erase(path: string, length: number, offset: number): Promise<boolean> {
    this.recordRange(path, offset, offset + length)
    return true
  }

  async createDirectory(path: string): Promise<void> {
    // do nothing
  }

  async removeDirectory(path: string): Promise<void> {
    // do nothing
  }

  getRecordedRanges(): Map<string, FileRange[]> {
    return new Map(
      [...this.ranges.entries()].map(([path, ranges]) => [
        path,
        ranges.map((range) => ({ ...range })),
      ]),
    )
  }

  private recordRange(path: string, start: number, end: number) {
    if (!this.isPathAllowed(path)) {
      return
    }

    const ranges = this.ranges.get(path) ?? []
    ranges.push({ start, end })
    ranges.sort((left, right) => left.start - right.start)

    const merged: FileRange[] = []
    for (const range of ranges) {
      const current = merged.at(-1)
      if (!current || range.start > current.end) {
        merged.push({ ...range })
        continue
      }

      current.end = Math.max(current.end, range.end)
    }

    this.ranges.set(path, merged)
  }
}
