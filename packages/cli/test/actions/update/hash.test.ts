import { createHash } from 'node:crypto'
import { unlinkSync, writeFileSync } from 'node:fs'
import type { PatchEntry } from '@ffcafe/ixion-server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { verifyPatchHash } from '../../../src/utils/hash'

describe('Hash Verification', () => {
  const testFile = 'test-patch-hash.bin'
  const testContent =
    'Hello, World! This is a test file for hash verification with multiple blocks.'

  beforeAll(() => {
    // Create test file
    writeFileSync(testFile, testContent)
  })

  afterAll(() => {
    // Clean up test file
    unlinkSync(testFile)
  })

  it('should verify hash correctly for block-based verification', async () => {
    const blockSize = 16 // 16 bytes per block
    const contentBuffer = Buffer.from(testContent, 'utf8')
    const hashes: string[] = []

    // Calculate expected hashes for each block
    for (let i = 0; i < contentBuffer.length; i += blockSize) {
      const block = contentBuffer.subarray(i, i + blockSize)
      const hash = createHash('sha256')
      hash.update(block)
      hashes.push(hash.digest('hex'))
    }

    const testPatch: PatchEntry = {
      patchSize: testContent.length,
      version: 'test.1.0.0',
      hash: {
        type: 'sha256',
        blockSize: blockSize,
        values: hashes,
      },
      repository: 'test',
      url: 'http://example.com/test.patch',
      expansion: 'ffxiv',
    }

    // This should not throw
    await expect(verifyPatchHash(testFile, testPatch)).resolves.toBeUndefined()
  })

  it('should fail verification with incorrect hashes', async () => {
    const testPatch: PatchEntry = {
      patchSize: testContent.length,
      version: 'test.1.0.0',
      hash: {
        type: 'sha256',
        blockSize: 16,
        values: ['incorrect-hash-1', 'incorrect-hash-2', 'incorrect-hash-3'],
      },
      repository: 'test',
      url: 'http://example.com/test.patch',
      expansion: 'ffxiv',
    }

    // This should throw
    await expect(verifyPatchHash(testFile, testPatch)).rejects.toThrow(
      'Hash verification failed for test.1.0.0 at block 0: expected incorrect-hash-1, got',
    )
  })

  it('should fail verification with wrong number of blocks', async () => {
    const testPatch: PatchEntry = {
      patchSize: testContent.length,
      version: 'test.1.0.0',
      hash: {
        type: 'sha256',
        blockSize: 16,
        values: ['only-one-hash'],
      },
      repository: 'test',
      url: 'http://example.com/test.patch',
      expansion: 'ffxiv',
    }

    // This should throw - it will fail on the first block hash mismatch
    await expect(verifyPatchHash(testFile, testPatch)).rejects.toThrow(
      'Hash verification failed for test.1.0.0 at block 0: expected only-one-hash, got',
    )
  })

  it('should fail verification with too many expected hashes', async () => {
    const testPatch: PatchEntry = {
      patchSize: testContent.length,
      version: 'test.1.0.0',
      hash: {
        type: 'sha256',
        blockSize: 16,
        values: ['hash1', 'hash2', 'hash3', 'hash4', 'hash5', 'hash6'],
      },
      repository: 'test',
      url: 'http://example.com/test.patch',
      expansion: 'ffxiv',
    }

    // This should throw - it will fail on the first block hash mismatch
    await expect(verifyPatchHash(testFile, testPatch)).rejects.toThrow(
      'Hash verification failed for test.1.0.0 at block 0: expected hash1, got',
    )
  })

  it('should fail verification with too many blocks (block count validation)', async () => {
    // Create a test where we have fewer expected hashes than actual blocks
    const blockSize = 16
    const contentBuffer = Buffer.from(testContent, 'utf8')
    const hashes: string[] = []

    // Calculate hashes for only the first 3 blocks (fewer than total)
    for (
      let i = 0;
      i < Math.min(contentBuffer.length, 3 * blockSize);
      i += blockSize
    ) {
      const block = contentBuffer.subarray(i, i + blockSize)
      const hash = createHash('sha256')
      hash.update(block)
      hashes.push(hash.digest('hex'))
    }

    const testPatch: PatchEntry = {
      patchSize: testContent.length, // Full file size
      version: 'test.1.0.0',
      hash: {
        type: 'sha256',
        blockSize: blockSize,
        values: hashes,
      },
      repository: 'test',
      url: 'http://example.com/test.patch',
      expansion: 'ffxiv',
    }

    // This should throw due to block count mismatch
    await expect(verifyPatchHash(testFile, testPatch)).rejects.toThrow(
      'Hash verification failed for test.1.0.0: Too many blocks',
    )
  })

  it('should handle different hash types correctly', async () => {
    const blockSize = 16
    const contentBuffer = Buffer.from(testContent, 'utf8')
    const hashes: string[] = []

    // Calculate expected hashes using MD5
    for (let i = 0; i < contentBuffer.length; i += blockSize) {
      const block = contentBuffer.subarray(i, i + blockSize)
      const hash = createHash('md5')
      hash.update(block)
      hashes.push(hash.digest('hex'))
    }

    const testPatch: PatchEntry = {
      patchSize: testContent.length,
      version: 'test.1.0.0',
      hash: {
        type: 'md5',
        blockSize: blockSize,
        values: hashes,
      },
      repository: 'test',
      url: 'http://example.com/test.patch',
      expansion: 'ffxiv',
    }

    // This should not throw
    await expect(verifyPatchHash(testFile, testPatch)).resolves.toBeUndefined()
  })

  it('should handle different block sizes correctly', async () => {
    const blockSize = 8 // Smaller block size
    const contentBuffer = Buffer.from(testContent, 'utf8')
    const hashes: string[] = []

    // Calculate expected hashes for smaller blocks
    for (let i = 0; i < contentBuffer.length; i += blockSize) {
      const block = contentBuffer.subarray(i, i + blockSize)
      const hash = createHash('sha256')
      hash.update(block)
      hashes.push(hash.digest('hex'))
    }

    const testPatch: PatchEntry = {
      patchSize: testContent.length,
      version: 'test.1.0.0',
      hash: {
        type: 'sha256',
        blockSize: blockSize,
        values: hashes,
      },
      repository: 'test',
      url: 'http://example.com/test.patch',
      expansion: 'ffxiv',
    }

    // This should not throw
    await expect(verifyPatchHash(testFile, testPatch)).resolves.toBeUndefined()
  })

  it('should handle large block sizes correctly', async () => {
    const blockSize = 64 // Larger block size
    const contentBuffer = Buffer.from(testContent, 'utf8')
    const hashes: string[] = []

    // Calculate expected hashes for larger blocks
    for (let i = 0; i < contentBuffer.length; i += blockSize) {
      const block = contentBuffer.subarray(i, i + blockSize)
      const hash = createHash('sha256')
      hash.update(block)
      hashes.push(hash.digest('hex'))
    }

    const testPatch: PatchEntry = {
      patchSize: testContent.length,
      version: 'test.1.0.0',
      hash: {
        type: 'sha256',
        blockSize: blockSize,
        values: hashes,
      },
      repository: 'test',
      url: 'http://example.com/test.patch',
      expansion: 'ffxiv',
    }

    // This should not throw
    await expect(verifyPatchHash(testFile, testPatch)).resolves.toBeUndefined()
  })

  it('should handle single block files correctly', async () => {
    const singleBlockContent = 'Short'
    const singleBlockFile = 'test-single-block.bin'

    writeFileSync(singleBlockFile, singleBlockContent)

    try {
      const blockSize = 16
      const contentBuffer = Buffer.from(singleBlockContent, 'utf8')
      const hash = createHash('sha256')
      hash.update(contentBuffer)
      const expectedHash = hash.digest('hex')

      const testPatch: PatchEntry = {
        patchSize: singleBlockContent.length,
        version: 'test.single.0',
        hash: {
          type: 'sha256',
          blockSize: blockSize,
          values: [expectedHash],
        },
        repository: 'test',
        url: 'http://example.com/test-single.patch',
        expansion: 'ffxiv',
      }

      // This should not throw
      await expect(
        verifyPatchHash(singleBlockFile, testPatch),
      ).resolves.toBeUndefined()
    } finally {
      unlinkSync(singleBlockFile)
    }
  })

  it('should fail when file does not exist', async () => {
    const testPatch: PatchEntry = {
      patchSize: 100,
      version: 'test.nonexistent.0',
      hash: {
        type: 'sha256',
        blockSize: 16,
        values: ['some-hash'],
      },
      repository: 'test',
      url: 'http://example.com/nonexistent.patch',
      expansion: 'ffxiv',
    }

    // This should throw
    await expect(
      verifyPatchHash('nonexistent-file.bin', testPatch),
    ).rejects.toThrow()
  })
})
