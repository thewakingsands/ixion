import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { processSqPack } from '../../src/chunks/sqpk'
import {
  createMockChunk,
  createTestContext,
  getMockFileSystemOperations,
} from './__utils__'

describe('SQPK Chunk Processor', () => {
  describe('Command Processing', () => {
    it('should process Add Data (A) command', async () => {
      const fixturePath = join(__dirname, '../__fixtures__/sqpk-a-43.bin')
      const fixtureData = readFileSync(fixturePath)

      const context = await createTestContext()

      const chunk = createMockChunk('SQPK', fixtureData)
      await processSqPack(chunk, context)

      // Verify file system operations
      const operations = getMockFileSystemOperations(context)
      expect(operations.length).toBe(1)
      expect(operations[0].offset).toBe(99558528)
      expect(operations[0].path).toBe('sqpack/ffxiv/0a0000.win32.dat0')
      expect(operations[0].type).toBe('write')
    })

    it('should process Delete Data (D) command', async () => {
      const context = await createTestContext()

      // Create SQPK D command data
      const commandData = Buffer.alloc(5 + 19 + 4) // size+command + SqpkDataHeader + blockDeleteCount
      let offset = 0

      // Size and command header
      commandData.writeUInt32BE(5 + 19 + 4, offset) // total size
      offset += 4
      commandData.writeUInt8(0x44, offset) // 'D' command
      offset += 1

      // SqpkDataHeader (19 bytes)
      commandData.writeUInt8(0x00, offset++) // reserved[0]
      commandData.writeUInt8(0x00, offset++) // reserved[1]
      commandData.writeUInt8(0x00, offset++) // reserved[2]
      commandData.writeUInt16BE(0x0a00, offset) // mainId
      offset += 2
      commandData.writeUInt16BE(0x0000, offset) // subId
      offset += 2
      commandData.writeUInt32BE(0x00000000, offset) // fileId
      offset += 4
      commandData.writeUInt32BE(0x00000001, offset) // blockOffset
      offset += 4
      commandData.writeUInt32BE(0x00000002, offset) // blockCount
      offset += 4

      // blockDeleteCount
      commandData.writeUInt32BE(0x00000001, offset) // blockDeleteCount
      offset += 4

      const chunk = createMockChunk('SQPK', commandData)
      await processSqPack(chunk, context)

      // Verify file system operations
      const operations = getMockFileSystemOperations(context)
      expect(operations).toHaveLength(2) // erase
      expect(operations[0].type).toBe('write')
      expect(operations[0].path).toBe('sqpack/ffxiv/a000000.win32.dat0')
      expect(operations[0].data.length).toBe(128)
      expect(operations[0].offset).toBe(128) // blockOffset << 7
      expect(operations[1].type).toBe('erase')
      expect(operations[1].path).toBe('sqpack/ffxiv/a000000.win32.dat0')
      expect(operations[1].length).toBe(128) // blockCount << 7
      expect(operations[1].offset).toBe(256) // blockOffset << 7
    })
    it('should process File Operation (F) command', async () => {
      const fixturePath = join(__dirname, '../__fixtures__/sqpk-fa-35.bin')
      const fixtureData = readFileSync(fixturePath)

      const context = await createTestContext()

      const chunk = createMockChunk('SQPK', fixtureData)
      await processSqPack(chunk, context)

      // Verify file system operations
      const operations = getMockFileSystemOperations(context)
      expect(operations.length).toBe(101)
      expect(operations[0]).toMatchObject({
        type: 'getFileHandle',
        path: 'ffxiv_dx11.exe',
        create: true,
      })
      expect(operations[1]).toMatchObject({
        type: 'fileWrite',
        path: 'ffxiv_dx11.exe',
        offset: 0,
        length: 16000,
        position: 46400000,
      })
    })

    it('should skip Index Update (I) command', async () => {
      const context = await createTestContext()

      // Create SQPK I command data
      const commandData = Buffer.alloc(5) // minimal size
      commandData.writeUInt32BE(5, 0) // size
      commandData.writeUInt8(0x49, 4) // 'I' command

      const chunk = createMockChunk('SQPK', commandData)
      await processSqPack(chunk, context)

      // Verify no file system operations
      const operations = getMockFileSystemOperations(context)
      expect(operations).toHaveLength(0)
    })

    it('should handle unknown command', async () => {
      const context = await createTestContext()
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      try {
        // Create SQPK with unknown command
        const commandData = Buffer.alloc(5) // minimal size
        commandData.writeUInt32BE(5, 0) // size
        commandData.writeUInt8(0x5a, 4) // 'Z' command (unknown)

        const chunk = createMockChunk('SQPK', commandData)
        await processSqPack(chunk, context)

        expect(consoleSpy).toHaveBeenCalledWith('Unknown command: Z')
      } finally {
        consoleSpy.mockRestore()
      }
    })
  })

  describe('Error Handling', () => {
    it('should throw error for chunk smaller than 5 bytes', async () => {
      const context = await createTestContext()

      const commandData = Buffer.from([0x00, 0x00, 0x00, 0x04]) // size=4, no command
      const chunk = createMockChunk('SQPK', commandData)

      await expect(processSqPack(chunk, context)).rejects.toThrow(
        'Invalid SqPack chunk',
      )
    })

    it('should throw error for insufficient data', async () => {
      const context = await createTestContext()

      // Claim size of 100 bytes but only provide 10
      const commandData = Buffer.alloc(10)
      commandData.writeUInt32BE(100, 0) // size=100
      commandData.writeUInt8(0x41, 4) // 'A' command
      // Only 6 more bytes, but claimed 100

      const chunk = createMockChunk('SQPK', commandData)

      await expect(processSqPack(chunk, context)).rejects.toThrow(
        'Invalid SqPack chunk - insufficient data',
      )
    })
  })
})
