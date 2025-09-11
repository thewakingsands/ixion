import { describe, expect, it, vi } from 'vitest'
import { processChunk } from '../../src/chunks'
import { createMockChunk, createTestContext } from './__utils__'

describe('Chunk Processor', () => {
  it('should process FHDR chunk successfully', async () => {
    const context = createTestContext()

    // Create a minimal FHDR chunk
    const fhdrData = Buffer.from([
      0x00, 0x00, 0x01, 0x00, 0x44, 0x49, 0x46, 0x46,
    ])
    const chunk = createMockChunk('FHDR', fhdrData)

    const result = await processChunk(chunk, context)
    expect(result).toBe(true)
  })

  it('should process ADIR chunk successfully', async () => {
    const context = createTestContext()

    // Create an ADIR chunk with a directory path
    const dirPath = 'test/directory'
    const pathLength = Buffer.alloc(4)
    pathLength.writeUInt32BE(dirPath.length, 0)
    const adirData = Buffer.concat([pathLength, Buffer.from(dirPath)])
    const chunk = createMockChunk('ADIR', adirData)

    const result = await processChunk(chunk, context)
    expect(result).toBe(true)
  })

  it('should process SQPK chunk successfully', async () => {
    const context = createTestContext()

    // Create a minimal SQPK chunk with enough data for 'A' command
    const sqpkData = Buffer.alloc(5 + 19 + 4) // header + SqpkDataHeader + blockDeleteCount
    sqpkData.writeUInt32BE(5 + 19 + 4, 0) // size
    sqpkData.writeUInt8(0x41, 4) // 'A' command
    // Fill with minimal valid data
    sqpkData.writeUInt8(0x00, 5) // reserved[0]
    sqpkData.writeUInt8(0x00, 6) // reserved[1]
    sqpkData.writeUInt8(0x00, 7) // reserved[2]
    sqpkData.writeUInt16BE(0x0a00, 8) // mainId
    sqpkData.writeUInt16BE(0x0000, 10) // subId
    sqpkData.writeUInt32BE(0x00000000, 12) // fileId
    sqpkData.writeUInt32BE(0x00000000, 16) // blockOffset
    sqpkData.writeUInt32BE(0x00000000, 20) // blockCount
    sqpkData.writeUInt32BE(0x00000000, 24) // blockDeleteCount

    const chunk = createMockChunk('SQPK', sqpkData)

    const result = await processChunk(chunk, context)
    expect(result).toBe(true)
  })

  it('should skip APLY chunk', async () => {
    const context = createTestContext()

    const aplyData = Buffer.from([0x00, 0x00, 0x00, 0x02])
    const chunk = createMockChunk('APLY', aplyData)

    const result = await processChunk(chunk, context)
    expect(result).toBe(false)
  })

  it('should skip EOF_ chunk', async () => {
    const context = createTestContext()

    const eofData = Buffer.from([0x00, 0x00, 0x00, 0x00])
    const chunk = createMockChunk('EOF_', eofData)

    const result = await processChunk(chunk, context)
    expect(result).toBe(false)
  })

  it('should handle unknown chunk types', async () => {
    const context = createTestContext()
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const unknownData = Buffer.from([0x00, 0x00, 0x00, 0x04])
      const chunk = createMockChunk('UNKNOWN', unknownData)

      const result = await processChunk(chunk, context)
      expect(result).toBe(false)
      expect(consoleSpy).toHaveBeenCalledWith('Unknown chunk: UNKNOWN')
    } finally {
      consoleSpy.mockRestore()
    }
  })

  it('should handle DELD chunk with skip flag', async () => {
    const context = createTestContext()

    // DELD has skip: true but also has a handler
    const deldData = Buffer.from([
      0x00, 0x00, 0x00, 0x04, 0x74, 0x65, 0x73, 0x74,
    ]) // "test"
    const chunk = createMockChunk('DELD', deldData)

    const result = await processChunk(chunk, context)
    expect(result).toBe(false) // Should be skipped due to skip: true
  })
})
