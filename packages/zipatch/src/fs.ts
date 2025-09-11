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
    const closePromises = Array.from(this.fileHandles.values()).map((handle) =>
      handle.close().catch((e) => {
        // Silently ignore close errors
        console.error('Error closing file: %s', e)
      }),
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
   * Open a file
   */
  async openFile(path: string, create = false) {
    debug('open %s with create %s', path, create)

    const fullPath = join(this.root, path)
    const handle = await open(fullPath, create ? 'w+' : 'r+')
    this.fileHandles.set(path, handle)

    return handle
  }

  /**
   * Get file handle for either a string path or SqpkFile, opening it if necessary
   */
  async getFileHandle(path: string, create = true): Promise<FileHandle | null> {
    if (!this.isPathAllowed(path)) {
      return null
    }

    if (this.fileHandles.has(path)) {
      return this.fileHandles.get(path) ?? null
    }

    await this.createDirectory(dirname(path))
    return this.openFile(path, create)
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
}
