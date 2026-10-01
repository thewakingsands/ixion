import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  type AssetReferences,
  generateAssetPaths,
  generateIconPaths,
  generateMapAssetPaths,
} from '@ffcafe/ixion-exd'
import { calculateIndexHash, readIndexEntries } from '@ffcafe/ixion-sqpack'
import { uiSqPackFile } from '../../config'
import type { PatchFileSystem } from '../../utils/patch-fs'
import {
  buildIconDirectoryHashes,
  type ResolvedIndexMap,
  resolveIndexMap,
} from '../../utils/sqpack-index'

const sqpackHeaderSize = 0x400
const indexHeaderSize = 0x400

export async function validateIndexFile(
  fs: PatchFileSystem,
  references: AssetReferences,
): Promise<ResolvedIndexMap | null> {
  const buffer = await fs.readFile(`${uiSqPackFile}.index`)

  if (!buffer || buffer.length < sqpackHeaderSize + indexHeaderSize) {
    return null
  }

  try {
    const parsed = readIndexEntries(buffer, false)
    return resolveAssetIndex(parsed, references)
  } catch {
    return null
  }
}

function resolveAssetIndex(
  parsed: ReturnType<typeof readIndexEntries>,
  references: AssetReferences,
): ResolvedIndexMap {
  // Probe all IDs only in directories that actually exist in this index.
  // This preserves exhaustive coverage without reading millions of absent files.
  const resolved = resolveIndexMap({
    ...parsed,
    dirHashMap: buildIconDirectoryHashes(),
    fileNameGenerator: (directory) =>
      [...generateIconPaths(directory)].map((path) =>
        path.slice(directory.length + 1),
      ),
  })
  for (const path of generateMapAssetPaths(references)) {
    const hash = calculateIndexHash(path)
    const directory = resolved.get(Number(hash >> 32n))
    const file = directory?.files.get(hash)
    if (!directory || !file) continue
    if (file.path && file.path !== path)
      throw new Error(`Asset path hash collision: ${file.path} and ${path}`)
    directory.path = path.slice(0, path.lastIndexOf('/'))
    file.path = path
  }
  return resolved
}

/** Resolve every installed UI chunk before reading/encoding actual textures. */
export async function* generateLocalAssetPaths(
  gamePath: string,
  references: AssetReferences,
): AsyncGenerator<string> {
  const directory = join(gamePath, 'sqpack/ffxiv')
  const files = await readdir(directory)
  const indexes = files
    .filter((file) => /^0600[0-9a-f]{2}\.win32\.index$/.test(file))
    .sort()
  const index2Only = files.some(
    (file) =>
      /^0600[0-9a-f]{2}\.win32\.index2$/.test(file) &&
      !files.includes(file.slice(0, -1)),
  )
  if (index2Only) {
    // Index2 has no directory table: use the same exhaustive candidates as a fallback.
    yield* generateAssetPaths(references)
    return
  }
  if (!indexes.length)
    throw new Error(`No UI SqPack indexes found in ${directory}`)
  const seen = new Set<string>()
  for (const index of indexes) {
    const resolved = resolveAssetIndex(
      readIndexEntries(await readFile(join(directory, index)), false),
      references,
    )
    for (const directory of resolved.values()) {
      for (const file of directory.files.values()) {
        if (!file.path || seen.has(file.path)) continue
        seen.add(file.path)
        yield file.path
      }
    }
  }
}
