import type { SmartBuffer } from 'smart-buffer'
import { readSqpkFile, type SqpkFile } from './sqpk-file'

export interface SqpkDataHeader {
  reserved: Buffer
  file: SqpkFile
  blockOffset: number
  blockCount: number
  byteCount: number
  byteOffset: number
}

export const blockSize = 128
export const getBlockLength = (blockCount: number) => {
  return blockCount * blockSize
}

export const readSqpkDataHeader = (buffer: SmartBuffer): SqpkDataHeader => {
  const reserved = buffer.readBuffer(3)
  const file = readSqpkFile(buffer)
  const blockOffset = buffer.readUInt32BE()
  const blockCount = buffer.readUInt32BE()
  const byteCount = getBlockLength(blockCount)
  const byteOffset = getBlockLength(blockOffset)

  return {
    reserved,
    file,
    blockOffset,
    blockCount,
    byteCount,
    byteOffset,
  }
}

export const createEmptyBlockHeader = (blockCount: number) => {
  // Size = 128, Type = FileSize = UsedBlocks = 0, TotalBlocks = BlockCount
  const buffer = Buffer.alloc(blockSize, 0)
  buffer.writeUInt32LE(blockSize, 0)
  buffer.writeUInt32LE(blockCount, 0xc)

  return buffer
}
