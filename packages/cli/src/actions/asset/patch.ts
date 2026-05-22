import { SqPackReader } from '@ffcafe/ixion-sqpack'
import { pMapIterable } from 'p-map'
import { uiSqPackFile } from '../../config'
import { calculateHash } from '../../utils/hash'
import type {
  ResolvedFileIndex,
  ResolvedIndexMap,
} from '../../utils/sqpack-index'
import type { AssetStorage } from './storage'
import type { EncodedAssetFormat, IconEntry } from './types'

const assetProcessConcurrency = 16

export interface TextureChanges {
  added: IconEntry[]
  removed: IconEntry[]
  edited: Array<{
    from: IconEntry
    to: IconEntry
  }>
  unreferenced: string[]
}

export async function processTextures(options: {
  storage: AssetStorage
  iconState: Map<string, IconEntry>
  uiIndex: ResolvedIndexMap
  previousUiIndex?: ResolvedIndexMap
}) {
  const { uiIndex, iconState, storage } = options

  const changes: TextureChanges = {
    added: [],
    removed: [],
    edited: [],
    unreferenced: [],
  }

  const afterStateReader = await SqPackReader.open({
    prefix: uiSqPackFile,
    open: storage.fs.open,
  })

  const unrefedHash = new Set<string>()
  try {
    let writeCount = 0
    const increaseWriteCount = (forcePrint = false) => {
      ++writeCount
      if (forcePrint || writeCount % 1000 === 0) {
        console.log(`Written ${writeCount} files`)
      }
    }

    const mapper = async ({ path, afterFile }: FileChange) => {
      const previous = iconState.get(path) ?? null
      if (!afterFile) {
        if (previous) {
          unrefedHash.add(previous.sha256)
          changes.removed.push(previous)
          iconState.delete(path)
        }

        return null
      }

      const nextData = await afterStateReader.readFile(path).catch(() => null)
      if (!nextData) {
        return null
      }

      const sha256 = calculateHash(nextData, 'sha256')
      if (previous && sha256 === previous.sha256 && previous.format !== 'tex') {
        return null
      }

      const encodedAsset = await storage.ensureEncodedAsset(sha256, nextData)

      return {
        previous,
        nextEntry: createIconStateEntry(path, sha256, encodedAsset.format),
        persisted: encodedAsset.persisted,
      }
    }

    const processedEntries = pMapIterable(
      iterateFiles(options.previousUiIndex ?? null, uiIndex),
      mapper,
      { concurrency: assetProcessConcurrency },
    )

    for await (const processed of processedEntries) {
      if (!processed) {
        continue
      }

      const { previous, nextEntry, persisted } = processed
      if (persisted) {
        increaseWriteCount()
      }

      if (previous) {
        unrefedHash.add(previous.sha256)
        changes.edited.push({
          from: previous,
          to: nextEntry,
        })
      } else {
        changes.added.push(nextEntry)
      }

      iconState.set(nextEntry.path, nextEntry)
    }
  } finally {
    await afterStateReader?.close()
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

function createIconStateEntry(
  path: string,
  sha256: string,
  format: EncodedAssetFormat,
): IconEntry {
  const match = path.match(
    /^ui\/icon\/(\d{3})000(\/(?:en|ja|fr|de|hq|chs))?\/(\d{6})(_hr1)?\.tex$/,
  )
  if (!match) {
    throw new Error(`Unexpected icon path: ${path}`)
  }

  return {
    id: Number.parseInt(match[3], 10),
    version: match[2] ?? '',
    hr: Boolean(match[4]),
    sha256,
    format,
    path,
  }
}
