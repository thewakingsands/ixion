import { calculateIndexHash, crc32 } from '@ffcafe/ixion-sqpack'
import type { AssetFormat } from './types'

export const assetIndexFileName = 'assets.bin'
export const assetIndexHeaderSize = 64
export const assetIndexRecordSize = 44

const magic = 'IXAS'
const version = 1
const hashKind = 1 // SqPack .index: directory CRC32 << 32 | filename CRC32.
const formats: readonly AssetFormat[] = ['webp', 'avif', 'tex']

export interface AssetIndexReference {
  sha256: string
  format: AssetFormat
}

export interface AssetIndexSource extends AssetIndexReference {
  path: string
}

export function normalizeAssetPath(path: string): string {
  const normalized = path.toLowerCase()
  if (
    normalized.length >= 260 ||
    !/^[a-z0-9_./-]+$/.test(normalized) ||
    !normalized.includes('/') ||
    normalized.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`Invalid game asset path: ${path}`)
  }
  return normalized
}

// SqPack's crc32 returns the uncomplemented state. The file checksum uses the
// standard CRC-32/IEEE final XOR instead, matching Go's crc32.ChecksumIEEE.
function payloadChecksum(payload: Buffer): number {
  return ~crc32(payload) >>> 0
}

export function encodeAssetIndex(entries: Iterable<AssetIndexSource>): Buffer {
  const records = [...entries].map((entry) => {
    const path = normalizeAssetPath(entry.path)
    if (!/^[0-9a-f]{64}$/.test(entry.sha256)) {
      throw new Error(`Invalid asset SHA-256 for ${path}`)
    }
    const format = formats.indexOf(entry.format) + 1
    if (!format) throw new Error(`Unsupported asset format for ${path}`)
    return { ...entry, path, format, hash: calculateIndexHash(path) }
  })
  records.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0))
  for (let i = 1; i < records.length; i++) {
    if (records[i - 1].hash === records[i].hash) {
      throw new Error(
        `Duplicate asset key or path hash collision: ${records[i - 1].path} and ${records[i].path}`,
      )
    }
  }

  const size = assetIndexHeaderSize + records.length * assetIndexRecordSize
  if (size > 0xffffffff)
    throw new Error('Asset index exceeds the v1 size limit')
  const buffer = Buffer.alloc(size)
  buffer.write(magic, 0, 'ascii')
  buffer.writeUInt16LE(version, 4)
  buffer.writeUInt16LE(assetIndexHeaderSize, 6)
  buffer.writeUInt16LE(assetIndexRecordSize, 12)
  buffer.writeUInt16LE(hashKind, 14)
  buffer.writeUInt32LE(records.length, 16)
  buffer.writeUInt32LE(assetIndexHeaderSize, 20)
  buffer.writeUInt32LE(size, 24)
  for (const [index, record] of records.entries()) {
    const offset = assetIndexHeaderSize + index * assetIndexRecordSize
    buffer.writeBigUInt64LE(record.hash, offset)
    Buffer.from(record.sha256, 'hex').copy(buffer, offset + 8)
    buffer.writeUInt8(record.format, offset + 40)
  }
  buffer.writeUInt32LE(
    payloadChecksum(buffer.subarray(assetIndexHeaderSize)),
    28,
  )
  return buffer
}

/** Validated, immutable-by-ownership index. Paths are not recoverable from it. */
export class BinaryAssetIndex {
  readonly count: number
  private readonly buffer: Buffer

  constructor(input: Buffer) {
    const invalid = (reason: string): never => {
      throw new Error(`Invalid assets.bin: ${reason}`)
    }
    if (input.length < assetIndexHeaderSize) invalid('truncated header')
    if (input.toString('utf8', 0, 4) !== magic) invalid('magic')
    if (input.readUInt16LE(4) !== version) invalid('unsupported version')
    if (input.readUInt16LE(6) !== assetIndexHeaderSize) invalid('header size')
    if (input.readUInt32LE(8) !== 0) invalid('unsupported flags')
    if (input.readUInt16LE(12) !== assetIndexRecordSize) invalid('record size')
    if (input.readUInt16LE(14) !== hashKind) invalid('unsupported hash kind')
    if (input.readUInt32LE(20) !== assetIndexHeaderSize)
      invalid('record offset')
    this.count = input.readUInt32LE(16)
    const expected = assetIndexHeaderSize + this.count * assetIndexRecordSize
    if (input.length !== expected || input.readUInt32LE(24) !== expected) {
      invalid('file size')
    }
    if (input.subarray(32, assetIndexHeaderSize).some((value) => value !== 0)) {
      invalid('reserved header bytes')
    }
    if (
      payloadChecksum(input.subarray(assetIndexHeaderSize)) !==
      input.readUInt32LE(28)
    ) {
      invalid('checksum')
    }
    let previous = -1n
    for (let i = 0; i < this.count; i++) {
      const offset = assetIndexHeaderSize + i * assetIndexRecordSize
      const hash = input.readBigUInt64LE(offset)
      if (hash <= previous) invalid('keys must be strictly increasing')
      previous = hash
      if (!formats[input[offset + 40] - 1]) invalid('unsupported asset format')
      if (
        input.subarray(offset + 41, offset + 44).some((value) => value !== 0)
      ) {
        invalid('reserved record bytes')
      }
    }
    this.buffer = Buffer.from(input)
  }

  lookup(path: string): AssetIndexReference | undefined {
    const key = calculateIndexHash(normalizeAssetPath(path))
    let low = 0
    let high = this.count
    while (low < high) {
      const mid = Math.floor((low + high) / 2)
      const offset = assetIndexHeaderSize + mid * assetIndexRecordSize
      const hash = this.buffer.readBigUInt64LE(offset)
      if (hash < key) low = mid + 1
      else if (hash > key) high = mid
      else {
        return {
          sha256: this.buffer.toString('hex', offset + 8, offset + 40),
          format: formats[this.buffer[offset + 40] - 1],
        }
      }
    }
    return undefined
  }
}
