import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { getStorageManager } from '../utils/storage'
import { BinaryAssetIndex } from './asset/binary-index'
import { AssetCatalog, atomicWrite, catalogFileName } from './asset/catalog'
import type { CurrentReference, IconEntry, UiAssetEntry } from './asset/types'

/** One-shot importer only. The server and regular extraction never read legacy JSON. */
export async function packLocalUiAssets(options: {
  server: string
  output: string
}) {
  const local = getStorageManager().findLocalStorage()
  if (!local) throw new Error('Local storage is required')
  return packUiDirectory(
    local.getRootPath('ui', options.server),
    options.output,
  )
}
export function packUiDirectory(input: string, output: string) {
  const source = resolve(input),
    target = resolve(output)
  if (
    source === target ||
    target.startsWith(`${source}\\`) ||
    target.startsWith(`${source}/`)
  )
    throw new Error('Migration output must be separate from legacy storage')
  if (existsSync(target) && readdirSync(target).length)
    throw new Error('Migration output must be empty')
  const current = JSON.parse(
    readFileSync(join(source, 'current.json'), 'utf8'),
  ) as CurrentReference
  const version = current.lastValidIndex || current.ffxiv
  if (!version || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(version))
    throw new Error('Invalid current version')
  const prefix = join('patches', version)
  const icons = JSON.parse(
    readFileSync(join(source, prefix, 'icons.json'), 'utf8'),
  ) as IconEntry[]
  const mapFile = join(source, prefix, 'maps.json')
  const maps = existsSync(mapFile)
    ? (JSON.parse(readFileSync(mapFile, 'utf8')) as UiAssetEntry[])
    : []
  const entries: UiAssetEntry[] = [
    ...icons.map((e) => ({ ...e, path: e.path ?? iconPath(e) })),
    ...maps,
  ]
  mkdirSync(target, { recursive: true })
  const db = new AssetCatalog(join(target, catalogFileName), target)
  try {
    let imported = 0
    for (const entry of entries) {
      if (
        !/^[0-9a-f]{64}$/.test(entry.sha256) ||
        !['webp', 'avif'].includes(entry.format)
      )
        throw new Error('Invalid legacy asset')
      if (db.object(entry.sha256)) continue
      const data = readFileSync(legacyFile(source, entry))
      db.add(entry.sha256, entry.format, data)
      if (++imported % 10000 === 0)
        console.log(`Packed ${imported} unique images`)
    }
    const binary = db.index(entries)
    db.savePaths(entries, version)
    const publication = randomUUID()
    db.set('publication', publication)
    db.set('base', 'null')
    db.snapshot(join(target, prefix, catalogFileName))
    atomicWrite(join(target, prefix, 'assets.bin'), binary)
    // Full byte verification before exposing current.json. Group reads by chunk.
    const index = new BinaryAssetIndex(binary)
    const byChunk = new Map<string, UiAssetEntry[]>()
    for (const e of entries) {
      const ref = index.lookup(e.path)
      if (!ref) throw new Error(`Missing migrated path: ${e.path}`)
      const list = byChunk.get(ref.chunk) ?? []
      list.push(e)
      byChunk.set(ref.chunk, list)
    }
    for (const [id, list] of byChunk) {
      const bytes = readFileSync(join(target, 'chunks', `${id}.bin`))
      for (const e of list) {
        const r = index.lookup(e.path)
        if (!r) throw new Error(`Missing migrated path: ${e.path}`)
        if (
          !bytes
            .subarray(r.offset, r.offset + r.size)
            .equals(readFileSync(legacyFile(source, e)))
        )
          throw new Error(`Migration verification failed: ${e.path}`)
      }
    }
    const refs = join(source, 'references.json')
    if (existsSync(refs))
      atomicWrite(join(target, 'references.json'), readFileSync(refs))
    atomicWrite(
      join(target, 'current.json'),
      JSON.stringify({ ffxiv: version, lastValidIndex: version, publication }) +
        '\n',
    )
    console.log(
      `Verified ${entries.length} paths, ${imported} images, ${index.chunks.length} chunks; index ${binary.length} bytes`,
    )
    return {
      paths: entries.length,
      images: imported,
      chunks: index.chunks.length,
      indexBytes: binary.length,
    }
  } finally {
    db.close()
  }
}
function iconPath(e: IconEntry) {
  return `ui/icon/${String(Math.floor(e.id / 1000) * 1000).padStart(6, '0')}${e.version}/${String(e.id).padStart(6, '0')}${e.hr ? '_hr1' : ''}.tex`
}
function legacyFile(root: string, e: UiAssetEntry) {
  return join(root, 'assets', e.sha256.slice(0, 2), `${e.sha256}.${e.format}`)
}
