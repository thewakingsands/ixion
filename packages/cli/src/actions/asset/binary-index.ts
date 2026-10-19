import { calculateIndexHash, crc32 } from '@ffcafe/elpis-sqpack'
import type { AssetFormat } from './types'

export const assetIndexFileName = 'assets.bin'
export const assetIndexHeaderSize = 64
export const assetIndexRecordSize = 20
export const assetChunkRecordSize = 24
export const assetSizeLimit = 64 * 1024 * 1024
const formats: readonly AssetFormat[] = ['webp', 'avif', 'tex']
export interface AssetIndexReference {
  chunk: string
  chunkSize: number
  offset: number
  size: number
  format: AssetFormat
}
export interface AssetIndexSource extends AssetIndexReference {
  path: string
}
export function normalizeAssetPath(path: string): string {
  const p = path.toLowerCase()
  if (
    p.length >= 260 ||
    !/^[a-z0-9_./-]+$/.test(p) ||
    !p.includes('/') ||
    p.split('/').some((s) => !s || s === '.' || s === '..')
  )
    throw new Error(`Invalid game asset path: ${path}`)
  return p
}
const checksum = (b: Buffer) => ~crc32(b) >>> 0
function uuid(b: Buffer) {
  const h = b.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
export function encodeAssetIndex(entries: Iterable<AssetIndexSource>): Buffer {
  const records = [...entries]
    .map((e) => ({
      ...e,
      hash: calculateIndexHash(normalizeAssetPath(e.path)),
    }))
    .sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0))
  const chunks = new Map<string, number>()
  for (let i = 0; i < records.length; i++) {
    const r = records[i]
    if (i && records[i - 1].hash === r.hash)
      throw new Error('Duplicate asset key or path hash collision')
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(r.chunk))
      throw new Error('Invalid chunk UUID')
    if (
      ![r.chunkSize, r.offset, r.size].every(Number.isSafeInteger) ||
      r.chunkSize <= 0 ||
      r.chunkSize > assetSizeLimit ||
      r.offset < 0 ||
      r.size <= 0 ||
      r.offset + r.size > r.chunkSize ||
      !formats.includes(r.format)
    )
      throw new Error('Invalid asset range or format')
    if (chunks.has(r.chunk) && chunks.get(r.chunk) !== r.chunkSize)
      throw new Error('Conflicting chunk size')
    chunks.set(r.chunk, r.chunkSize)
  }
  const list = [...chunks].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  if (list.length > 65536)
    throw new Error('Too many chunks: maximum 65536 per snapshot')
  const ids = new Map(list.map(([id], i) => [id, i]))
  const at = 64 + list.length * 24,
    length = at + records.length * 20
  if (length > 0xffffffff) throw new Error('Asset index exceeds size limit')
  const b = Buffer.alloc(length)
  b.write('IXAS')
  b.writeUInt16LE(2, 4)
  b.writeUInt16LE(64, 6)
  b.writeUInt16LE(20, 12)
  b.writeUInt16LE(1, 14)
  b.writeUInt32LE(records.length, 16)
  b.writeUInt32LE(at, 20)
  b.writeUInt32LE(length, 24)
  b.writeUInt32LE(list.length, 32)
  b.writeUInt32LE(64, 36)
  b.writeUInt16LE(24, 40)
  list.forEach(([id, size], i) => {
    const pos = 64 + i * 24
    Buffer.from(id.replaceAll('-', ''), 'hex').copy(b, pos)
    b.writeUInt32LE(size, pos + 16)
  })
  records.forEach((r, i) => {
    const pos = at + i * 20
    b.writeBigUInt64LE(r.hash, pos)
    b.writeUInt32LE(r.offset, pos + 8)
    b.writeUInt32LE(r.size, pos + 12)
    const chunkIndex = ids.get(r.chunk)
    if (chunkIndex === undefined) throw new Error('Missing chunk table entry')
    b.writeUInt16LE(chunkIndex, pos + 16)
    b[pos + 18] = formats.indexOf(r.format) + 1
  })
  b.writeUInt32LE(checksum(b.subarray(64)), 28)
  return b
}
export class BinaryAssetIndex {
  readonly count: number
  readonly chunks: ReadonlyArray<{ id: string; size: number }>
  private readonly buffer: Buffer
  private readonly recordsAt: number
  constructor(input: Buffer) {
    const bad = (s: string): never => {
      throw new Error(`Invalid assets.bin: ${s}`)
    }
    if (input.length < 64) bad('truncated header')
    const b = Buffer.from(input)
    if (b.toString('ascii', 0, 4) !== 'IXAS' || b.readUInt16LE(4) !== 2)
      bad('unsupported format')
    if (
      b.readUInt16LE(6) !== 64 ||
      b.readUInt32LE(8) !== 0 ||
      b.readUInt16LE(12) !== 20 ||
      b.readUInt16LE(14) !== 1 ||
      b.readUInt32LE(36) !== 64 ||
      b.readUInt16LE(40) !== 24 ||
      b.subarray(42, 64).some((v) => v !== 0)
    )
      bad('header')
    this.count = b.readUInt32LE(16)
    const count = b.readUInt32LE(32)
    this.recordsAt = b.readUInt32LE(20)
    if (
      count > 65536 ||
      this.recordsAt !== 64 + count * 24 ||
      b.length !== this.recordsAt + this.count * 20 ||
      b.readUInt32LE(24) !== b.length
    )
      bad('size')
    if (checksum(b.subarray(64)) !== b.readUInt32LE(28)) bad('checksum')
    const chunks: Array<{ id: string; size: number }> = []
    for (let i = 0; i < count; i++) {
      const at = 64 + i * 24,
        id = uuid(b.subarray(at, at + 16)),
        size = b.readUInt32LE(at + 16)
      if (
        (i && chunks[i - 1].id >= id) ||
        !size ||
        size > assetSizeLimit ||
        b.readUInt32LE(at + 20)
      )
        bad('chunk')
      chunks.push({ id, size })
    }
    let previous = -1n
    const used = new Set<number>()
    for (let i = 0; i < this.count; i++) {
      const at = this.recordsAt + i * 20,
        key = b.readBigUInt64LE(at),
        ci = b.readUInt16LE(at + 16)
      const size = b.readUInt32LE(at + 12),
        offset = b.readUInt32LE(at + 8)
      if (key <= previous || !formats[b[at + 18] - 1] || b[at + 19] !== 0)
        bad('record')
      if (ci >= count || !size || offset + size > chunks[ci].size) bad('range')
      previous = key
      used.add(ci)
    }
    if (used.size !== count) bad('unreferenced chunk')
    this.chunks = chunks
    this.buffer = b
  }
  lookup(path: string): AssetIndexReference | undefined {
    const key = calculateIndexHash(normalizeAssetPath(path))
    let lo = 0,
      hi = this.count
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2),
        at = this.recordsAt + mid * 20,
        found = this.buffer.readBigUInt64LE(at)
      if (found < key) lo = mid + 1
      else if (found > key) hi = mid
      else {
        const c = this.chunks[this.buffer.readUInt16LE(at + 16)]
        return {
          chunk: c.id,
          chunkSize: c.size,
          offset: this.buffer.readUInt32LE(at + 8),
          size: this.buffer.readUInt32LE(at + 12),
          format: formats[this.buffer[at + 18] - 1],
        }
      }
    }
    return undefined
  }
}
