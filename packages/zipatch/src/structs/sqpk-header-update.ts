/*
enum FileKind : byte
{
  Dat = b'D',   // id.platform.datN
  Index = b'I', // id.platform.indexN
}

enum HeaderKind : byte
{
  Version = b'V',
  Data = b'D',
  Index = b'I',
}

struct HeaderChunkHeader
{
  [FieldOffset(0x00)] FileKind FileKind;
  [FieldOffset(0x01)] HeaderKind HeaderKind;
  [FieldOffset(0x03)] SqpkFilePath Path;
}
*/

import type { SmartBuffer } from 'smart-buffer'
import { readSqpkFile, type SqpkFile } from './sqpk-file'

export interface SqpkHeaderUpdate {
  fileKind: number
  headerKind: number
  file: SqpkFile
  data: Buffer
}

export enum FileKind {
  Dat = 68,
  Index = 73,
}

export enum HeaderKind {
  Version = 86,
  Data = 68,
  Index = 73,
}

export const readSqpkHeaderUpdate = (buffer: SmartBuffer): SqpkHeaderUpdate => {
  const fileKind = buffer.readUInt8()
  const headerKind = buffer.readUInt8()

  // unknown byte
  buffer.readOffset += 1

  const file = readSqpkFile(buffer)
  const data = buffer.readBuffer(1024)
  return { fileKind, headerKind, file, data }
}
