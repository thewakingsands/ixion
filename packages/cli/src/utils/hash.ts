import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import type { PatchEntry } from '@ffcafe/ixion-server'

export function calculateHashForFile(
  path: string,
  type: 'sha1' | 'sha256' = 'sha1',
): string | undefined {
  try {
    const hash = createHash(type)
    hash.update(readFileSync(path))
    return hash.digest('hex').slice(0, 8)
  } catch (e) {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') {
      return undefined
    }

    console.warn(`⚠️ Failed to calculate hash for ${path}:`, e)
    return undefined
  }
}

export function calculateHashForArchive(
  path: string,
): Record<string, string | undefined> {
  return {
    exe: calculateHashForFile(join(path, 'ffxiv_dx11.exe')),
    excel: calculateHashForFile(join(path, 'sqpack/ffxiv/0a0000.win32.dat0')),
  }
}

export const verifyPatchHash = async (
  filePath: string,
  patch: PatchEntry,
): Promise<void> => {
  console.log(`🔍 Verifying hash for ${patch.version}...`)

  const { hash, version, patchSize } = patch
  if (!hash) {
    console.log(
      `✅ Hash verification passed for ${version} (no hash verification required)`,
    )
    return
  }

  const { blockSize: hashBlockSize, values: hashes, type: hashType } = hash

  const fileHandle = await open(filePath, 'r')

  try {
    let blockIndex = 0
    let position = 0

    while (position < patchSize) {
      // Read the next block
      const remainingBytes = patchSize - position
      const bytesToRead = Math.min(hashBlockSize, remainingBytes)

      const buffer = Buffer.alloc(bytesToRead)
      const { bytesRead } = await fileHandle.read(
        buffer,
        0,
        bytesToRead,
        position,
      )

      if (bytesRead === 0) {
        break
      }

      // Calculate hash for this block
      const hashCalculator = createHash(hashType)
      hashCalculator.update(buffer.subarray(0, bytesRead))
      const calculatedHash = hashCalculator.digest('hex')

      // Check if we have a corresponding expected hash
      if (blockIndex >= hashes.length) {
        throw new Error(
          `Hash verification failed for ${version}: Too many blocks (${blockIndex + 1} > ${hashes.length})`,
        )
      }

      const expectedHash = hashes[blockIndex]
      if (calculatedHash !== expectedHash) {
        throw new Error(
          `Hash verification failed for ${version} at block ${blockIndex}: expected ${expectedHash}, got ${calculatedHash}`,
        )
      }

      blockIndex++
      position += bytesRead
    }

    // Verify we processed the correct number of blocks
    if (blockIndex !== hashes.length) {
      throw new Error(
        `Hash verification failed for ${version}: Expected ${hashes.length} blocks, but processed ${blockIndex}`,
      )
    }

    console.log(
      `✅ Hash verification passed for ${version} (${blockIndex} blocks)`,
    )
  } finally {
    await fileHandle.close()
  }
}
