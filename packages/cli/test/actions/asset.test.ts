import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  EXDWriter, ExcelColumnDataType, ExcelVariant, type ExhHeader,
  SqPackReader, SqPackWriter, writeExhHeader, writeExlFile, calculateIndexHash,
} from '@ffcafe/ixion-sqpack'
import { StorageManager } from '@ffcafe/ixion-storage'
import { formatTex } from '@ffcafe/ixion-tex'
import { expect, it, vi } from 'vitest'
import { extractLocalUiAssets } from '../../src/actions/asset-local'
import { syncUiAssetsToRemoteStorage } from '../../src/actions/asset-ui-icons'
import { createAssetStateEntry, processTextures } from '../../src/actions/asset/patch'
import { BinaryAssetIndex } from '../../src/actions/asset/binary-index'
import { AssetCatalog } from '../../src/actions/asset/catalog'
import { AssetStorage } from '../../src/actions/asset/storage'
import type { UiAssetEntry } from '../../src/actions/asset/types'
import { generateLocalAssetPaths, validateIndexFile } from '../../src/actions/asset/ui-index'
import type { PatchFileSystem } from '../../src/utils/patch-fs'
import type { ResolvedIndexMap } from '../../src/utils/sqpack-index'
import { getStorageManager } from '../../src/utils/storage'

vi.mock('@ffcafe/ixion-tex', () => ({ formatTex: vi.fn(async (data: Buffer) => ({ format: 'webp', data })) }))
vi.mock('../../src/utils/storage', () => ({ getStorageManager: vi.fn() }))

const references = { icons: [51474], maps: ['s1d1/00'] }
const icon = 'ui/icon/051000/051474.tex'
const map = 'ui/map/s1d1/00/s1d100m_m.tex'

function fixtureIndex(paths: string[]): ResolvedIndexMap {
  const index: ResolvedIndexMap = new Map()
  for (const path of paths) {
    const hash = calculateIndexHash(path)
    const directoryHash = Number(hash >> 32n)
    let directory = index.get(directoryHash)
    if (!directory) {
      directory = { files: new Map() }
      index.set(directoryHash, directory)
    }
    directory.files.set(hash, { path, dataFileId: 0, offset: 0 })
  }
  return index
}

it('adds, deduplicates, updates and removes referenced map textures alongside icons', async () => {
  const files = new Map([[icon, Buffer.from('shared')], [map, Buffer.from('shared')]])
  const reader = { readFile: async (path: string) => files.get(path) ?? null }
  const ensureEncodedAsset = vi.fn(async () => ({ format: 'webp' as const, persisted: true }))
  const state = new Map<string, UiAssetEntry>()
  const index = fixtureIndex([icon, map])
  const run = (uiIndex = index, previousUiIndex = index) => processTextures({ storage: { ensureEncodedAsset }, reader, iconState: state, uiIndex, previousUiIndex })
  expect((await run()).added).toHaveLength(2)
  expect(state.get(map)).toMatchObject({ territory: 's1d1', index: '00', variant: 'm_m' })
  expect((await run()).added).toHaveLength(0)
  expect(ensureEncodedAsset).toHaveBeenCalledTimes(1)
  files.set(map, Buffer.from('changed'))
  const changed = await run()
  expect(changed.edited).toHaveLength(1)
  // The icon still references the old hash.
  expect(changed.unreferenced).toEqual([])
  const removed = await run(fixtureIndex([icon]))
  expect(removed.removed).toHaveLength(1)
  expect(removed.unreferenced).toHaveLength(1)
})

it.each(['_m', 'm_m', 'd'])('retains the map variant %s', (variant) => {
  expect(createAssetStateEntry(`ui/map/s1d1/00/s1d100${variant}.tex`, 'hash', 'webp')).toMatchObject({ variant })
})

it('uses real SqPack indexes for patch selection and full local extraction', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ixion-assets-'))
  const game = join(root, 'game')
  const server = 'cn-test'
  const version = '2026.09.01.0000.0000'
  const output = join(root, 'storage/custom-ui', server)
  const manifests = join(output, 'patches', version)
  const manager = new StorageManager([
    { name: 'local', type: 'local', config: { rootPath: join(root, 'storage'), paths: { ui: 'custom-ui' } } },
    { name: 'minio', type: 'local', config: { rootPath: join(root, 'remote'), paths: { ui: 'custom-ui' } } },
  ])
  vi.mocked(getStorageManager).mockReturnValue(manager)
  const pack = join(game, 'sqpack/ffxiv')
  await mkdir(pack, { recursive: true })
  await writeFile(join(game, 'ffxivgame.ver'), version)
  const exd = new SqPackWriter({ prefix: join(pack, '0a0000.win32') })
  const ui = new SqPackWriter({ prefix: join(pack, '060000.win32') })
  try {
    await exd.addFile('exd/root.exl', writeExlFile({ magic: 'EXLT', version: 2, entries: [{ name: 'Item', id: 1 }, { name: 'Map', id: 2 }] }))
    for (const sheet of ['Item', 'Map']) {
      const header: ExhHeader = {
        magic: 'EXHF', version: 3, dataOffset: 4, columnCount: 1,
        pageCount: 1, languageCount: 1, unknown1: 0, u2: 0, variant: ExcelVariant.Default,
        u3: 0, rowCount: 1, u4: 0, u5: 0,
        columns: [{ offset: 0, type: sheet === 'Map' ? ExcelColumnDataType.String : ExcelColumnDataType.Int32 }],
        paginations: [{ startId: 0, rowCount: 1 }], languages: [0],
      }
      const writer = new EXDWriter(header)
      writer.writeRows([{ rowId: 1, data: [sheet === 'Map' ? Buffer.from('s1d1/00') : 51474] }])
      await exd.addFile(`exd/${sheet}.exh`, writeExhHeader(header))
      await exd.addFile(`exd/${sheet}_0.exd`, writer.output())
    }
    await ui.addFile(icon, Buffer.from('same texture'))
    await ui.addFile(map, Buffer.from('same texture'))
    const extraIcons = [
      'ui/icon/099000/099999.tex', 'ui/icon/000000/000000.tex',
      'ui/icon/054000/054522_hr1.tex', 'ui/icon/999000/cht/999999_hr1.tex',
      'ui/icon/999000/kr/999999.tex',
    ]
    for (const path of extraIcons) await ui.addFile(path, Buffer.from('unreferenced'))
    await ui.addFile('ui/map/z9z9/99/z9z999_m.tex', Buffer.from('unreferenced map'))
    await exd.close()
    await ui.close()
    const fs = { readFile: async () => readFile(join(pack, '060000.win32.index')) } as unknown as PatchFileSystem
    const index = await validateIndexFile(fs, references)
    expect(index).not.toBeNull()
    const resolvedPaths = [...index!.values()].flatMap((entry) => [...entry.files.values()].flatMap((file) => file.path ? [file.path] : []))
    expect(resolvedPaths.sort()).toEqual([icon, map, ...extraIcons].sort())
    const iconOnlyIndex = await validateIndexFile(fs, { icons: [], maps: [] })
    expect([...iconOnlyIndex!.values()].flatMap((entry) => [...entry.files.values()].filter((file) => file.path))).toHaveLength(6)
    const localPaths: string[] = []
    for await (const path of generateLocalAssetPaths(game, references)) localPaths.push(path)
    expect(localPaths.sort()).toEqual(resolvedPaths.sort())
    const reader = await SqPackReader.open({ prefix: join(pack, '060000.win32') })
    const open = vi.spyOn(SqPackReader, 'open').mockResolvedValueOnce(reader)
    const state = new Map<string, UiAssetEntry>()
    try {
      const changes = await processTextures({ storage: { fs: { open: vi.fn() } as unknown as PatchFileSystem, ensureEncodedAsset: async () => ({ format: 'webp', persisted: true }) }, iconState: state, uiIndex: index! })
      expect(changes.added).toHaveLength(7)
    } finally {
      open.mockRestore()
    }
    const definitions = {
      getFlatFields: async (sheet: string) => [{ index: 0, name: sheet === 'Map' ? 'Id' : 'Icon', link: sheet === 'Map' ? '' : 'Image' }],
    }
    vi.mocked(formatTex).mockClear()
    await extractLocalUiAssets(game, definitions, { server })
    expect(JSON.parse(await readFile(join(output, 'references.json'), 'utf8'))).toEqual(references)
    const catalog=new AssetCatalog(join(output,'catalog.sqlite'),output,undefined,true)
    const paths=catalog.paths()
    const chunks=catalog.chunks()
    catalog.close()
    expect(paths).toHaveLength(7)
    expect(chunks).toHaveLength(1)
    await expect(readFile(join(manifests,'icons.json'))).rejects.toMatchObject({code:'ENOENT'})
    await expect(readFile(join(manifests,'maps.json'))).rejects.toMatchObject({code:'ENOENT'})
    await expect(readFile(join(manifests,'asset-files.json'))).rejects.toMatchObject({code:'ENOENT'})
    const binary = new BinaryAssetIndex(await readFile(join(manifests, 'assets.bin')))
    expect(binary.count).toBe(7)
    for (const path of [icon,map,...extraIcons]) expect(binary.lookup(path)).toBeDefined()
    const originalBinary=await readFile(join(manifests,'assets.bin'))
    const collisionPaths=['ui/icon/000000/15f019c1.tex','ui/icon/000000/2be409ef.tex']
    const storage=new AssetStorage({server})
    try {
      const collisionState=new Map<string,UiAssetEntry>(collisionPaths.map(path=>[path,{path,id:0,version:'',hr:false,sha256:paths[0].sha256,format:'webp'}]))
      await expect(storage.writeAssetState(version,collisionState)).rejects.toThrow('collision')
    }finally{storage.close()}
    expect(await readFile(join(manifests,'assets.bin'))).toEqual(originalBinary)
    const chunkBytes=await readFile(join(output,'chunks',chunks[0].id+'.bin'))
    const iconRef=binary.lookup(icon)!
    expect(chunkBytes.subarray(iconRef.offset,iconRef.offset+iconRef.size).toString()).toBe('same texture')
    expect(JSON.parse(await readFile(join(output,'current.json'),'utf8'))).toMatchObject({ffxiv:version,lastValidIndex:version,publication:expect.any(String)})
    await extractLocalUiAssets(game,definitions,{server})
    expect(formatTex).toHaveBeenCalledTimes(2)
    const remote=manager.getStorage('minio')!
    const listing=vi.spyOn(remote,'listFiles').mockRejectedValue(new Error('Remote listing is forbidden'))
    const creates=vi.spyOn(remote,'createFile'),uploads=vi.spyOn(remote,'writeFile')
    await syncUiAssetsToRemoteStorage({server,storage:'minio'})
    expect(await remote.readFile(server,'ui','chunks/'+chunks[0].id+'.bin')).toEqual(chunkBytes)
    expect(await remote.readFile(server,'ui','current.json')).toEqual(await readFile(join(output,'current.json')))
    expect(uploads.mock.calls.map(c=>c[2])).toEqual(['references.json',`patches/${version}/assets.bin`,'current.json'])
    expect(creates.mock.calls.filter(c=>c[2].startsWith('chunks/'))).toHaveLength(1)
    expect(listing).not.toHaveBeenCalled()
    creates.mockClear();uploads.mockClear()
    await syncUiAssetsToRemoteStorage({server,storage:'minio'})
    expect(creates.mock.calls.filter(c=>c[2].startsWith('chunks/'))).toHaveLength(0)
    expect(uploads).not.toHaveBeenCalled()
    const extraReferences=join(root,'extra-references.json')
    await writeFile(extraReferences,JSON.stringify({icons:[123],maps:[]}))
    await extractLocalUiAssets(game,definitions,{server,references:extraReferences})
    expect(JSON.parse(await readFile(join(output,'references.json'),'utf8'))).toEqual({icons:[123,51474],maps:['s1d1/00']})
    const localCheckpoint=await readFile(join(output,'current.json'))
    const failure=vi.spyOn(AssetStorage.prototype,'writeAssetState').mockRejectedValue(new Error('failed metadata'))
    try{
      await expect(extractLocalUiAssets(game,definitions,{server})).rejects.toThrow('failed metadata')
      expect(await readFile(join(output,'current.json'))).toEqual(localCheckpoint)
    }finally{failure.mockRestore()}
    // The fallback remains exhaustive when only index2 is installed.
    await unlink(join(pack, '060000.win32.index'))
    const fallback = generateLocalAssetPaths(game, { icons: [], maps: [] })
    expect((await fallback.next()).value).toBe('ui/icon/000000/000000.tex')
    expect((await fallback.next()).value).toBe('ui/icon/000000/000000_hr1.tex')
    await fallback.return(undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('rejects a missing or invalid game version before creating storage output', async () => {
  const game = await mkdtemp(join(tmpdir(), 'ixion-invalid-version-'))
  const definitions = { getFlatFields: async () => [] }
  vi.mocked(getStorageManager).mockClear()
  try {
    await expect(extractLocalUiAssets(game, definitions)).rejects.toThrow('ffxivgame.ver')
    await writeFile(join(game, 'ffxivgame.ver'), '../outside')
    await expect(extractLocalUiAssets(game, definitions)).rejects.toThrow('ffxivgame.ver')
    expect(getStorageManager).not.toHaveBeenCalled()
  } finally {
    await rm(game, { recursive: true, force: true })
  }
})
