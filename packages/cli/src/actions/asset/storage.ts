import { randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AssetReferences } from '@ffcafe/ixion-exd'
import type {
  AbstractStorage,
  LocalStorage,
  PublicationPolicy,
} from '@ffcafe/ixion-storage'
import { baseGameVersion, uiSqPackFile } from '../../config'
import { PatchFileSystem } from '../../utils/patch-fs'
import { getStorageManager } from '../../utils/storage'
import { BinaryAssetIndex } from './binary-index'
import { AssetCatalog, atomicWrite, catalogFileName, digest } from './catalog'
import { createAssetStateEntry } from './patch'
import { PublicationLock, writePublicationObject } from './publication'
import { loadAssetReferences, saveAssetReferences } from './references'
import type {
  CurrentReference,
  EncodedAssetFormat,
  UiAssetEntry,
} from './types'

const { formatTex } = await import('@ffcafe/ixion-tex')

export interface AssetStorageOptions {
  server: string
  storage?: string
}
interface Publication {
  id: string
  base: string | null
  version: string
  current: string
  indexDigest: string
  catalogDigest: string
  destination: string
}
function versionPath(version: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(version))
    throw new Error('Invalid asset version')
  return `patches/${version}`
}
function currentFrom(data: Buffer | null): CurrentReference | null {
  if (!data) return null
  const c = JSON.parse(data.toString()) as CurrentReference
  versionPath(c.lastValidIndex || c.ffxiv || '')
  return c
}
export class AssetStorage {
  readonly server: string
  readonly outputRoot: string
  readonly patchRoot: string
  readonly assetRoot: string
  readonly diffRoot: string
  readonly currentRefPath: string
  readonly fs: PatchFileSystem
  private readonly localStorage: LocalStorage
  private readonly remoteStorage: AbstractStorage | null
  private readonly remoteStorageName?: string
  private catalog?: AssetCatalog
  private prepared?: Promise<AssetCatalog>
  private readonly localLock: string
  private lockFd: number
  constructor(options: AssetStorageOptions) {
    this.server = options.server
    const manager = getStorageManager()
    const local = manager.findLocalStorage()
    if (!local) throw new Error('Required at least one valid local storage')
    this.localStorage = local
    this.remoteStorageName = options.storage
    this.remoteStorage = options.storage
      ? (manager.getStorage(options.storage) ?? null)
      : null
    if (options.storage && !this.remoteStorage)
      throw new Error(`Storage not found: ${options.storage}`)
    this.outputRoot = local.getRootPath('ui', this.server)
    this.patchRoot = join(this.outputRoot, 'patches')
    this.assetRoot = join(this.outputRoot, 'chunks')
    this.diffRoot = join(this.outputRoot, '.diff')
    this.currentRefPath = join(this.outputRoot, 'current.json')
    mkdirSync(this.outputRoot, { recursive: true })
    this.localLock = join(this.outputRoot, '.asset-build.lock')
    try {
      this.lockFd = openSync(this.localLock, 'wx')
      writeFileSync(this.lockFd, JSON.stringify({ pid: process.pid }))
    } catch (e) {
      throw new Error(
        'Asset workspace is locked; stop the previous writer before removing ' +
          this.localLock,
        { cause: e },
      )
    }
    this.fs = new PatchFileSystem(this.diffRoot, [`${uiSqPackFile}.*`])
  }
  close() {
    this.catalog?.close()
    this.catalog = undefined
    if (this.lockFd !== -1) {
      closeSync(this.lockFd)
      this.lockFd = -1
      unlinkSync(this.localLock)
    }
  }
  hasRemoteStorage() {
    return this.remoteStorage !== null
  }
  getRemoteStorageName() {
    if (!this.remoteStorageName)
      throw new Error('Remote storage is not configured')
    return this.remoteStorageName
  }
  private async remoteRead(path: string) {
    return this.remoteStorage?.readFileStrict(this.server, 'ui', path) ?? null
  }
  private async prepare(): Promise<AssetCatalog> {
    if (this.prepared) return this.prepared
    this.prepared = (async () => {
      const path = join(this.outputRoot, catalogFileName)
      if (!existsSync(path) && this.remoteStorage) {
        const current = await this.remoteRead('current.json'),
          ref = currentFrom(current)
        if (ref) {
          if (!ref.publication)
            throw new Error(
              'Remote storage is not chunk-based; use a new destination',
            )
          const catalog = await this.remoteRead(catalogPath(ref.publication))
          if (!catalog) throw new Error('Published catalog is missing')
          atomicWrite(path, catalog)
        }
        const db = new AssetCatalog(path, this.outputRoot)
        this.catalog = db
        db.validate()
        db.set('base', current ? digest(current) : 'null')
      } else this.catalog = new AssetCatalog(path, this.outputRoot)
      if (!this.catalog) throw new Error('Catalog initialization failed')
      return this.catalog
    })()
    return this.prepared
  }
  async loadCurrentReference(): Promise<
    Required<Pick<CurrentReference, 'ffxiv' | 'lastValidIndex'>>
  > {
    const current = currentFrom(
      this.remoteStorage
        ? await this.remoteRead('current.json')
        : await this.localStorage.readFileStrict(
            this.server,
            'ui',
            'current.json',
          ),
    )
    const ffxiv = current?.ffxiv || baseGameVersion
    return { ffxiv, lastValidIndex: current?.lastValidIndex || ffxiv }
  }
  async loadLocalCurrentReference(): Promise<
    Required<Pick<CurrentReference, 'ffxiv' | 'lastValidIndex'>>
  > {
    const current = currentFrom(
      await this.localStorage.readFileStrict(this.server, 'ui', 'current.json'),
    )
    const ffxiv = current?.ffxiv || baseGameVersion
    return { ffxiv, lastValidIndex: current?.lastValidIndex || ffxiv }
  }
  async loadExistingAssets(
    _version: string,
  ): Promise<Map<string, EncodedAssetFormat>> {
    const db = await this.prepare()
    if (db.get('pending'))
      throw new Error(
        'An asset publication is pending; resume ui-sync before building',
      )
    return new Map(
      db.objects().map((o) => [o.sha256, o.format as EncodedAssetFormat]),
    )
  }
  async loadAssetState(version: string): Promise<Map<string, UiAssetEntry>> {
    const db = await this.prepare()
    if (db.get('version') && db.get('version') !== version)
      throw new Error(
        'Local catalog is not the requested baseline; restore the latest published catalog in a fresh workspace',
      )
    return new Map(
      db.paths().map((p) => {
        if (p.format === 'tex')
          throw new Error('Build catalogs require encoded images')
        return [p.path, createAssetStateEntry(p.path, p.sha256, p.format)]
      }),
    )
  }
  private referenceStorages() {
    return this.remoteStorage
      ? [this.localStorage, this.remoteStorage]
      : [this.localStorage]
  }
  async loadReferences() {
    return this.saveReferences(
      await loadAssetReferences(this.server, this.referenceStorages()),
    )
  }
  async saveReferences(references: AssetReferences) {
    return saveAssetReferences(
      this.server,
      this.referenceStorages(),
      references,
    )
  }
  async ensureEncodedAsset(
    sha256: string,
    nextData: Buffer,
  ): Promise<{ format: EncodedAssetFormat; persisted: boolean }> {
    const db = await this.prepare()
    const existing = db.object(sha256)
    if (existing)
      return { format: existing.format as EncodedAssetFormat, persisted: false }
    const encoded = await formatTex(nextData, { format: 'auto' })
    const format = encoded.format as EncodedAssetFormat
    // Encoding is parallel; synchronous allocation cannot interleave append offsets.
    return { format, persisted: db.add(sha256, format, encoded.data) }
  }
  async importEncodedAsset(
    sha256: string,
    format: EncodedAssetFormat,
    data: Buffer,
  ) {
    const db = await this.prepare()
    db.add(sha256, format, data)
  }
  async writeAssetState(version: string, state: Map<string, UiAssetEntry>) {
    const db = await this.prepare()
    if (db.get('pending'))
      throw new Error('Resume pending publication before building')
    const entries = [...state.values()]
    const index = db.index(entries) // Reject collisions before touching visible metadata.
    db.savePaths(entries, version)
    db.set('publication', randomUUID())
    const prefix = versionPath(version)
    db.snapshot(join(this.outputRoot, prefix, catalogFileName))
    atomicWrite(join(this.outputRoot, prefix, 'assets.bin'), index)
  }
  async writePatchJson(version: string, fileName: string, value: unknown) {
    if (!/^[a-zA-Z0-9._-]+\.json$/.test(fileName))
      throw new Error('Invalid diagnostic filename')
    atomicWrite(
      join(this.outputRoot, versionPath(version), fileName),
      `${JSON.stringify(value, null, 2)}\n`,
    )
  }
  async writeCurrentReference(current: CurrentReference) {
    const db = await this.prepare()
    const publication = db.get('publication')
    if (!publication) throw new Error('No completed asset snapshot')
    atomicWrite(
      this.currentRefPath,
      `${JSON.stringify({ ...current, publication })}\n`,
    )
  }
  async syncToRemote(
    _version?: string,
    _options?: { syncAssets: boolean; resume?: boolean },
  ) {
    const remote = this.remoteStorage
    if (!remote) throw new Error('Remote storage is required')
    const policy = remote.getPublicationPolicy()
    await this.publishToRemote(remote, policy, _options?.resume ?? false)
  }
  private async publishToRemote(
    remote: AbstractStorage,
    policy: PublicationPolicy,
    resume: boolean,
  ) {
    const db = await this.prepare()
    const current = readFileSync(this.currentRefPath)
    const ref = currentFrom(current)
    const version = ref?.lastValidIndex || ref?.ffxiv
    if (!ref || !version) throw new Error('Missing local current reference')
    if (!ref.publication || ref.publication !== db.get('publication'))
      throw new Error('Local snapshot is incomplete')
    const prefix = versionPath(version)
    const binary = readFileSync(join(this.outputRoot, prefix, 'assets.bin'))
    const index = new BinaryAssetIndex(binary)
    const catalog = readFileSync(join(this.outputRoot, prefix, catalogFileName))
    const snapshotDb = new AssetCatalog(
      join(this.outputRoot, prefix, catalogFileName),
      this.outputRoot,
      undefined,
      true,
    )
    let chunks: Map<string, { id: string; size: number; digest: string }>
    try {
      snapshotDb.validate()
      if (
        snapshotDb.get('publication') !== ref.publication ||
        snapshotDb.get('version') !== version ||
        !snapshotDb.index(snapshotDb.paths()).equals(binary)
      )
        throw new Error('Local catalog/index mismatch')
      chunks = new Map(snapshotDb.chunks().map((c) => [c.id, c]))
    } finally {
      snapshotDb.close()
    }
    let plan: Publication
    const pending = db.get('pending')
    if (pending) {
      if (!resume)
        throw new Error(
          'Publication locked by a pending plan; use ui-sync --resume',
        )
      plan = JSON.parse(pending)
      if (
        plan.id !== ref.publication ||
        plan.current !== current.toString() ||
        plan.indexDigest !== digest(binary) ||
        plan.catalogDigest !== digest(catalog) ||
        plan.destination !== remote.getPublicationKey(this.server)
      )
        throw new Error(
          'Pending publication does not match local files or destination',
        )
    } else {
      plan = {
        id: ref.publication,
        version,
        current: current.toString(),
        base: db.get('base') ?? 'null',
        indexDigest: digest(binary),
        catalogDigest: digest(catalog),
        destination: remote.getPublicationKey(this.server),
      }
      db.set('pending', JSON.stringify(plan))
    }
    const beforeLock = await this.remoteRead('current.json')
    if (
      (beforeLock ? digest(beforeLock) : 'null') !== plan.base &&
      !beforeLock?.equals(current)
    ) {
      if (!pending) db.db.prepare("DELETE FROM meta WHERE key='pending'").run()
      throw new Error(
        'Remote asset baseline changed; rebuild against the latest catalog',
      )
    }
    const lock = await PublicationLock.acquire(
      remote,
      this.server,
      policy,
      plan.id,
      resume,
    )
    const assertBaseline = async () => {
      await lock.assertOwned()
      const latest = await this.remoteRead('current.json')
      if ((latest ? digest(latest) : 'null') !== plan.base)
        throw new Error(
          'Remote asset baseline changed during publication; stopped',
        )
      await lock.assertOwned()
    }
    const remoteCurrent = await this.remoteRead('current.json')
    if (remoteCurrent?.equals(current)) {
      await lock.release()
      db.set('base', digest(current))
      db.db.prepare("DELETE FROM meta WHERE key='pending'").run()
      return
    }
    if ((remoteCurrent ? digest(remoteCurrent) : 'null') !== plan.base) {
      await lock.release()
      db.db.prepare("DELETE FROM meta WHERE key='pending'").run()
      throw new Error(
        'Remote asset baseline changed; rebuild against the latest catalog',
      )
    }
    const publishedChunks = new Map<string, { size: number; digest: string }>()
    const remoteRef = currentFrom(remoteCurrent)
    if (remoteRef) {
      if (!remoteRef.publication) throw new Error('Remote is not a chunk store')
      const bytes = await this.remoteRead(catalogPath(remoteRef.publication))
      if (!bytes) throw new Error('Published catalog is missing')
      const temp = join(this.outputRoot, `.remote-${randomUUID()}.sqlite`)
      atomicWrite(temp, bytes)
      const remoteDb = new AssetCatalog(temp, this.outputRoot, undefined, true)
      try {
        remoteDb.validate()
        for (const c of remoteDb.chunks()) publishedChunks.set(c.id, c)
      } finally {
        remoteDb.close()
        unlinkSync(temp)
      }
    }
    let uploaded = 0
    // Upload every catalog chunk, including objects reused by a subsequent build.
    for (const c of chunks.values()) {
      const known = publishedChunks.get(c.id)
      if (known) {
        if (known.size !== c.size || known.digest !== c.digest)
          throw new Error('Immutable chunk metadata changed')
        continue
      }
      const path = `chunks/${c.id}.bin`,
        bytes = await readFile(join(this.outputRoot, path))
      if (bytes.length !== c.size || digest(bytes) !== c.digest)
        throw new Error(`Corrupt local chunk ${c.id}`)
      if (
        await writePublicationObject(
          remote,
          this.server,
          policy,
          lock,
          path,
          bytes,
        )
      )
        uploaded++
    }
    for (const c of index.chunks)
      if (chunks.get(c.id)?.size !== c.size)
        throw new Error('Index/catalog mismatch')
    await assertBaseline()
    if (existsSync(join(this.outputRoot, 'references.json'))) {
      await this.loadReferences()
      await lock.assertOwned()
    }
    for (const name of ['changes.json', 'resolved-index.json']) {
      const path = `${prefix}/${name}`
      if (existsSync(join(this.outputRoot, path)))
        await lock.write(
          path,
          readFileSync(join(this.outputRoot, path)),
          'application/json',
        )
    }
    const snapshot = catalogPath(plan.id)
    await writePublicationObject(
      remote,
      this.server,
      policy,
      lock,
      snapshot,
      catalog,
      'application/vnd.sqlite3',
    )
    await assertBaseline()
    await lock.write(`${prefix}/assets.bin`, binary, 'application/octet-stream')
    await assertBaseline()
    await lock.write('current.json', current, 'application/json')
    if (!(await this.remoteRead('current.json'))?.equals(current))
      throw new Error(
        'Published current pointer changed; stopped without unlocking',
      )
    await lock.release()
    db.set('base', digest(current))
    db.db.prepare("DELETE FROM meta WHERE key='pending'").run()
    console.log(
      `Published ${version}: ${index.count} paths, ${index.chunks.length} referenced chunks, ${uploaded} new chunks`,
    )
  }
}
function catalogPath(id: string) {
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id))
    throw new Error('Invalid publication UUID')
  return `catalogs/${id}.sqlite`
}
