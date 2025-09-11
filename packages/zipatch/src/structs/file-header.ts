/*
Uint64 AlignBlockSize(UInt64 size) {
  return (size + 0x8F) & 0xFFFFFF80;
}

[StructLayout(Size = 0x1B)]
struct FileHeader
{
  [FieldOffset(0x00)] byte Operation;
  // padding: [u8; 2]
  [FieldOffset(0x03)] UInt64BE Offset;
  [FieldOffset(0x0B)] UInt64BE Size;
  [FieldOffset(0x13)] UInt32BE FilePathSize;
  [FieldOffset(0x17)] UInt16BE ExpansionId;
  // padding: [u8; 2]
}

[StructLayout(Size = 0x10)]
struct FileBlockHeader
{
  [FieldOffset(0x00)] UInt32LE Size;
  // padding: [u8; 4]
  [FieldOffset(0x08)] UInt32LE CompressedSize;
  [FieldOffset(0x0C)] UInt32LE DecompressedSize;

  bool IsBlockCompressed => CompressedSize != 32000;

  long BlockSize => IsBlockCompressed switch {
    true => CompressedSize,
    false => DecompressedSize,
  };

  long AlignedBlockSize => AlignBlockSize(BlockSize);
}
*/

import type { SmartBuffer } from 'smart-buffer'

export interface FileHeader {
  operation: number
  offset: bigint
  size: bigint
  filePathSize: number
  expansionId: number
  filePath: string
}

export interface FileBlockHeader {
  headerSize: number
  compressedSize: number
  decompressedSize: number
  isBlockCompressed: boolean
  blockSize: number
  alignedBlockSize: number
}

export const alignBlockSize = (size: number) => {
  return (size + 0x8f) & 0xffffff80
}

export const readFileHeader = (buffer: SmartBuffer): FileHeader => {
  const buf = buffer.readBuffer(0x1b)
  const operation = buf.readUInt8()
  const offset = buf.readBigUInt64BE(0x3)
  const size = buf.readBigUInt64BE(0xb)
  const filePathSize = buf.readUInt32BE(0x13)
  const expansionId = buf.readUInt16BE(0x17)

  const cursor = buffer.readOffset
  const filePath = buffer.readStringNT()
  buffer.readOffset = cursor + filePathSize

  return { operation, offset, size, filePathSize, expansionId, filePath }
}

export const readFileBlockHeader = (buffer: SmartBuffer): FileBlockHeader => {
  const buf = buffer.readBuffer(0x10)
  const headerSize = buf.readUInt32LE()
  const compressedSize = buf.readUInt32LE(0x8)
  const decompressedSize = buf.readUInt32LE(0xc)
  const isBlockCompressed = compressedSize !== 32000
  const blockSize = isBlockCompressed ? compressedSize : decompressedSize
  const alignedBlockSize = alignBlockSize(blockSize)
  return {
    headerSize,
    compressedSize,
    decompressedSize,
    isBlockCompressed,
    blockSize,
    alignedBlockSize,
  }
}
