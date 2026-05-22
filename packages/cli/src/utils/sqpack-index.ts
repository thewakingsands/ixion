import {
  crc32,
  type IndexDirectoryHashTableEntry,
  type IndexHashData,
  mergeIndexHash,
} from '@ffcafe/ixion-sqpack'

export interface ResolvedFileIndex {
  path?: string

  dataFileId: number
  offset: number
}

export interface ResolvedDirectoryIndex {
  path?: string
  version?: string
  files: Map<bigint, ResolvedFileIndex>
}

const iconVariants = ['', '/en', '/ja', '/fr', '/de', '/hq', '/chs']
export function buildIconDirectoryHashes() {
  const map = new Map<number, string>()

  for (let prefix = 0; prefix < 1000; prefix += 1) {
    const group = `${prefix.toString().padStart(3, '0')}000`
    for (const version of iconVariants) {
      const dirPath = `ui/icon/${group}${version}`
      const dirHash = crc32(dirPath)

      const existed = map.get(dirHash)
      if (map.has(dirHash)) {
        console.warn(`Hash of ${dirPath} duplicates with ${existed}`)
      } else {
        map.set(dirHash, dirPath)
      }
    }
  }

  return map
}

export type ResolvedIndexMap = Map<number, ResolvedDirectoryIndex>
export function resolveIndexMap({
  indexEntries,
  dirHashMap,
  dirIndexEntries,
  fileNameGenerator,
}: {
  indexEntries: Map<number | bigint, IndexHashData>
  dirIndexEntries: Map<number, IndexDirectoryHashTableEntry>

  dirHashMap: Map<number, string>
  fileNameGenerator?: (dirPath: string) => string[]
}): ResolvedIndexMap {
  const resolved: ResolvedIndexMap = new Map()
  for (const dirHash of dirIndexEntries.keys()) {
    const path = dirHashMap.get(dirHash)
    resolved.set(dirHash, {
      path,
      version: path && extractDirectoryVersion(path),
      files: new Map(),
    })
  }

  for (const [hash, entry] of indexEntries) {
    const dirHash = Number((hash as bigint) >> 32n)
    const dirEntry = resolved.get(dirHash)
    if (!dirEntry) continue

    dirEntry.files.set(hash as bigint, {
      dataFileId: entry.dataFileId,
      offset: entry.offset,
    })
  }

  if (fileNameGenerator) {
    for (const [dirHash, entry] of resolved) {
      if (!entry.path) continue
      const fileNames = fileNameGenerator(entry.path)

      for (const fileName of fileNames) {
        const hash = mergeIndexHash(dirHash, crc32(fileName))
        const fileEntry = entry.files.get(hash)
        if (fileEntry) {
          fileEntry.path = `${entry.path}/${fileName}`
        }
      }
    }
  }

  return resolved
}

function extractDirectoryVersion(dirPath: string) {
  const match = dirPath.match(/^ui\/icon\/\d{6}(.*)$/)
  return match?.[1] || ''
}
