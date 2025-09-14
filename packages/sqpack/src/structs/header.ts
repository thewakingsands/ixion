import { SmartBuffer } from 'smart-buffer'
import type { PlatformId } from '../interface'
import { calculateSqPackHash, sqPackHashSize } from '../utils/hash'

export interface SqPackHeader {
  magic: string
  platformId: PlatformId
  size: number
  version: number
  type: number
  buildDate: number
  buildTime: number
}

// https://github.com/NotAdam/Lumina/blob/master/src/Lumina/Data/Structs/SqPackIndexHeader.cs
export interface SqPackIndexHeader {
  size: number
  version: number
  indexDataOffset: number
  indexDataSize: number
  indexDataHash: Buffer
  numberOfDataFile: number
  synonymOffset: number
  synonymSize: number
  synonymHash: Buffer
  emptyBlockOffset: number
  emptyBlockSize: number
  emptyBlockHash: Buffer
  dirIndexOffset: number
  dirIndexSize: number
  dirIndexHash: Buffer
}

export enum SqPackType {
  Data = 1,
  Index = 2,
}

const sqpackVersion = 1
const headerSize = 0x400
const hashOffset = headerSize - sqPackHashSize
const sqpackMagic = 'SqPack\0\0'

/**
 * SqPack header structure
 * @see https://xiv.dev/data-files/sqpack#reading-index-data
 */
export const readSqPackHeader = (buffer: SmartBuffer): SqPackHeader => {
  const magic = buffer.readString(8)
  const platformId = buffer.readUInt8() as PlatformId
  buffer.readOffset += 3
  const size = buffer.readUInt32LE()
  const version = buffer.readUInt32LE()
  const type = buffer.readUInt32LE() as SqPackType
  const buildDate = buffer.readUInt32LE() // yyyymmdd
  const buildTime = buffer.readUInt32LE() // hhmmss00

  return {
    magic,
    platformId,
    size,
    version,
    type,
    buildDate,
    buildTime,
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
  const indexDataHash = buffer.readBuffer(sqPackHashSize)
  const numberOfDataFile = buffer.readUInt32LE()
  const synonymOffset = buffer.readUInt32LE()
  const synonymSize = buffer.readUInt32LE()
  const synonymHash = buffer.readBuffer(sqPackHashSize)
  const emptyBlockOffset = buffer.readUInt32LE()
  const emptyBlockSize = buffer.readUInt32LE()
  const emptyBlockHash = buffer.readBuffer(sqPackHashSize)
  const dirIndexOffset = buffer.readUInt32LE()
  const dirIndexSize = buffer.readUInt32LE()
  const dirIndexHash = buffer.readBuffer(sqPackHashSize)
  return {
    size,
    version,
    indexDataOffset,
    indexDataSize,
    indexDataHash,
    numberOfDataFile,
    synonymOffset,
    synonymSize,
    synonymHash,
    emptyBlockOffset,
    emptyBlockSize,
    emptyBlockHash,
    dirIndexOffset,
    dirIndexSize,
    dirIndexHash,
  }
}

/**
 * Write SqPack header structure
 */
export const writeSqPackHeader = (
  buffer: SmartBuffer,
  header: SqPackHeader,
): void => {
  const headerBuffer = Buffer.alloc(headerSize)
  const innerBuffer = SmartBuffer.fromBuffer(headerBuffer)
  innerBuffer.writeString(header.magic)
  innerBuffer.writeUInt8(header.platformId)
  innerBuffer.writeUInt8(0) // Padding
  innerBuffer.writeUInt8(0) // Padding
  innerBuffer.writeUInt8(0) // Padding
  innerBuffer.writeUInt32LE(header.size)
  innerBuffer.writeUInt32LE(header.version)
  innerBuffer.writeUInt32LE(header.type)
  innerBuffer.writeUInt32LE(header.buildDate)
  innerBuffer.writeUInt32LE(header.buildTime)

  // write hash
  const bufferToHash = headerBuffer.subarray(0, hashOffset)
  const hash = calculateSqPackHash(bufferToHash)

  innerBuffer.writeOffset = hashOffset
  innerBuffer.writeBuffer(hash)

  buffer.writeBuffer(headerBuffer)
}

/**
 * Write SqPack index header structure
 */
export const writeSqPackIndexHeader = (
  buffer: SmartBuffer,
  header: SqPackIndexHeader,
): void => {
  if (header.dirIndexHash.length !== sqPackHashSize) {
    throw new Error('dirIndexHash must be 0x40 bytes')
  }
  if (header.indexDataHash.length !== sqPackHashSize) {
    throw new Error('indexDataHash must be 0x40 bytes')
  }
  if (header.synonymHash.length !== sqPackHashSize) {
    throw new Error('synonymHash must be 0x40 bytes')
  }
  if (header.emptyBlockHash.length !== sqPackHashSize) {
    throw new Error('emptyBlockHash must be 0x40 bytes')
  }

  const headerBuffer = Buffer.alloc(headerSize)
  const innerBuffer = SmartBuffer.fromBuffer(headerBuffer)
  innerBuffer.writeUInt32LE(header.size)
  innerBuffer.writeUInt32LE(header.version)
  innerBuffer.writeUInt32LE(header.indexDataOffset)
  innerBuffer.writeUInt32LE(header.indexDataSize)
  innerBuffer.writeBuffer(header.indexDataHash)
  innerBuffer.writeUInt32LE(header.numberOfDataFile)
  innerBuffer.writeUInt32LE(header.synonymOffset)
  innerBuffer.writeUInt32LE(header.synonymSize)
  innerBuffer.writeBuffer(header.synonymHash)
  innerBuffer.writeUInt32LE(header.emptyBlockOffset)
  innerBuffer.writeUInt32LE(header.emptyBlockSize)
  innerBuffer.writeBuffer(header.emptyBlockHash)
  innerBuffer.writeUInt32LE(header.dirIndexOffset)
  innerBuffer.writeUInt32LE(header.dirIndexSize)
  innerBuffer.writeBuffer(header.dirIndexHash)

  // write hash
  const bufferToHash = headerBuffer.subarray(0, hashOffset)
  const hash = calculateSqPackHash(bufferToHash)

  innerBuffer.writeOffset = hashOffset
  innerBuffer.writeBuffer(hash)

  buffer.writeBuffer(headerBuffer)
}

/**
 * Validate SqPack magic bytes
 */
export const validateSqPackMagic = (magic: string): boolean => {
  return magic === sqpackMagic
}

/**
 * Create SqPack header structure
 */
export const createSqPackHeader = (
  buffer: SmartBuffer,
  {
    platformId,
    type,
    buildDate,
    buildTime,
  }: Pick<SqPackHeader, 'platformId' | 'type' | 'buildDate' | 'buildTime'>,
) => {
  writeSqPackHeader(buffer, {
    magic: sqpackMagic,
    platformId,
    size: headerSize,
    version: sqpackVersion,
    type,
    buildDate,
    buildTime,
  })
}
