export interface LgbVector3 {
  x: number
  y: number
  z: number
}
export interface LgbInstanceObject {
  assetType: number
  instanceId: number
  name: string
  transform: {
    translation: LgbVector3
    rotation: LgbVector3
    scale: LgbVector3
  }
}
export interface LgbLayer {
  layerId: number
  name: string
  festivalId: number
  festivalPhaseId: number
  instanceObjects: LgbInstanceObject[]
}
export interface LgbFile {
  fileId: string
  fileSize: number
  totalChunkCount: number
  chunkHeader: {
    chunkId: string
    chunkSize: number
    layerGroupId: number
    name: string
  }
  layers: LgbLayer[]
}

/** Reads LGB1/LGP1 layer and instance metadata. Asset-specific payloads are not decoded. */
export function readLgbFile(data: Buffer): LgbFile {
  let limit = data.length
  const check = (offset: number, size: number) => {
    if (
      !Number.isSafeInteger(offset) ||
      size < 0 ||
      offset < 0 ||
      offset + size > limit
    ) {
      throw new Error(`Invalid LGB range: ${offset}+${size} (size ${limit})`)
    }
  }
  const i32 = (offset: number) => {
    check(offset, 4)
    return data.readInt32LE(offset)
  }
  const u32 = (offset: number) => {
    check(offset, 4)
    return data.readUInt32LE(offset)
  }
  const string = (base: number, field: number) => {
    const relative = i32(field)
    if (!relative) return ''
    const offset = base + relative
    check(offset, 1)
    const end = data.indexOf(0, offset)
    if (end < 0 || end >= limit) throw new Error('Unterminated LGB string')
    return data.toString('utf8', offset, end)
  }
  const offsets = (base: number, count: number) => {
    check(base, count * 4)
    return Array.from({ length: count }, (_, i) => base + i32(base + i * 4))
  }
  const vector = (offset: number): LgbVector3 => {
    check(offset, 12)
    return {
      x: data.readFloatLE(offset),
      y: data.readFloatLE(offset + 4),
      z: data.readFloatLE(offset + 8),
    }
  }
  check(0, 36)
  const fileId = data.toString('ascii', 0, 4)
  const fileSize = i32(4)
  const totalChunkCount = i32(8)
  if (
    fileId !== 'LGB1' ||
    fileSize < 36 ||
    fileSize > data.length ||
    totalChunkCount !== 1
  )
    throw new Error('Invalid or unsupported LGB header')
  limit = fileSize
  const chunkId = data.toString('ascii', 12, 16)
  const chunkSize = i32(16)
  if (chunkId !== 'LGP1' || chunkSize < 24 || 12 + chunkSize > limit)
    throw new Error('Invalid LGB layer chunk')
  // Retail LGP1 files use 24 here (the chunk header only), while their
  // relative offsets reference layer data throughout the enclosing file.
  const chunkHeader = {
    chunkId,
    chunkSize,
    layerGroupId: i32(20),
    name: string(20, 24),
  }
  const layers = offsets(20 + i32(28), i32(32)).map((start): LgbLayer => {
    check(start, 52)
    const instanceObjects = offsets(
      start + i32(start + 8),
      i32(start + 12),
    ).map((offset): LgbInstanceObject => {
      check(offset, 48)
      return {
        assetType: i32(offset),
        instanceId: u32(offset + 4),
        name: string(offset, offset + 8),
        transform: {
          translation: vector(offset + 12),
          rotation: vector(offset + 24),
          scale: vector(offset + 36),
        },
      }
    })
    return {
      layerId: u32(start),
      name: string(start, start + 4),
      festivalId: data.readUInt16LE(start + 24),
      festivalPhaseId: data.readUInt16LE(start + 26),
      instanceObjects,
    }
  })
  return { fileId, fileSize, totalChunkCount, chunkHeader, layers }
}
