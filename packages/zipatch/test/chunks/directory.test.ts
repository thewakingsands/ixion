import { describe, expect, it } from 'vitest'
import {
  processAddDirectory,
  processDeleteDirectory,
} from '../../src/chunks/directory'
import {
  createMockChunk,
  createTestContext,
  getMockFileSystemOperations,
} from './__utils__'

describe('Directory Chunk Processors', () => {
  describe('processAddDirectory', () => {
    it('should create a simple directory', async () => {
      const context = createTestContext()

      const dirPath = 'testdir'
      const pathLength = Buffer.alloc(4)
      pathLength.writeUInt32BE(dirPath.length, 0)
      const adirData = Buffer.concat([pathLength, Buffer.from(dirPath)])
      const chunk = createMockChunk('ADIR', adirData)

      await processAddDirectory(chunk, context)

      // Verify directory operation was called
      const operations = getMockFileSystemOperations(context)
      expect(operations).toHaveLength(1)
      expect(operations[0].type).toBe('createDirectory')
      expect(operations[0].path).toBe(dirPath)
    })

    it('should create nested directories', async () => {
      const context = createTestContext()

      const dirPath = 'nested/deep/directory'
      const pathLength = Buffer.alloc(4)
      pathLength.writeUInt32BE(dirPath.length, 0)
      const adirData = Buffer.concat([pathLength, Buffer.from(dirPath)])
      const chunk = createMockChunk('ADIR', adirData)

      await processAddDirectory(chunk, context)

      // Verify nested directory operation was called
      const operations = getMockFileSystemOperations(context)
      expect(operations).toHaveLength(1)
      expect(operations[0].type).toBe('createDirectory')
      expect(operations[0].path).toBe(dirPath)
    })

    it('should handle directory with special characters', async () => {
      const context = createTestContext()

      const dirPath = 'test-dir_with.special+chars'
      const pathLength = Buffer.alloc(4)
      pathLength.writeUInt32BE(dirPath.length, 0)
      const adirData = Buffer.concat([pathLength, Buffer.from(dirPath)])
      const chunk = createMockChunk('ADIR', adirData)

      await processAddDirectory(chunk, context)

      // Verify directory operation was called
      const operations = getMockFileSystemOperations(context)
      expect(operations).toHaveLength(1)
      expect(operations[0].type).toBe('createDirectory')
      expect(operations[0].path).toBe(dirPath)
    })

    it('should handle empty directory name', async () => {
      const context = createTestContext()

      const dirPath = ''
      const pathLength = Buffer.alloc(4)
      pathLength.writeUInt32BE(dirPath.length, 0)
      const adirData = Buffer.concat([pathLength, Buffer.from(dirPath)])
      const chunk = createMockChunk('ADIR', adirData)

      await processAddDirectory(chunk, context)

      // Verify directory operation was called even with empty path
      const operations = getMockFileSystemOperations(context)
      expect(operations).toHaveLength(1)
      expect(operations[0].type).toBe('createDirectory')
      expect(operations[0].path).toBe(dirPath)
    })

    it('should throw error for invalid chunk length', async () => {
      const context = createTestContext()

      const dirPath = 'testdir'
      const pathLength = Buffer.alloc(4)
      pathLength.writeUInt32BE(dirPath.length + 10, 0) // Claim longer path than actual
      const adirData = Buffer.concat([pathLength, Buffer.from(dirPath)])
      const chunk = createMockChunk('ADIR', adirData)

      await expect(processAddDirectory(chunk, context)).rejects.toThrow(
        'Invalid directory chunk length:',
      )

      // Verify no directory operations were called due to error
      const operations = getMockFileSystemOperations(context)
      expect(operations).toHaveLength(0)
    })
  })

  describe('processDeleteDirectory', () => {
    it('should delete an existing directory', async () => {
      const context = createTestContext()

      const dirPath = 'testdir'
      const pathLength = Buffer.alloc(4)
      pathLength.writeUInt32BE(dirPath.length, 0)
      const deldData = Buffer.concat([pathLength, Buffer.from(dirPath)])
      const chunk = createMockChunk('DELD', deldData)

      await processDeleteDirectory(chunk, context)

      // Verify directory deletion operation was called
      const operations = getMockFileSystemOperations(context)
      expect(operations).toHaveLength(1)
      expect(operations[0].type).toBe('removeDirectory')
      expect(operations[0].path).toBe(dirPath)
    })

    it('should delete nested directories', async () => {
      const context = createTestContext()

      const dirPath = 'nested/deep/directory'
      const pathLength = Buffer.alloc(4)
      pathLength.writeUInt32BE(dirPath.length, 0)
      const deldData = Buffer.concat([pathLength, Buffer.from(dirPath)])
      const chunk = createMockChunk('DELD', deldData)

      await processDeleteDirectory(chunk, context)

      // Verify nested directory deletion operation was called
      const operations = getMockFileSystemOperations(context)
      expect(operations).toHaveLength(1)
      expect(operations[0].type).toBe('removeDirectory')
      expect(operations[0].path).toBe(dirPath)
    })

    it('should handle deletion of non-existent directory gracefully', async () => {
      const context = createTestContext()

      const dirPath = 'nonexistent'
      const pathLength = Buffer.alloc(4)
      pathLength.writeUInt32BE(dirPath.length, 0)
      const deldData = Buffer.concat([pathLength, Buffer.from(dirPath)])
      const chunk = createMockChunk('DELD', deldData)

      // With mocked operations, this should not throw an error
      await processDeleteDirectory(chunk, context)

      // Verify directory deletion operation was called
      const operations = getMockFileSystemOperations(context)
      expect(operations).toHaveLength(1)
      expect(operations[0].type).toBe('removeDirectory')
      expect(operations[0].path).toBe(dirPath)
    })

    it('should throw error for invalid chunk length', async () => {
      const context = createTestContext()

      const dirPath = 'testdir'
      const pathLength = Buffer.alloc(4)
      pathLength.writeUInt32BE(dirPath.length + 10, 0) // Claim longer path than actual
      const deldData = Buffer.concat([pathLength, Buffer.from(dirPath)])
      const chunk = createMockChunk('DELD', deldData)

      await expect(processDeleteDirectory(chunk, context)).rejects.toThrow(
        'Invalid directory chunk length:',
      )

      // Verify no directory operations were called due to error
      const operations = getMockFileSystemOperations(context)
      expect(operations).toHaveLength(0)
    })
  })
})
