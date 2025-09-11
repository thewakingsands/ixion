/*
[StructLayout(LayoutKind.Explicit, Size = 8)]
struct SqpkFile
{
    [FieldOffset(0x0)] UInt16BE MainId;
    [FieldOffset(0x2)] UInt16BE SubId;
    [FieldOffset(0x4)] UInt32BE FileId;

    // Expansion => (byte)(SubId >> 8);
    // DatFileName => $"{MainId:x2}{SubId:x4}.win32.dat{FileId}"
    // IndexFileName => $"{MainId:x2}{SubId:x4}.win32.index{(FileId == 0 ? string.Empty : FileId.ToString())}"
}
*/

import type { SmartBuffer } from 'smart-buffer'

export interface SqpkFile {
  mainId: number
  subId: number
  fileId: number
}

export interface SqpkFileWithType extends SqpkFile {
  isIndex: boolean
}

export const readSqpkFile = (buffer: SmartBuffer): SqpkFile => {
  return {
    mainId: buffer.readUInt16BE(),
    subId: buffer.readUInt16BE(),
    fileId: buffer.readUInt32BE(),
  }
}

export const getSqpkFileName = (file: SqpkFile, isIndex: boolean): string => {
  return `${file.mainId.toString(16).padStart(2, '0')}${file.subId.toString(16).padStart(4, '0')}.win32.${isIndex ? 'index' : 'dat'}${file.fileId.toString()}`
}

export const getSqpkExpansion = (file: SqpkFile): number => {
  return file.subId >> 8
}

const expansionNames = [
  'ffxiv',
  'ex1',
  'ex2',
  'ex3',
  'ex4',
  'ex5',
  'ex6',
  'ex7',
  'ex8',
  'ex9',
]
export const getSqpkFilePath = (file: SqpkFile, isIndex: boolean): string => {
  return `sqpack/${expansionNames[getSqpkExpansion(file)]}/${getSqpkFileName(file, isIndex)}`
}
