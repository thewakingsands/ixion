import { existsSync, writeFileSync } from 'node:fs'
import { type FileHandle, mkdir, open, rmdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import $debug from 'debug'

const debug = $debug('zipatch:fs')

const zeroBuffer = Buffer.alloc(1024, 0)
export class FileSystem {
  private fileHandles = new Map<string, FileHandle>()

  constructor(
    private root: string,
    private allowList: string[] = [],
  ) {}

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
    return !this.allowList.length || this.allowList.includes(path)
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
    await rmdir(fullPath, { recursive: true })
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
