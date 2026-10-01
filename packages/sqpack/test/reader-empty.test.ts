import { expect, it, vi } from 'vitest'
import { SqPackReader } from '../src/reader'
import { FileType } from '../src/structs/sqpack-data'
import { calculateIndexHash } from '../src/utils/hash'

const path = 'ui/icon/173000/chs/173812.tex'

function fixture(type: FileType) {
  const header = Buffer.alloc(128)
  header.writeUInt32LE(128, 0)
  header.writeUInt32LE(type, 4)
  header.writeUInt32LE(0, 8)
  header.writeUInt32LE(171, 12)
  const read = vi.fn(async (buffer: Buffer) => header.copy(buffer))
  const close = vi.fn(async () => {})
  const reader = new SqPackReader({
    prefix: 'fixture',
    indexEntries: new Map([[calculateIndexHash(path), { dataFileId: 0, offset: 0 }]]),
    open: async () => ({ read, readFile: async () => header, close }),
  })
  return { reader, read, close }
}

it('treats an indexed Empty placeholder as absent without trying to decode it', async () => {
  const { reader, read, close } = fixture(FileType.Empty)
  try {
    expect(await reader.hasFile(path)).toBe(true)
    expect(await reader.readFile(path)).toBeNull()
    expect(read).toHaveBeenCalledOnce()
  } finally { await reader.close() }
  expect(close).toHaveBeenCalledOnce()
})

it.each([FileType.Standard, FileType.Texture])('still rejects an unexpected zero-length file of type %s', async (type) => {
  const { reader } = fixture(type)
  try { await expect(reader.readFile(path)).rejects.toThrow(`File ${path} is empty`) }
  finally { await reader.close() }
})

it('does not hide an I/O error while reading a possible placeholder', async () => {
  const { reader, read } = fixture(FileType.Empty)
  read.mockRejectedValueOnce(new Error('read failed'))
  try { await expect(reader.readFile(path)).rejects.toThrow('read failed') }
  finally { await reader.close() }
})
