import type { SmartBuffer } from 'smart-buffer'
import type { PlatformId } from '../interface'

export interface SqPackHeader {
  magic: Buffer // 8 bytes
  platformId: PlatformId
  size: number
  version: number
  type: number
}

export interface SqPackIndexHeader {
  size: number
  version: number
  indexDataOffset: number
  indexDataSize: number
}

/**
 * SqPack header structure
 * @see https://xiv.dev/data-files/sqpack#reading-index-data
 */
export const readSqPackHeader = (buffer: SmartBuffer): SqPackHeader => {
  const magic = buffer.readBuffer(8)
  const platformId = buffer.readUInt8() as PlatformId
  buffer.readOffset += 3
  const size = buffer.readUInt32LE()
  const version = buffer.readUInt32LE()
  const type = buffer.readUInt32LE()

  return {
    magic,
    platformId,
    size,
    version,
    type,
  }
}

/**
 * SqPack index header structure
 * @see https://xiv.dev/data-files/sqpack#reading-index-data
 */
export const readSqPackIndexHeader = (
  buffer: SmartBuffer,
): SqPackIndexHeader => {
  const size = buffer.readUInt32LE()
  const version = buffer.readUInt32LE()
  const indexDataOffset = buffer.readUInt32LE()
  const indexDataSize = buffer.readUInt32LE()

  return {
    size,
    version,
    indexDataOffset,
    indexDataSize,
  }
}

/**
 * Validate SqPack magic bytes
 */
export const validateSqPackMagic = (magic: Buffer): boolean => {
  const expectedMagic = Buffer.from([
    0x53, 0x71, 0x50, 0x61, 0x63, 0x6b, 0x00, 0x00,
  ]) // "SqPack\0\0"
  return magic.equals(expectedMagic)
}
