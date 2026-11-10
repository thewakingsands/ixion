import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqPackReader, SqPackWriter } from '@ffcafe/elpis-sqpack'
import { expect, it, onTestFinished, vi } from 'vitest'
import { createAssetStateEntry, processTextures } from '../../src/actions/asset/patch'
import { uiSqPackFile } from '../../src/config'
import { PatchFileSystem } from '../../src/utils/patch-fs'

const oldPath = 'ui/icon/009000/009000.tex'
const newPath = 'ui/icon/009000/009001.tex'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ixion-patch-data-'))
  const fs = new PatchFileSystem(join(root, 'patch'))
  onTestFinished(async () => {
    await fs.close()
    await rm(root, { recursive: true, force: true })
  })
  const prefix = join(root, '060000.win32')
  const writer = new SqPackWriter({ prefix })
  await writer.addFile(oldPath, Buffer.from('old texture'))
  await writer.addFile(newPath, Buffer.from('new texture'))
  await writer.close()
  const reader = await SqPackReader.open({ prefix })
  const oldFile = (await reader.getFileIndex(oldPath))!
  const newFile = (await reader.getFileIndex(newPath))!
  await reader.close()
  const data = await readFile(`${prefix}.dat0`)
  await fs.write(`${uiSqPackFile}.index`, await readFile(`${prefix}.index`))
  const datPath = `${uiSqPackFile}.dat0`
  await fs.write(datPath, data.subarray(newFile.offset), newFile.offset)
  const previous = createAssetStateEntry(oldPath, 'old-hash', 'webp')
  const state = new Map([[oldPath, previous]])
  const encode = vi.fn(async () => ({ format: 'webp' as const, persisted: true }))
  const run = async () => {
    await fs.close()
    return processTextures({
      paths: [oldPath, newPath],
      iconState: state,
      storage: { fs, ensureEncodedAsset: encode },
    })
  }
  return { fs, data, datPath, oldFile, previous, state, encode, run }
}

it('preserves existing assets absent from a sparse patch and encodes available assets', async () => {
  const f = await fixture()
  const changes = await f.run()
  expect(f.state.get(oldPath)).toEqual(f.previous)
  expect(changes.removed).toEqual([])
  expect(changes.unreferenced).toEqual([])
  expect(changes.added.map((entry) => entry.path)).toEqual([newPath])
  expect(f.encode).toHaveBeenCalledOnce()
})

it('skips newly referenced assets whose bytes are absent from the patch', async () => {
  const f = await fixture()
  f.state.clear()
  const changes = await f.run()
  expect(f.state.has(oldPath)).toBe(false)
  expect(changes.added.map((entry) => entry.path)).toEqual([newPath])
})

it('preserves an asset when its header is present but its body is absent', async () => {
  const f = await fixture()
  await f.fs.write(f.datPath, f.data.subarray(f.oldFile.offset, f.oldFile.offset + 128), f.oldFile.offset)
  const changes = await f.run()
  expect(f.state.get(oldPath)).toEqual(f.previous)
  expect(changes.removed).toEqual([])
  expect(f.encode).toHaveBeenCalledOnce()
})

it('still removes an asset explicitly replaced by an Empty entry', async () => {
  const f = await fixture()
  const header = Buffer.alloc(128)
  header.writeUInt32LE(128, 0)
  header.writeUInt32LE(1, 4)
  await f.fs.write(f.datPath, header, f.oldFile.offset)
  const changes = await f.run()
  expect(f.state.has(oldPath)).toBe(false)
  expect(changes.removed).toEqual([f.previous])
  expect(changes.unreferenced).toEqual(['old-hash'])
})

it.each([2, 4])('rejects a zero-length file of type %s when its header is present', async (type) => {
  const f = await fixture()
  const header = Buffer.alloc(128)
  header.writeUInt32LE(128, 0)
  header.writeUInt32LE(type, 4)
  await f.fs.write(f.datPath, header, f.oldFile.offset)
  await expect(f.run()).rejects.toThrow(`File ${oldPath} is empty`)
})

it('propagates I/O failures instead of treating them as absent patch data', async () => {
  const f = await fixture()
  const original = f.fs.readFile.bind(f.fs)
  vi.spyOn(f.fs, 'readFile').mockImplementation(async (path, start, end) => {
    if (path === f.datPath) throw new Error('disk read failed')
    return original(path, start, end)
  })
  await expect(f.run()).rejects.toThrow('disk read failed')
})
