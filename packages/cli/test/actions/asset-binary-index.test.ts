import { calculateIndexHash, crc32 } from '@ffcafe/ixion-sqpack'
import { describe, expect, it } from 'vitest'
import {
  type AssetIndexSource,
  BinaryAssetIndex,
  encodeAssetIndex,
} from '../../src/actions/asset/binary-index'

const entries: AssetIndexSource[] = [
  { path: 'ui/icon/000000/000000.tex', sha256: '01'.repeat(32), format: 'webp' },
  { path: 'ui/icon/173000/chs/173812_hr1.tex', sha256: '02'.repeat(32), format: 'avif' },
  { path: 'ui/map/s1d1/00/s1d100_m.tex', sha256: '03'.repeat(32), format: 'webp' },
  { path: 'ui/map/s1d1/00/s1d100m_m.tex', sha256: '04'.repeat(32), format: 'avif' },
  { path: 'ui/map/s1d1/00/s1d100d.tex', sha256: '05'.repeat(32), format: 'tex' },
]

function checksum(buffer: Buffer) {
  buffer.writeUInt32LE((~crc32(buffer.subarray(64))) >>> 0, 28)
}

it('round trips icons, variants and maps through a deterministic shared index', () => {
  const buffer = encodeAssetIndex(entries)
  expect(buffer.equals(encodeAssetIndex([...entries].reverse()))).toBe(true)
  expect(buffer.length).toBe(64 + 44 * entries.length)
  expect(buffer.toString('ascii', 0, 4)).toBe('IXAS')
  expect(buffer.readUInt16LE(4)).toBe(1)
  expect(buffer.readUInt16LE(6)).toBe(64)
  expect(buffer.readUInt16LE(12)).toBe(44)
  expect(buffer.readUInt16LE(14)).toBe(1)
  const index = new BinaryAssetIndex(buffer)
  expect(index.count).toBe(entries.length)
  for (const { path, ...reference } of entries) {
    expect(index.lookup(path)).toEqual(reference)
    expect(index.lookup(path.toUpperCase())).toEqual(reference)
  }
  expect(index.lookup('ui/icon/999000/999999.tex')).toBeUndefined()
  // The validated index owns its bytes, so later caller mutations are harmless.
  buffer.fill(0)
  expect(index.lookup(entries[0].path)?.sha256).toBe(entries[0].sha256)
})

it('uses the SqPack little-endian hash layout and uncomplemented path CRC', () => {
  expect(crc32('123456789')).toBe(0x340bc6d9)
  expect((~crc32('123456789')) >>> 0).toBe(0xcbf43926)
  const entry = entries[0]
  const buffer = encodeAssetIndex([entry])
  expect(buffer.readUInt32LE(64)).toBe(crc32('000000.tex'))
  expect(buffer.readUInt32LE(68)).toBe(crc32('ui/icon/000000'))
  expect(buffer.readBigUInt64LE(64)).toBe(calculateIndexHash(entry.path))
  expect(buffer.subarray(72, 104)).toEqual(Buffer.from(entry.sha256, 'hex'))
  expect(buffer[104]).toBe(1)
  // Stable cross-language fixture: one icon with SHA-256 bytes all 0x01.
  expect(buffer.toString('hex')).toBe(
    '4958415301004000000000002c00010001000000400000006c000000f9b87a16' +
    '00'.repeat(32) +
    '0ae203872dc9c845' +
    '01'.repeat(32) +
    '01000000',
  )
})

it('supports an empty index with a zero IEEE payload checksum', () => {
  const buffer = encodeAssetIndex([])
  expect(buffer.length).toBe(64)
  expect(buffer.readUInt32LE(28)).toBe(0)
  const index = new BinaryAssetIndex(buffer)
  expect(index.count).toBe(0)
  expect(index.lookup(entries[0].path)).toBeUndefined()
})

it('rejects a real CRC collision even when both paths refer to the same asset', () => {
  const a = { ...entries[0], path: 'ui/icon/000000/15f019c1.tex' }
  const b = { ...a, path: 'ui/icon/000000/2be409ef.tex' }
  expect(calculateIndexHash(a.path)).toBe(calculateIndexHash(b.path))
  expect(() => encodeAssetIndex([a, b])).toThrow('collision')
})

it('rejects duplicate normalized paths', () => {
  expect(() => encodeAssetIndex([entries[0], { ...entries[0], path: entries[0].path.toUpperCase() }])).toThrow('Duplicate')
})

it.each(['', 'name.tex', '/ui/a.tex', 'ui//a.tex', 'ui/../a.tex', 'ui/./a.tex', 'ui\\a.tex', 'ui/a.tex ', `ui/${'x'.repeat(260)}.tex`])('rejects malformed paths: %s', (path) => {
  expect(() => encodeAssetIndex([{ ...entries[0], path }])).toThrow('Invalid game asset path')
  expect(() => new BinaryAssetIndex(encodeAssetIndex([])).lookup(path)).toThrow('Invalid game asset path')
})

it('rejects invalid asset hashes and unknown formats before writing', () => {
  expect(() => encodeAssetIndex([{ ...entries[0], sha256: 'bad' }])).toThrow('SHA-256')
  expect(() => encodeAssetIndex([{ ...entries[0], format: 'png' as never }])).toThrow('format')
})

describe('untrusted binary input', () => {
  it.each([
    ['magic', (b: Buffer) => b.write('FAIL', 0)],
    ['magic', (b: Buffer) => b.writeUInt8(b[0] | 0x80, 0)],
    ['version', (b: Buffer) => b.writeUInt16LE(2, 4)],
    ['header size', (b: Buffer) => b.writeUInt16LE(63, 6)],
    ['flags', (b: Buffer) => b.writeUInt32LE(1, 8)],
    ['record size', (b: Buffer) => b.writeUInt16LE(40, 12)],
    ['hash kind', (b: Buffer) => b.writeUInt16LE(2, 14)],
    ['file size', (b: Buffer) => b.writeUInt32LE(0xffffffff, 16)],
    ['record offset', (b: Buffer) => b.writeUInt32LE(65, 20)],
    ['file size', (b: Buffer) => b.writeUInt32LE(1, 24)],
    ['checksum', (b: Buffer) => b.writeUInt32LE((b.readUInt32LE(28) ^ 1) >>> 0, 28)],
    ['reserved header', (b: Buffer) => b.writeUInt8(1, 63)],
  ] as const)('rejects invalid %s', (message, mutate) => {
    const buffer = encodeAssetIndex(entries)
    mutate(buffer)
    expect(() => new BinaryAssetIndex(buffer)).toThrow(message)
  })

  it('rejects truncation, trailing bytes and corrupt payloads', () => {
    const buffer = encodeAssetIndex(entries)
    expect(() => new BinaryAssetIndex(buffer.subarray(0, 63))).toThrow('truncated header')
    expect(() => new BinaryAssetIndex(buffer.subarray(0, -1))).toThrow('file size')
    expect(() => new BinaryAssetIndex(Buffer.concat([buffer, Buffer.of(0)]))).toThrow('file size')
    buffer[80] ^= 1
    expect(() => new BinaryAssetIndex(buffer)).toThrow('checksum')
  })

  it('rejects duplicate and unsorted records even with a valid checksum', () => {
    for (const duplicate of [true, false]) {
      const buffer = encodeAssetIndex(entries)
      const first = Buffer.from(buffer.subarray(64, 108))
      if (!duplicate) buffer.copy(buffer, 64, 108, 152)
      first.copy(buffer, 108)
      checksum(buffer)
      expect(() => new BinaryAssetIndex(buffer)).toThrow('strictly increasing')
    }
  })

  it('rejects unknown format codes and reserved record fields', () => {
    for (const offset of [104, 105, 106, 107]) {
      const buffer = encodeAssetIndex(entries)
      buffer[offset] = 255
      checksum(buffer)
      expect(() => new BinaryAssetIndex(buffer)).toThrow(offset === 104 ? 'format' : 'reserved record')
    }
  })
})
