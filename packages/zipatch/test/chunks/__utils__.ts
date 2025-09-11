import { join } from 'node:path'
import type { FileSystem } from '../../src/fs'
import type { ZipatchChunk, ZipatchContext } from '../../src/interface'

/**
 * Create a mock chunk for testing
 */
export const createMockChunk = (name: string, data: Buffer): ZipatchChunk => ({
  name,
  size: data.length,
  read: async () => ({
    bytesRead: data.length,
    buffer: data,
  }),
})

/**
 * Create a test context with a temporary workspace
 */
export const createTestContext = (): ZipatchContext => {
  const workspace = join(__dirname, '../__workspace__/test-chunks')
  const mockFs = new MockFileSystem()
  return {
    platform: 'win32',
    workspace,
    allowList: [],
    fs: mockFs as unknown as FileSystem,
  }
}

/**
 * Create a mock file system for testing without actual file operations
 */
export class MockFileSystem {
  public operations: Array<Record<string, any>> = []

  async write(path: string, data: Buffer, offset: number): Promise<void> {
    this.operations.push({
      type: 'write',
      path,
      data,
      offset,
    })
  }

  async erase(path: string, length: number, offset: number): Promise<void> {
    this.operations.push({
      type: 'erase',
      path,
      length,
      offset,
    })
  }

  async createDirectory(path: string): Promise<void> {
    this.operations.push({ type: 'createDirectory', path })
  }

  async removeDirectory(path: string): Promise<void> {
    this.operations.push({ type: 'removeDirectory', path })
  }

  async getFileHandle(path: string, create = false): Promise<any> {
    this.operations.push({ type: 'getFileHandle', path, create })
    // Return a mock file handle that can be used for writing
    return {
      write: async (
        data: Buffer,
        offset?: number,
        length?: number,
        position?: number,
      ) => {
        this.operations.push({
          type: 'fileWrite',
          path,
          data,
          offset,
          length,
          position,
        })
      },
      close: async () => {
        this.operations.push({ type: 'fileClose', path })
      },
    }
  }

  isPathAllowed(_path: string): boolean {
    return true // Allow all paths in tests
  }
}

/**
 * Get the operations from the mock file system
 */
export const getMockFileSystemOperations = (context: ZipatchContext) => {
  return (context.fs as unknown as MockFileSystem).operations
}
