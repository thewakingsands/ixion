import { setImmediate } from 'node:timers/promises'
import type { AssetResourceReader } from '@ffcafe/ixion-exd'
import { SqPackReader } from '@ffcafe/ixion-sqpack'
import { uiSqPackFile } from '../../config'
import { calculateHash } from '../../utils/hash'
import { mapUnordered } from '../../utils/map-unordered'
import type {
  ResolvedFileIndex,
  ResolvedIndexMap,
} from '../../utils/sqpack-index'
import type { AssetStorage } from './storage'
import type { EncodedAssetFormat, UiAssetEntry } from './types'

const assetProcessConcurrency = 16

export interface TextureChanges {
  added: UiAssetEntry[]
  removed: UiAssetEntry[]
  edited: Array<{
    from: UiAssetEntry
    to: UiAssetEntry
  }>
  unreferenced: string[]
}

export async function processTextures(options: {
  storage: Pick<AssetStorage, 'ensureEncodedAsset'> &
    Partial<Pick<AssetStorage, 'fs'>>
  iconState: Map<string, UiAssetEntry>
  reader?: AssetResourceReader
  uiIndex?: ResolvedIndexMap
  paths?: Iterable<string> | AsyncIterable<string>
  /** Used only when reprocessing the same saved patch to backfill references. */
  onlyMissing?: boolean
  previousUiIndex?: ResolvedIndexMap
}) {
  const { uiIndex, iconState, storage } = options
  if (!uiIndex && !options.paths)
    throw new Error('An asset index or path generator is required')

  const changes: TextureChanges = {
    added: [],
    removed: [],
    edited: [],
    unreferenced: [],
  }

  let ownedReader: SqPackReader | undefined
  if (!options.reader) {
    if (!storage.fs)
      throw new Error('An asset reader or patch filesystem is required')
    ownedReader = await SqPackReader.open({
      prefix: uiSqPackFile,
      open: storage.fs.open,
    })
  }
  const afterStateReader = options.reader ?? ownedReader
  if (!afterStateReader) throw new Error('Missing asset reader')
  type Reference = { path: string; previous: UiAssetEntry | null }
  type Encoding = { references: Reference[]; format?: EncodedAssetFormat }
  const encodings = new Map<string, Encoding>()
  const unrefedHash = new Set<string>()
  const progress = { scanned: 0, found: 0, reused: 0, encoded: 0, written: 0 }
  const active = new Map<string, number>()
  const started = Date.now()
  const printProgress = () => {
    const oldest = active.entries().next().value
    const slowest = oldest
      ? `; oldest ${oldest[0]} (${Math.floor((Date.now() - oldest[1]) / 1000)}s)`
      : ''
    console.log(
      `Assets: scanned ${progress.scanned}, found ${progress.found}, reused ${progress.reused}, encoded ${progress.encoded}, written ${progress.written}, active ${active.size}; elapsed ${Math.floor((Date.now() - started) / 1000)}s${slowest}`,
    )
  }
  const timer = setInterval(printProgress, 10_000)
  timer.unref()
  const applyReference = (
    { path, previous }: Reference,
    sha256: string,
    format: EncodedAssetFormat,
  ) => {
    const nextEntry = createAssetStateEntry(path, sha256, format)
    if (previous) {
      unrefedHash.add(previous.sha256)
      changes.edited.push({ from: previous, to: nextEntry })
    } else {
      changes.added.push(nextEntry)
    }
    iconState.set(path, nextEntry)
  }
  try {
    const readTexture = async ({ path, afterFile }: FileChange) => {
      ++progress.scanned
      // Missing paths can resolve without I/O; let progress timers run as well.
      if (progress.scanned % 1024 === 0) await setImmediate()
      const previous = iconState.get(path) ?? null
      const removePrevious = () => {
        if (previous) {
          unrefedHash.add(previous.sha256)
          changes.removed.push(previous)
          iconState.delete(path)
        }
      }
      if (!afterFile) {
        removePrevious()
        return null
      }

      if (options.onlyMissing && previous && previous.format !== 'tex')
        return null

      const nextData = await afterStateReader.readFile(path)
      if (!nextData) {
        // A placeholder can keep its index entry after its texture is removed.
        removePrevious()
        return null
      }
      ++progress.found

      const sha256 = calculateHash(nextData, 'sha256')
      if (previous && sha256 === previous.sha256 && previous.format !== 'tex') {
        ++progress.reused
        return null
      }
      return { path, previous, sha256, data: nextData }
    }
    const textures = mapUnordered(
      options.paths
        ? iteratePaths(options.paths)
        : iterateFiles(options.previousUiIndex ?? null, uiIndex ?? new Map()),
      readTexture,
      assetProcessConcurrency,
    )
    async function* uniqueTextures() {
      for await (const texture of textures) {
        if (!texture) continue
        const reference = { path: texture.path, previous: texture.previous }
        const existing = encodings.get(texture.sha256)
        if (existing) {
          ++progress.reused
          if (existing.format) {
            applyReference(reference, texture.sha256, existing.format)
          } else {
            existing.references.push(reference)
          }
          continue
        }
        const encoding: Encoding = { references: [reference] }
        encodings.set(texture.sha256, encoding)
        yield { ...texture, encoding }
      }
    }
    const encoded = mapUnordered(
      uniqueTextures(),
      async (texture) => {
        active.set(texture.path, Date.now())
        try {
          const result = await storage.ensureEncodedAsset(
            texture.sha256,
            texture.data,
          )
          ++progress.encoded
          if (result.persisted) ++progress.written
          texture.encoding.format = result.format
          for (const reference of texture.encoding.references)
            applyReference(reference, texture.sha256, result.format)
          texture.encoding.references = []
        } finally {
          active.delete(texture.path)
        }
      },
      assetProcessConcurrency,
    )
    for await (const _ of encoded) {
      // Results are applied immediately by each encoder, not in candidate order.
    }
    printProgress()
  } finally {
    clearInterval(timer)
    await ownedReader?.close()
  }

  const referencedHashes = new Set(
    [...iconState.values()].map((entry) => entry.sha256),
  )
  changes.unreferenced = [...unrefedHash]
    .filter((sha256) => !referencedHashes.has(sha256))
    .sort((left, right) => left.localeCompare(right))

  return changes
}

interface FileChange {
  path: string
  beforeFile: ResolvedFileIndex | null
  afterFile: ResolvedFileIndex | null
}

async function* iteratePaths(
  paths: Iterable<string> | AsyncIterable<string>,
): AsyncGenerator<FileChange> {
  for await (const path of paths) {
    yield {
      path,
      beforeFile: null,
      afterFile: { path, dataFileId: 0, offset: 0 },
    }
  }
}

function* iterateFiles(
  beforeIndex: ResolvedIndexMap | null,
  afterIndex: ResolvedIndexMap,
): Generator<FileChange> {
  const allDirHashes = new Set([
    ...(beforeIndex?.keys() ?? []),
    ...afterIndex.keys(),
  ])

  for (const dirHash of allDirHashes) {
    const beforeDirectory = beforeIndex?.get(dirHash) ?? null
    const afterDirectory = afterIndex.get(dirHash) ?? null
    const allFileHashes = new Set<bigint>([
      ...(beforeDirectory?.files.keys() ?? []),
      ...(afterDirectory?.files.keys() ?? []),
    ])

    for (const fileHash of allFileHashes) {
      const beforeFile = beforeDirectory?.files.get(fileHash) ?? null
      const afterFile = afterDirectory?.files.get(fileHash) ?? null
      const path = afterFile?.path ?? beforeFile?.path
      if (!path) continue

      yield { path, beforeFile, afterFile }
    }
  }
}

export function createAssetStateEntry(
  path: string,
  sha256: string,
  format: EncodedAssetFormat,
): UiAssetEntry {
  const map = path.match(/^ui\/map\/([a-z0-9]+)\/(\d{2})\/\1\2(_m|m_m|d)\.tex$/)
  if (map) {
    return {
      territory: map[1],
      index: map[2],
      variant: map[3] as '_m' | 'm_m' | 'd',
      sha256,
      format,
      path,
    }
  }
  const match = path.match(
    /^ui\/icon\/\d+000(\/(?:en|ja|fr|de|hq|chs|cht|kr))?\/(\d{6,})(_hr1)?\.tex$/,
  )
  if (!match) {
    throw new Error(`Unexpected UI asset path: ${path}`)
  }

  return {
    id: Number.parseInt(match[2], 10),
    version: match[1] ?? '',
    hr: Boolean(match[3]),
    sha256,
    format,
    path,
  }
}
