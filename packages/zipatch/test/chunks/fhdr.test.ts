import { describe, expect, it, vi } from 'vitest'
import { processFileHeader } from '../../src/chunks/fhdr'
import { createMockChunk, createTestContext } from './__utils__'

describe('FHDR Chunk Processor', () => {
  it('should process valid FHDR chunk', async () => {
    const context = createTestContext()
    const debugSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      // Create FHDR data: version=1, type="DIFF"
      const fhdrData = Buffer.from([
        0x00,
        0x00,
        0x01,
        0x00, // version=1, padding
        0x44,
        0x49,
        0x46,
        0x46, // "DIFF"
      ])
      const chunk = createMockChunk('FHDR', fhdrData)

      await processFileHeader(chunk, context)
      // Should not throw any errors
    } finally {
      debugSpy.mockRestore()
    }
  })

  it('should process FHDR chunk with different version', async () => {
    const context = createTestContext()
    const debugSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      // Create FHDR data: version=2, type="HOTF"
      const fhdrData = Buffer.from([
        0x00,
        0x00,
        0x02,
        0x00, // version=2, padding
        0x48,
        0x4f,
        0x54,
        0x46, // "HOTF"
      ])
      const chunk = createMockChunk('FHDR', fhdrData)

      await processFileHeader(chunk, context)
      // Should not throw any errors
    } finally {
      debugSpy.mockRestore()
    }
  })

  it('should throw error for chunk smaller than 8 bytes', async () => {
    const context = createTestContext()

    try {
      const fhdrData = Buffer.from([0x00, 0x00, 0x01]) // Only 3 bytes
      const chunk = createMockChunk('FHDR', fhdrData)

      await expect(processFileHeader(chunk, context)).rejects.toThrow(
        'Invalid file header chunk: 3 bytes',
      )
    } finally {
    }
  })

  it('should handle FHDR chunk with maximum version', async () => {
    const context = createTestContext()
    const debugSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      // Create FHDR data: version=255, type="TEST"
      const fhdrData = Buffer.from([
        0x00,
        0x00,
        0xff,
        0x00, // version=255, padding
        0x54,
        0x45,
        0x53,
        0x54, // "TEST"
      ])
      const chunk = createMockChunk('FHDR', fhdrData)

      await processFileHeader(chunk, context)
      // Should not throw any errors
    } finally {
      debugSpy.mockRestore()
    }
  })

  it('should handle FHDR chunk with zero version', async () => {
    const context = createTestContext()
    const debugSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      // Create FHDR data: version=0, type="ZERO"
      const fhdrData = Buffer.from([
        0x00,
        0x00,
        0x00,
        0x00, // version=0, padding
        0x5a,
        0x45,
        0x52,
        0x4f, // "ZERO"
      ])
      const chunk = createMockChunk('FHDR', fhdrData)

      await processFileHeader(chunk, context)
      // Should not throw any errors
    } finally {
      debugSpy.mockRestore()
    }
  })

  it('should handle FHDR chunk with exactly 8 bytes', async () => {
    const context = createTestContext()
    const debugSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      // Create FHDR data: exactly 8 bytes
      const fhdrData = Buffer.from([
        0x00,
        0x00,
        0x01,
        0x00, // version=1, padding
        0x4d,
        0x49,
        0x4e,
        0x49, // "MINI"
      ])
      const chunk = createMockChunk('FHDR', fhdrData)

      await processFileHeader(chunk, context)
      // Should not throw any errors
    } finally {
      debugSpy.mockRestore()
    }
  })
})
