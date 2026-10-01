import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { SqPackReader } from './reader'

export const sqPackCategoryIds: Readonly<Record<string, number>> = {
  common: 0x00,
  bgcommon: 0x01,
  bg: 0x02,
  cut: 0x03,
  chara: 0x04,
  shader: 0x05,
  ui: 0x06,
  sound: 0x07,
  vfx: 0x08,
  ui_script: 0x09,
  exd: 0x0a,
  game_script: 0x0b,
  music: 0x0c,
  sqpack_test: 0x12,
  debug: 0x13,
}

export function parseResourcePath(resourcePath: string) {
  const path = resourcePath.replaceAll('\\', '/').trim().toLowerCase()
  const parts = path.split('/')
  if (
    parts.length < 2 ||
    parts.some((part) => !part || part === '.' || part === '..') ||
    path.includes('\0')
  ) {
    throw new Error(`Invalid resource path: ${resourcePath}`)
  }
  const categoryId = sqPackCategoryIds[parts[0]]
  if (categoryId === undefined)
    throw new Error(`Unknown SqPack category: ${parts[0]}`)
  const repository = /^ex\d+$/.test(parts[1]) ? parts[1] : 'ffxiv'
  const expansionId = repository === 'ffxiv' ? 0 : Number(repository.slice(2))
  if (expansionId > 255) throw new Error(`Invalid repository: ${repository}`)
  return { path, repository, categoryId, expansionId }
}

/** Local game reader. Searches every installed chunk and caches opened indexes. */
export class GameSqPackReader {
  private readers = new Map<string, Promise<SqPackReader>>()
  private repositories = new Map<string, Promise<string[]>>()
  private candidates = new Map<
    string,
    Array<{ prefix: string; useIndex2: boolean }>
  >()

  constructor(readonly gamePath: string) {}

  private async locate(resourcePath: string) {
    const parsed = parseResourcePath(resourcePath)
    const directory = join(this.gamePath, 'sqpack', parsed.repository)
    const stem = [parsed.categoryId, parsed.expansionId]
      .map((id) => id.toString(16).padStart(2, '0'))
      .join('')
    const key = join(directory, stem)
    let candidates = this.candidates.get(key)
    if (!candidates) {
      let listing = this.repositories.get(directory)
      if (!listing) {
        listing = readdir(directory).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return []
          throw error
        })
        this.repositories.set(directory, listing)
      }
      const files = await listing
      const pattern = new RegExp(`^${stem}[0-9a-f]{2}\\.win32\\.index2?$`)
      const seen = new Set<string>()
      candidates = []
      for (const file of files.filter((file) => pattern.test(file)).sort()) {
        const prefix = join(directory, file.replace(/\.win32\.index2?$/, ''))
        if (seen.has(prefix)) continue
        seen.add(prefix)
        candidates.push({ prefix, useIndex2: file.endsWith('.index2') })
      }
      this.candidates.set(key, candidates)
    }
    for (const { prefix, useIndex2 } of candidates) {
      let pending = this.readers.get(prefix)
      if (!pending) {
        pending = SqPackReader.open({
          prefix: `${prefix}.win32`,
          useIndex2,
        })
        // Cache before awaiting so parallel probes do not reopen the same index.
        this.readers.set(prefix, pending)
      }
      const reader = await pending
      if (await reader.hasFile(parsed.path))
        return { prefix, reader, path: parsed.path }
    }
    return null
  }

  /** Returns a prefix without platform or extension, or null when absent. */
  async resolvePrefix(resourcePath: string): Promise<string | null> {
    return (await this.locate(resourcePath))?.prefix ?? null
  }

  async readFile(resourcePath: string): Promise<Buffer | null> {
    const found = await this.locate(resourcePath)
    return found ? found.reader.readFile(found.path) : null
  }

  async close(): Promise<void> {
    try {
      const readers = await Promise.allSettled(this.readers.values())
      await Promise.all(
        readers.map((reader) =>
          reader.status === 'fulfilled' ? reader.value.close() : undefined,
        ),
      )
    } finally {
      this.readers.clear()
      this.repositories.clear()
      this.candidates.clear()
    }
  }
}

export async function resolveSqPackPrefix(
  gamePath: string,
  resourcePath: string,
): Promise<string | null> {
  const reader = new GameSqPackReader(gamePath)
  try {
    return await reader.resolvePrefix(resourcePath)
  } finally {
    await reader.close()
  }
}
