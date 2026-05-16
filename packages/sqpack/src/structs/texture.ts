import type { SmartBuffer } from 'smart-buffer'

export enum ImageFormat {
  Unknown = 0x0,

  // Integer types
  L8 = 0x1130,
  A8 = 0x1131,
  B4G4R4A4 = 0x1440,
  B5G5R5A1 = 0x1441,
  B8G8R8A8 = 0x1450,
  B8G8R8X8 = 0x1451,

  // Floating point types
  R32F = 0x2150,
  R16G16F = 0x2250,
  R32G32F = 0x2260,
  R16G16B16A16F = 0x2460,
  R32G32B32A32F = 0x2470,

  // Block compression types (DX9 names)
  DXT1 = 0x3420,
  DXT3 = 0x3430,
  DXT5 = 0x3431,
  ATI2 = 0x6230,

  // Block compression types (DX11 names)
  BC1 = 0x3420,
  BC2 = 0x3430,
  BC3 = 0x3431,
  BC4 = 0x6120,
  BC5 = 0x6230,
  BC6H = 0x6330,
  BC7 = 0x6432,

  // Depth stencil types
  // Does not exist in ffxiv_dx11.exe: RGBA8 0x4401
  D16 = 0x4140,
  D24S8 = 0x4250,

  // Special types
  Null = 0x5100,
  Shadow16 = 0x5140,
  Shadow24 = 0x5150,
}

export interface SqPackTextureChunkInfo {
  offset: number
  compressedSize: number
  uncompressedSize: number
  blockOffset: number
  blockCount: number
}

export const readSqPackTextureChunkInfo = (
  buffer: SmartBuffer,
): SqPackTextureChunkInfo => {
  const offset = buffer.readUInt32LE()
  const compressedSize = buffer.readUInt32LE()
  const uncompressedSize = buffer.readUInt32LE()
  const blockOffset = buffer.readUInt32LE()
  const blockCount = buffer.readUInt32LE()

  return { offset, compressedSize, uncompressedSize, blockCount, blockOffset }
}

export const sqPackTextureHeaderSize = 0x50

export interface SqPackTextureHeader {
  attribute: number
  format: ImageFormat
  width: number
  height: number
  depth: number
  mipLevels: number
  arraySize: number
  lodOffsets: number[]
  surfaceOffsets: number[]
}

export const readSqPackTextureHeader = (
  buffer: SmartBuffer,
): SqPackTextureHeader => {
  const attribute = buffer.readUInt32LE()
  const format = buffer.readUInt32LE()
  const width = buffer.readUInt16LE()
  const height = buffer.readUInt16LE()
  const depth = buffer.readUInt16LE()
  const mipLevels = buffer.readUInt8()

  const arraySize = buffer.readUInt8()
  const lodOffsets = Array.from({ length: 3 }, () => buffer.readUInt32LE())

  const surfaceOffsets = Array.from({ length: 13 }, () => buffer.readUInt32LE())

  return {
    attribute,
    format,
    width,
    height,
    depth,
    mipLevels,
    arraySize,
    lodOffsets,
    surfaceOffsets,
  }
}
