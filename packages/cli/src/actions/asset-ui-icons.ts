import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { readIndexEntries, SqPackReader } from '@ffcafe/ixion-sqpack'
import { pMapIterable } from 'p-map'
import { baseGameVersion, bootVersion, uiSqPackFile } from '../config'
import { resolveLocalStoragePath } from '../utils/config'
import { downloadPatch } from '../utils/download'
import { PatchFileSystem } from '../utils/patch-fs'
import { getWorkingDir } from '../utils/root'
import { requestServerPatches } from '../utils/server'
import {
  buildIconDirectoryHashes,
  type ResolvedDirectoryIndex,
  type ResolvedFileIndex,
  resolveIndexMap,
} from '../utils/sqpack-index'

const require = createRequire(import.meta.filename)
const { formatTex } = require('@ffcafe/ixion-tex')

const sqpackHeaderSize = 0x400
const indexHeaderSize = 0x400
const allowList = [`${uiSqPackFile}.*`]
const assetProcessConcurrency = 16

export interface AssetUiIconsOptions {
  server: string
  limit?: number
}

export interface AssetUiIconsStateOptions {
  server: string
  output?: string
}

interface IconEntry {
  id: number
  version: string
  hr: boolean
  sha256: string
  format: AssetFormat
  path: string
}

interface ValidatedIndex {
  resolvedIndexMap: Map<number, ResolvedDirectoryIndex>
}

type EncodedAssetFormat = 'webp' | 'avif'
type AssetFormat = EncodedAssetFormat | 'tex'

export async function extractUiPatchIcons(
  options: AssetUiIconsOptions,
): Promise<void> {
  const cwd = getWorkingDir()
  const {
    outputRoot,
    patchOutputRoot,
    assetRoot,
    pendingDiffRoot,
    currentRefPath,
  } = getUiIconPaths(options.server)

  await mkdir(outputRoot, { recursive: true })
  await mkdir(patchOutputRoot, { recursive: true })
  await mkdir(assetRoot, { recursive: true })
  await mkdir(pendingDiffRoot, { recursive: true })
  const existingAssets = await scanExistingAssets(assetRoot)

  const fromVersion = await loadCurrentReference(currentRefPath)
  const iconState = await loadIconState(
    join(patchOutputRoot, fromVersion, 'icons.json'),
  )
  const fs = new PatchFileSystem(pendingDiffRoot, allowList)
  let previousValidIndex: ValidatedIndex | null = null

  const gameVersions = {
    boot: bootVersion,
    ffxiv: fromVersion,
    expansions: {},
  }

  const patches = await requestServerPatches(options.server, gameVersions)
  const { ffxivPatches } = patches

  if ((options.limit ?? 0) > 0) {
    ffxivPatches.length = Math.min(ffxivPatches.length, options.limit ?? 0)
  }

  if (ffxivPatches.length === 0) {
    console.log(
      `No ${options.server} main-game UI patches to process after ${fromVersion}.`,
    )
    return
  }

  const iconDirectoryHashes = buildIconDirectoryHashes()

  console.log(
    `Processing ${ffxivPatches.length} ${options.server} main-game patch(es) from ${fromVersion}.`,
  )

  for (const [index, patch] of ffxivPatches.entries()) {
    console.log(`[${index + 1}/${ffxivPatches.length}] ${patch.version}`)

    const patchDir = join(patchOutputRoot, patch.version)
    await mkdir(patchDir, { recursive: true })

    const patchPath = await downloadPatch(patch, cwd)
    await fs.applyPatch(patchPath)

    const uiIndex = await validateIndexFile(fs, iconDirectoryHashes)
    if (!uiIndex) {
      await writeJson(join(patchDir, 'resolved-index.json'), { valid: false })
      await writeJson(currentRefPath, { ffxiv: patch.version })
      continue
    }

    await writeJson(
      join(patchDir, 'resolved-index.json'),
      serializeResolvedIndexMap(uiIndex.resolvedIndexMap),
    )

    await fs.saveState()

    const changes = await processTextures({
      fs,
      iconDirectoryHashes,
      assetRoot,
      existingAssets,
      iconState,
      previousIconIndex: previousValidIndex?.resolvedIndexMap,
    })

    await writeJson(join(patchDir, 'changes.json'), changes)
    await writeJson(join(patchDir, 'icons.json'), serializeIconState(iconState))
    await writeJson(currentRefPath, { ffxiv: patch.version })

    previousValidIndex = uiIndex
    await fs.clear()
  }

  console.log(`Done. Assets: ${assetRoot}`)
}

export async function resolveSavedUiIconState(
  options: AssetUiIconsStateOptions,
): Promise<void> {
  const { assetRoot, pendingDiffRoot } = getUiIconPaths(options.server)
  const existingAssets = await scanExistingAssets(assetRoot)

  const fs = new PatchFileSystem(pendingDiffRoot, allowList)
  await fs.loadState()

  const iconDirectoryHashes = buildIconDirectoryHashes()
  const iconState = new Map<string, IconEntry>()
  const result = await processTextures({
    fs,
    iconDirectoryHashes,
    assetRoot,
    existingAssets,
    iconState,
  })

  console.log(result)
}

async function processTextures(options: {
  fs: PatchFileSystem
  iconDirectoryHashes: Map<number, string>

  assetRoot: string
  existingAssets: Map<string, EncodedAssetFormat>
  iconState: Map<string, IconEntry>
  previousIconIndex?: Map<number, ResolvedDirectoryIndex>
}) {
  const { fs, iconDirectoryHashes, iconState, existingAssets } = options
  const uiIndex = await validateIndexFile(fs, iconDirectoryHashes)
  if (!uiIndex) {
    throw new Error('Invalid index')
  }

  const changes = {
    added: [] as Array<IconEntry>,
    removed: [] as Array<IconEntry>,
    edited: [] as Array<{
      from: IconEntry
      to: IconEntry
    }>,
  }

  const afterStateReader = await SqPackReader.open({
    prefix: uiSqPackFile,
    open: async (path) => {
      return {
        async read(buffer: Buffer, offset = 0, length?: number, position = 0) {
          const read = await fs.readFile(
            path,
            position,
            length ? position + length : undefined,
          )
          if (!read) {
            return 0
          }

          read.copy(buffer, offset)
          return read.length
        },
        async readFile() {
          return fs.readFile(path) as Promise<Buffer>
        },
        async close() {},
      }
    },
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
        // remove
        if (previous) {
          unrefedHash.add(previous.sha256)
          changes.removed.push(previous)
          iconState.delete(path)
        }

        return null
      }

      const nextData = await afterStateReader.readFile(path).catch((e) => {
        console.error(e)
        return null
      })
      if (!nextData) {
        // Patch may not has this file, skip
        return null
      }

      const sha256 = createHash('sha256').update(nextData).digest('hex')
      if (previous && sha256 === previous.sha256 && previous.format !== 'tex') {
        // Same as previous
        return null
      }

      const encodedAsset = await ensureEncodedAsset({
        assetRoot: options.assetRoot,
        sha256,
        nextData,
        existingAssets,
      })

      return {
        previous,
        nextEntry: createIconStateEntry(path, sha256, encodedAsset.format),
        persisted: encodedAsset.persisted,
      }
    }

    const processedEntries = pMapIterable(
      iterateFiles(options.previousIconIndex ?? null, uiIndex.resolvedIndexMap),
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
        // update
        unrefedHash.add(previous.sha256)

        changes.edited.push({
          from: previous,
          to: nextEntry,
        })
      } else {
        // add
        changes.added.push(nextEntry)
      }

      iconState.set(nextEntry.path, nextEntry)
    }
  } finally {
    await afterStateReader?.close()
  }

  return changes
}

async function loadCurrentReference(currentRefPath: string) {
  if (!existsSync(currentRefPath)) {
    return baseGameVersion
  }

  const content = JSON.parse(await readFile(currentRefPath, 'utf-8')) as {
    ffxiv?: string
  }
  return content.ffxiv || baseGameVersion
}

async function loadIconState(stateIconsPath: string) {
  if (!existsSync(stateIconsPath)) {
    return new Map<string, IconEntry>()
  }

  const content = JSON.parse(await readFile(stateIconsPath, 'utf-8')) as Array<
    Omit<IconEntry, 'path'>
  >

  return new Map(
    content.map((entry) => [
      toIconPath(entry.id, entry.version, entry.hr),
      {
        ...entry,
        path: toIconPath(entry.id, entry.version, entry.hr),
      },
    ]),
  )
}

function getUiIconPaths(server: string) {
  const outputRoot = resolveLocalStoragePath('ui', server)
  const patchOutputRoot = join(outputRoot, 'patches')
  const assetRoot = join(outputRoot, 'assets')
  const pendingDiffRoot = join(outputRoot, '.diff')
  const currentRefPath = join(outputRoot, 'current.json')

  return {
    outputRoot,
    patchOutputRoot,
    assetRoot,
    pendingDiffRoot,
    currentRefPath,
  }
}

async function validateIndexFile(
  fs: PatchFileSystem,
  dirHashMap: Map<number, string>,
) {
  const buffer = await fs.readFile(`${uiSqPackFile}.index`)

  if (!buffer || buffer.length < sqpackHeaderSize + indexHeaderSize) {
    return null
  }

  try {
    const parsed = readIndexEntries(buffer, false)
    return {
      resolvedIndexMap: resolveIndexMap({
        ...parsed,
        dirHashMap,
        fileNameGenerator: generateIconFileNames,
      }),
    }
  } catch {
    return null
  }
}

interface FileChange {
  path: string
  beforeFile: ResolvedFileIndex | null
  afterFile: ResolvedFileIndex | null
}

function* iterateFiles(
  beforeIndex: Map<number, ResolvedDirectoryIndex> | null,
  afterIndex: Map<number, ResolvedDirectoryIndex>,
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

function serializeIconState(iconState: Map<string, IconEntry>) {
  return [...iconState.values()].sort(compareIconEntries)
}

function compareIconEntries(
  left: Omit<IconEntry, 'path'>,
  right: Omit<IconEntry, 'path'>,
) {
  if (left.id !== right.id) {
    return left.id - right.id
  }

  if (left.version !== right.version) {
    return left.version.localeCompare(right.version)
  }

  return Number(left.hr) - Number(right.hr)
}

function toIconPath(id: number, version: string, hr: boolean) {
  const paddedId = id.toString().padStart(6, '0')
  return `ui/icon/${paddedId.slice(0, 3)}000${version}/${paddedId}${hr ? '_hr1' : ''}.tex`
}

function generateIconFileNames(dirPath: string) {
  const match = dirPath.match(/^ui\/icon\/(\d{3})000/)
  if (!match) {
    return []
  }

  const startId = Number.parseInt(match[1], 10) * 1000
  const fileNames: string[] = []

  for (let id = startId; id < startId + 1000; id += 1) {
    const paddedId = id.toString().padStart(6, '0')
    fileNames.push(`${paddedId}.tex`)
    fileNames.push(`${paddedId}_hr1.tex`)
  }

  return fileNames
}

function serializeResolvedIndexMap(
  resolvedIndexMap: Map<number, ResolvedDirectoryIndex>,
) {
  return [...resolvedIndexMap.entries()]
    .sort(([leftHash], [rightHash]) => leftHash - rightHash)
    .map(([hash, entry]) => ({
      hash,
      path: entry.path,
      version: entry.version,
      files: [...entry.files.entries()]
        .sort(([leftHash], [rightHash]) =>
          leftHash < rightHash ? -1 : leftHash > rightHash ? 1 : 0,
        )
        .map(([fileHash, fileEntry]) => ({
          hash: fileHash.toString(),
          path: fileEntry.path,
          dataFileId: fileEntry.dataFileId,
          offset: fileEntry.offset,
        })),
    }))
}

async function persistAsset(
  assetRoot: string,
  sha256: string,
  format: EncodedAssetFormat,
  data: Buffer,
) {
  const dir = join(assetRoot, sha256.slice(0, 2))
  const path = join(dir, `${sha256}.${format}`)
  if (existsSync(path)) {
    const existing = await stat(path)
    if (existing.size === data.length) {
      return false
    }
  }

  await mkdir(dir, { recursive: true })
  await writeFile(path, data)
  return true
}

async function scanExistingAssets(assetRoot: string) {
  const existingAssets = new Map<string, EncodedAssetFormat>()
  const directories = await readdir(assetRoot, { withFileTypes: true }).catch(
    () => [],
  )

  for (const entry of directories) {
    if (!entry.isDirectory()) {
      continue
    }

    const files = await readdir(join(assetRoot, entry.name), {
      withFileTypes: true,
    }).catch(() => [])
    for (const file of files) {
      if (!file.isFile()) {
        continue
      }

      const match = file.name.match(/^([0-9a-f]{64})\.(webp|avif)$/)
      if (!match) {
        continue
      }

      existingAssets.set(match[1], match[2] as EncodedAssetFormat)
    }
  }

  return existingAssets
}

async function ensureEncodedAsset(options: {
  assetRoot: string
  sha256: string
  nextData: Buffer
  existingAssets: Map<string, EncodedAssetFormat>
}): Promise<{
  format: EncodedAssetFormat
  persisted: boolean
}> {
  const existingFormat = options.existingAssets.get(options.sha256)
  if (existingFormat) {
    return {
      format: existingFormat,
      persisted: false,
    }
  }

  const encoded = await formatTex(options.nextData, {
    format: 'auto',
  })
  const format = encoded.format as EncodedAssetFormat
  const persisted = await persistAsset(
    options.assetRoot,
    options.sha256,
    format,
    encoded.data,
  )

  options.existingAssets.set(options.sha256, format)
  return { format, persisted }
}

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}
