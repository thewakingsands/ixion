import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { S3Storage, StorageManager } from '@ffcafe/ixion-storage'
import { expect, it, vi } from 'vitest'
import { BinaryAssetIndex } from '../../src/actions/asset/binary-index'
import { digest } from '../../src/actions/asset/catalog'
import { createAssetStateEntry } from '../../src/actions/asset/patch'
import { PublicationLock, readPublicationLock, unlockPublication } from '../../src/actions/asset/publication'
import { AssetStorage } from '../../src/actions/asset/storage'
import { getStorageManager } from '../../src/utils/storage'

vi.mock('../../src/utils/storage', () => ({ getStorageManager: vi.fn() }))
vi.mock('@ffcafe/ixion-tex', () => ({ formatTex: vi.fn(async (data: Buffer) => ({ format: 'webp', data })) }))
const imagePath = 'ui/icon/000000/000001.tex'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ixion-garage-'))
  const manager = new StorageManager([
    { name: 'local', type: 'local', config: { rootPath: join(root, 'local') } },
    { name: 'garage-33', type: 'local', config: {
      rootPath: join(root, 'remote'), publicationMode: 'cooperative',
    } },
  ])
  vi.mocked(getStorageManager).mockReturnValue(manager)
  const remote = manager.getStorage('garage-33')!
  const atomic = vi.spyOn(remote, 'createFile').mockRejectedValue(new Error('Garage cannot do atomic creates'))
  const listing = vi.spyOn(remote, 'listFiles').mockRejectedValue(new Error('must not list'))
  const reads = vi.spyOn(remote, 'readFileStrict')
  const writes = vi.spyOn(remote, 'writeFile')
  const build = async (data: string, version: string, deleted = false) => {
    const s = new AssetStorage({ server: 'test', storage: 'garage-33' })
    try {
      await s.loadExistingAssets(version)
      const hash = digest(Buffer.from(data))
      if (!deleted) await s.ensureEncodedAsset(hash, Buffer.from(data))
      await s.writeAssetState(version, new Map(deleted ? [] : [[imagePath, createAssetStateEntry(imagePath, hash, 'webp')]]))
      await s.writeCurrentReference({ ffxiv: version, lastValidIndex: version })
    } finally { s.close() }
  }
  const sync = async (resume = false) => {
    const s = new AssetStorage({ server: 'test', storage: 'garage-33' })
    try { await s.syncToRemote(undefined, { syncAssets: true, resume }) } finally { s.close() }
  }
  return { root, manager, remote, atomic, listing, reads, writes, build, sync }
}

it('Garage publication skips confirmed bytes, seals new chunks, and resumes only unconfirmed objects', async () => {
  const f = await fixture()
  try {
    await f.build('first image', '1')
    await f.sync()
    const first = new BinaryAssetIndex((await f.remote.readFileStrict('test', 'ui', 'patches/1/assets.bin'))!)
    const oldKey = `chunks/${first.chunks[0].id}.bin`
    // Prove neither local chunk reads nor remote chunk reads are needed for reuse.
    await unlink(join(f.root, 'local', 'ui', 'test', oldKey))
    await f.build('first image', '2')
    f.reads.mockClear(); f.writes.mockClear()
    await f.sync()
    expect(f.reads.mock.calls.some(c => c[2].startsWith('chunks/'))).toBe(false)
    expect(f.writes.mock.calls.some(c => c[2].startsWith('chunks/'))).toBe(false)
    await f.sync()

    await f.build('new image', '3')
    const current = await f.remote.readFileStrict('test', 'ui', 'current.json')
    f.writes.mockImplementation(async (...args) => {
      if (args[2] === 'current.json') throw new Error('pointer failed')
      // Invoke the original prototype method rather than this spy.
      return Object.getPrototypeOf(f.remote).writeFile.apply(f.remote, args)
    })
    await expect(f.sync()).rejects.toThrow('pointer failed')
    expect(await f.remote.readFileStrict('test', 'ui', 'current.json')).toEqual(current)
    const newKeys = f.writes.mock.calls.filter(c => c[2].startsWith('chunks/')).map(c => c[2])
    expect(newKeys).toHaveLength(1)
    expect(newKeys[0]).not.toBe(oldKey)
    f.writes.mockRestore()
    const retryWrites = vi.spyOn(f.remote, 'writeFile')
    f.reads.mockClear()
    await expect(f.sync()).rejects.toThrow('--resume')
    await f.sync(true)
    expect(f.reads.mock.calls.some(c => c[2] === newKeys[0])).toBe(true)
    expect(f.reads.mock.calls.some(c => c[2] === oldKey)).toBe(false)
    expect(retryWrites.mock.calls.some(c => c[2].startsWith('chunks/'))).toBe(false)
    expect((await f.remote.readFileStrict('test', 'ui', oldKey))?.toString()).toBe('first image')
    expect(await f.remote.readFileStrict('test', 'ui', 'publish.lock')).toBeNull()

    await f.build('', '4', true)
    f.reads.mockClear(); retryWrites.mockClear()
    await f.sync()
    expect(f.reads.mock.calls.some(c => c[2].startsWith('chunks/'))).toBe(false)
    expect(retryWrites.mock.calls.some(c => c[2].startsWith('chunks/'))).toBe(false)
    expect(f.atomic).not.toHaveBeenCalled()
    expect(f.listing).not.toHaveBeenCalled()
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

it('rejects changed unconfirmed chunk bytes and never overwrites the object on resume', async () => {
  const f = await fixture()
  try {
    await f.build('image', '1')
    f.writes.mockImplementation(async (...args) => {
      if (args[2] === 'current.json') throw new Error('pointer failed')
      return Object.getPrototypeOf(f.remote).writeFile.apply(f.remote, args)
    })
    await expect(f.sync()).rejects.toThrow('pointer failed')
    const key = f.writes.mock.calls.find(c => c[2].startsWith('chunks/'))![2]
    f.writes.mockRestore()
    await f.remote.writeFile('test', 'ui', key, Buffer.from('corrupted'))
    const writes = vi.spyOn(f.remote, 'writeFile')
    await expect(f.sync(true)).rejects.toThrow('collision')
    expect(writes.mock.calls.some(c => c[2] === key)).toBe(false)
    expect((await f.remote.readFileStrict('test', 'ui', key))?.toString()).toBe('corrupted')
    expect(await f.remote.readFileStrict('test', 'ui', 'current.json')).toBeNull()
    expect(await readPublicationLock(f.remote, 'test')).not.toBeNull()
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

it('shares a remote lock across workspaces with no host binding and does not expire old locks', async () => {
  const f = await fixture()
  try {
    await f.build('image', '1')
    const policy = f.remote.getPublicationPolicy()
    const held = await PublicationLock.acquire(f.remote, 'test', policy, randomUUID(), false)
    const originalLock = await f.remote.readFileStrict('test', 'ui', 'publish.lock')
    f.writes.mockClear()
    try {
      await expect(f.sync()).rejects.toThrow('Publication locked')
      const second = new StorageManager([
        { name: 'local', type: 'local', config: { rootPath: join(f.root, 'second-workspace') } },
        { name: 'alias', type: 'local', config: {
          rootPath: join(f.root, 'remote'), publicationMode: 'cooperative',
        } },
      ])
      await expect(PublicationLock.acquire(second.getStorage('alias')!, 'test', policy, randomUUID(), true)).rejects.toThrow('Publication locked')
      expect(f.writes).not.toHaveBeenCalled()
      expect(await f.remote.readFileStrict('test', 'ui', 'publish.lock')).toEqual(originalLock)
    } finally { await held.release() }
    const stale = {owner:randomUUID(), publication:randomUUID(), acquiredAt:'2000-01-01T00:00:00Z'}
    await f.remote.writeFile('test', 'ui', 'publish.lock', JSON.stringify(stale))
    await expect(PublicationLock.acquire(f.remote, 'test', policy, randomUUID(), true)).rejects.toThrow('Publication locked')
    expect(await readPublicationLock(f.remote, 'test')).toEqual(stale)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

it('shares S3 physical identities across aliases and refuses an atomic-create facade', async () => {
  const config = { endPoint: 'localhost', useSSL: false, bucketName: 'test', accessKey: 'test', secretKey: 'test-secret' }
  const a = new S3Storage({ name: 'garage-33', type: 's3', config })
  const b = new S3Storage({ name: 'alias', type: 'minio', config: { ...config, port: 80, accessKey: 'other' } })
  expect(a.getPublicationKey('sdo')).toBe(b.getPublicationKey('sdo'))
  expect(a.getPublicationKey('sdo')).not.toBe(a.getPublicationKey('other'))
  const invalid = new S3Storage({ name: 'invalid', type: 's3', config: { ...config, publicationMode: 'invalid' } })
  expect(() => invalid.getPublicationPolicy()).toThrow('Invalid')
  const single = new S3Storage({ name: 'single', type: 's3', config: {
    ...config, publicationMode: 'cooperative',
  } })
  await expect(single.createFile('sdo', 'ui', 'key', Buffer.from('x'))).rejects.toThrow('Atomic create is unavailable')
})

it('rotates ownership on explicit resume, rejects stale tokens and requires confirmed manual unlock', async () => {
  const f = await fixture()
  try {
    const publication = randomUUID(), policy = f.remote.getPublicationPolicy()
    const first = await PublicationLock.acquire(f.remote, 'test', policy, publication, false)
    const old = (await readPublicationLock(f.remote, 'test'))!
    await expect(PublicationLock.acquire(f.remote, 'test', policy, publication, false)).rejects.toThrow('locked')
    const resumed = await PublicationLock.acquire(f.remote, 'test', policy, publication, true)
    const next = (await readPublicationLock(f.remote, 'test'))!
    expect(next.owner).not.toBe(old.owner)
    await expect(first.assertOwned()).rejects.toThrow('ownership lost')
    await expect(first.release()).rejects.toThrow('ownership lost')
    await expect(unlockPublication(f.remote, 'test', next.owner, false)).rejects.toThrow('--confirm-stopped')
    await expect(unlockPublication(f.remote, 'test', old.owner, true)).rejects.toThrow('does not match')
    await resumed.assertOwned()
    await unlockPublication(f.remote, 'test', next.owner, true)
    expect(await readPublicationLock(f.remote, 'test')).toBeNull()
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

it('detects a lock overwritten during acquisition without deleting the winning record', async () => {
  const f = await fixture()
  try {
    const foreign = {owner:randomUUID(), publication:randomUUID(), acquiredAt:new Date().toISOString()}
    f.writes.mockImplementation(async (...args) => {
      return Object.getPrototypeOf(f.remote).writeFile.apply(f.remote,
        args[2] === 'publish.lock' ? [args[0], args[1], args[2], JSON.stringify(foreign)] : args)
    })
    await expect(PublicationLock.acquire(f.remote, 'test', f.remote.getPublicationPolicy(), randomUUID(), false)).rejects.toThrow('ownership lost')
    expect(await readPublicationLock(f.remote, 'test')).toEqual(foreign)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

it.each(['owner', 'baseline'])('stops publication when %s changes during a chunk upload', async (change) => {
  const f = await fixture()
  try {
    await f.build('image', '1')
    const foreign = {owner:randomUUID(), publication:randomUUID(), acquiredAt:new Date().toISOString()}
    const foreignCurrent = JSON.stringify({ffxiv:'99', lastValidIndex:'99', publication:randomUUID()})
    f.writes.mockImplementation(async (...args) => {
      const original = Object.getPrototypeOf(f.remote).writeFile.bind(f.remote)
      await original(...args)
      if (args[2].startsWith('chunks/'))
        await original('test', 'ui', change === 'owner' ? 'publish.lock' : 'current.json',
          change === 'owner' ? JSON.stringify(foreign) : foreignCurrent)
    })
    await expect(f.sync()).rejects.toThrow(change === 'owner' ? 'ownership lost' : 'baseline changed')
    expect(f.writes.mock.calls.some(c => c[2] === 'patches/1/assets.bin' || c[2] === 'current.json')).toBe(false)
    if (change === 'owner') expect(await readPublicationLock(f.remote, 'test')).toEqual(foreign)
    else expect((await f.remote.readFileStrict('test', 'ui', 'current.json'))?.toString()).toBe(foreignCurrent)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})
