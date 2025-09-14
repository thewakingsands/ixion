import type { SmartBuffer } from 'smart-buffer'

export enum FileType {
  Empty = 1,
  Standard = 2,
  Model = 3,
  Texture = 4,
}

export enum LodLevel {
  All = -1,
  Highest,
  High,
  Low,
  Max = 3,
}

export enum BlockType {
  Compressed = 16000,
  Uncompressed = 32000,
}

export const blockSize = 128

export interface SqPackFileInfo {
  size: number
  type: FileType
  rawFileSize: number
  numberOfBlocks: number
  usedNumberOfBlocks: number
}

export const readSqPackFileInfo = (buffer: SmartBuffer): SqPackFileInfo => {
  const size = buffer.readUInt32LE()
  const type = buffer.readUInt32LE()
  const rawFileSize = buffer.readUInt32LE()
  const numberOfBlocks = buffer.readUInt32LE()
  const usedNumberOfBlocks = buffer.readUInt32LE()

  return { size, type, rawFileSize, numberOfBlocks, usedNumberOfBlocks }
}

export interface SqPackDataBlockHeader {
  size: number
  __unknown: number
  compressedSize: number
  uncompressedSize: number
}

export const readSqPackDataBlockHeader = (
  buffer: SmartBuffer,
): SqPackDataBlockHeader => {
  const size = buffer.readUInt32LE()
  const __unknown = buffer.readUInt32LE()
  const compressedSize = buffer.readUInt32LE()
  const uncompressedSize = buffer.readUInt32LE()

  return { size, __unknown, compressedSize, uncompressedSize }
}

export interface SqPackStandardBlockInfo {
  offset: number
  compressedSize: number
  uncompressedSize: number
}

export const readSqPackStandardBlockInfo = (
  buffer: SmartBuffer,
): SqPackStandardBlockInfo => {
  const offset = buffer.readUInt32LE()
  const compressedSize = buffer.readUInt16LE()
  const uncompressedSize = buffer.readUInt16LE()

  return { offset, compressedSize, uncompressedSize }
}

/**
 * Write SqPack file info structure
 */
export const writeSqPackFileInfo = (
  buffer: SmartBuffer,
  fileInfo: SqPackFileInfo,
): void => {
  buffer.writeUInt32LE(fileInfo.size)
  buffer.writeUInt32LE(fileInfo.type)
  buffer.writeUInt32LE(fileInfo.rawFileSize)
  buffer.writeUInt32LE(fileInfo.numberOfBlocks)
  buffer.writeUInt32LE(fileInfo.usedNumberOfBlocks)
}

/**
 * Write SqPack data block header structure
 */
export const writeSqPackDataBlockHeader = (
  buffer: SmartBuffer,
  blockHeader: SqPackDataBlockHeader,
): void => {
  buffer.writeUInt32LE(blockHeader.size)
  buffer.writeUInt32LE(blockHeader.__unknown)
  buffer.writeUInt32LE(blockHeader.compressedSize)
  buffer.writeUInt32LE(blockHeader.uncompressedSize)
}

/**
 * Write SqPack standard block info structure
 */
export const writeSqPackStandardBlockInfo = (
  buffer: SmartBuffer,
  blockInfo: SqPackStandardBlockInfo,
): void => {
  buffer.writeUInt32LE(blockInfo.offset)
  buffer.writeUInt16LE(blockInfo.compressedSize)
  buffer.writeUInt16LE(blockInfo.uncompressedSize)
}
