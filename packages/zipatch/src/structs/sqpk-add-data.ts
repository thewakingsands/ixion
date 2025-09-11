/*
[StructLayout(LayoutKind.Explicit)]
struct SqpkAddData
{
    [FieldOffset(0x0)] byte reserved[3];
    [FieldOffset(0x3)] SqpkFile File; // Dat file
    [FieldOffset(0xB)] UInt32BE BlockOffset;
    [FieldOffset(0xF)] UInt32BE BlockCount;
    [FieldOffset(0x13)] UInt32BE BlockDeleteCount;
    [FieldOffset(0x17)] byte Data[BlockCount << 7]; // TODO: Not valid C#
}
*/

import type { SmartBuffer } from 'smart-buffer'
import {
  getBlockLength,
  readSqpkDataHeader,
  type SqpkDataHeader,
} from './sqpk-data-header'

export interface SqpkAddData extends SqpkDataHeader {
  blockDeleteCount: number

  byteDeleteCount: number
  data: Buffer
}

export const readSqpkAddData = (buffer: SmartBuffer): SqpkAddData => {
  const header = readSqpkDataHeader(buffer)
  const blockDeleteCount = buffer.readUInt32BE()
  const byteDeleteCount = getBlockLength(blockDeleteCount)

  const data = buffer.readBuffer(header.byteCount)

  return {
    ...header,
    blockDeleteCount,
    byteDeleteCount,
    data,
  }
}
