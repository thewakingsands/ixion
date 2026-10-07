import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  writeSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  type AssetIndexSource,
  assetSizeLimit,
  encodeAssetIndex,
} from './binary-index'
import type { AssetFormat, UiAssetEntry } from './types'

export const chunkTargetSize = 32 * 1024 * 1024
export const catalogFileName = 'catalog.sqlite'
export const digest = (data: Uint8Array) =>
  createHash('sha256').update(data).digest('hex')
export interface Chunk {
  id: string
  size: number
  digest: string
}
export interface StoredObject {
  sha256: string
  chunk: string
  offset: number
  size: number
  format: AssetFormat
}
export function atomicWrite(path: string, bytes: Uint8Array | string) {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${randomUUID()}.tmp`
  const fd = openSync(temp, 'wx')
  try {
    const b = Buffer.from(bytes)
    let pos = 0
    while (pos < b.length) pos += writeSync(fd, b, pos, b.length - pos)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(temp, path)
}
/** Local build state. Only sealed, fsynced chunks enter the committed catalog. */
export class AssetCatalog {
  readonly db: DatabaseSync
  private active?: {
    id: string
    fd: number
    size: number
    hash: ReturnType<typeof createHash>
    objects: StoredObject[]
  }
  private pending = new Map<string, StoredObject>()
  constructor(
    readonly path: string,
    readonly root: string,
    readonly target = chunkTargetSize,
    readonly readOnly = false,
  ) {
    if (!readOnly) mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path, { readOnly })
    try {
      if (
        !readOnly &&
        this.db.prepare('PRAGMA user_version').get()?.user_version === 0
      ) {
        this.db.exec(`
        PRAGMA foreign_keys=ON;
        CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL) WITHOUT ROWID;
        CREATE TABLE chunks(id TEXT PRIMARY KEY,size INTEGER NOT NULL,digest BLOB NOT NULL) WITHOUT ROWID;
        CREATE TABLE objects(sha256 BLOB PRIMARY KEY,chunk TEXT NOT NULL REFERENCES chunks(id),
          offset INTEGER NOT NULL,size INTEGER NOT NULL,format TEXT NOT NULL) WITHOUT ROWID;
        CREATE TABLE paths(path TEXT PRIMARY KEY,sha256 BLOB NOT NULL REFERENCES objects(sha256)) WITHOUT ROWID;
        PRAGMA user_version=1;
      `)
      }
      if (this.db.prepare('PRAGMA user_version').get()?.user_version !== 1)
        throw new Error('Unsupported asset catalog')
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=0')
    } catch (error) {
      this.db.close()
      throw error
    }
  }
  close() {
    if (this.active) {
      closeSync(this.active.fd)
      this.active = undefined
    }
    this.db.close()
  }
  get(key: string): string | undefined {
    return this.db.prepare('SELECT value FROM meta WHERE key=?').get(key)
      ?.value as string | undefined
  }
  set(key: string, value: string) {
    this.db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run(key, value)
  }
  object(sha256: string): StoredObject | undefined {
    const pending = this.pending.get(sha256)
    if (pending) return pending
    const row = this.db
      .prepare('SELECT chunk,offset,size,format FROM objects WHERE sha256=?')
      .get(Buffer.from(sha256, 'hex'))
    return row ? ({ sha256, ...row } as unknown as StoredObject) : undefined
  }
  objects(): StoredObject[] {
    return this.db
      .prepare(
        'SELECT lower(hex(sha256)) sha256,chunk,offset,size,format FROM objects',
      )
      .all() as unknown as StoredObject[]
  }
  chunks(): Chunk[] {
    return this.db
      .prepare(
        'SELECT id,size,lower(hex(digest)) digest FROM chunks ORDER BY id',
      )
      .all() as unknown as Chunk[]
  }
  paths(): Array<{ path: string; sha256: string; format: AssetFormat }> {
    return this.db
      .prepare(
        'SELECT path,lower(hex(p.sha256)) sha256,format FROM paths p JOIN objects o ON p.sha256=o.sha256 ORDER BY path',
      )
      .all() as unknown as Array<{
      path: string
      sha256: string
      format: AssetFormat
    }>
  }
  add(sha256: string, format: AssetFormat, data: Buffer): boolean {
    if (this.object(sha256)) return false
    if (
      !/^[0-9a-f]{64}$/.test(sha256) ||
      !['webp', 'avif', 'tex'].includes(format) ||
      !data.length ||
      data.length > assetSizeLimit
    )
      throw new Error('Invalid encoded asset')
    if (this.active && this.active.size + data.length > this.target) this.seal()
    if (!this.active) {
      const id = randomUUID(),
        file = join(this.root, 'chunks', `${id}.bin`)
      mkdirSync(dirname(file), { recursive: true })
      this.active = {
        id,
        fd: openSync(file, 'wx'),
        size: 0,
        hash: createHash('sha256'),
        objects: [],
      }
    }
    const a = this.active
    const object = {
      sha256,
      format,
      chunk: a.id,
      offset: a.size,
      size: data.length,
    }
    let pos = 0
    while (pos < data.length)
      pos += writeSync(a.fd, data, pos, data.length - pos)
    a.hash.update(data)
    a.size += data.length
    a.objects.push(object)
    this.pending.set(sha256, object)
    if (a.size >= this.target) this.seal()
    return true
  }
  seal() {
    const a = this.active
    if (!a) return
    fsyncSync(a.fd)
    closeSync(a.fd)
    this.active = undefined
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db
        .prepare('INSERT INTO chunks VALUES (?,?,?)')
        .run(a.id, a.size, a.hash.digest())
      const insert = this.db.prepare('INSERT INTO objects VALUES (?,?,?,?,?)')
      for (const o of a.objects)
        insert.run(
          Buffer.from(o.sha256, 'hex'),
          o.chunk,
          o.offset,
          o.size,
          o.format,
        )
      this.db.exec('COMMIT')
      for (const o of a.objects) this.pending.delete(o.sha256)
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }
  index(entries: Iterable<Pick<UiAssetEntry, 'path' | 'sha256'>>): Buffer {
    this.seal()
    const sizes = new Map(this.chunks().map((c) => [c.id, c.size]))
    const rows: AssetIndexSource[] = []
    for (const entry of entries) {
      const object = this.object(entry.sha256)
      if (!object) throw new Error(`Missing encoded object for ${entry.path}`)
      const chunkSize = sizes.get(object.chunk)
      if (chunkSize === undefined) throw new Error('Missing catalog chunk')
      rows.push({
        ...object,
        path: entry.path,
        chunkSize,
      })
    }
    return encodeAssetIndex(rows)
  }
  savePaths(entries: Iterable<UiAssetEntry>, version: string) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.exec('DELETE FROM paths')
      const insert = this.db.prepare('INSERT INTO paths VALUES (?,?)')
      for (const e of entries) insert.run(e.path, Buffer.from(e.sha256, 'hex'))
      this.set('version', version)
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }
  snapshot(path: string) {
    this.seal()
    mkdirSync(dirname(path), { recursive: true })
    const temp = `${path}.${randomUUID()}.tmp`
    this.db.prepare('VACUUM INTO ?').run(temp)
    const fd = openSync(temp, 'r+')
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(temp, path)
  }
  validate() {
    const result = this.db.prepare('PRAGMA integrity_check').get()
    if (
      result?.integrity_check !== 'ok' ||
      this.db.prepare('PRAGMA foreign_key_check').all().length
    )
      throw new Error('Corrupt asset catalog')
    // Parsing and exporting all current mappings also validates ranges and UUIDs.
    for (const c of this.chunks()) {
      if (
        !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(c.id) ||
        !Number.isSafeInteger(c.size) ||
        c.size <= 0 ||
        c.size > assetSizeLimit ||
        !/^[0-9a-f]{64}$/.test(c.digest)
      )
        throw new Error('Invalid catalog chunk')
    }
    if (
      this.db
        .prepare(`SELECT 1 FROM objects o JOIN chunks c ON o.chunk=c.id
      WHERE length(o.sha256)!=32 OR o.size<=0 OR o.offset<0 OR o.offset+o.size>c.size
      OR o.format NOT IN ('webp','avif','tex') LIMIT 1`)
        .get()
    )
      throw new Error('Invalid catalog object')
    const sizes = new Map(this.chunks().map((c) => [c.id, c.size]))
    encodeAssetIndex(
      this.paths().map((p) => {
        const object = this.object(p.sha256)
        const chunkSize = object && sizes.get(object.chunk)
        if (!object || chunkSize === undefined)
          throw new Error('Missing catalog object or chunk')
        return { ...p, ...object, chunkSize }
      }),
    )
  }
}
