import { bootVersion } from '../config'
import { downloadPatch } from '../utils/download'
import { getWorkingDir } from '../utils/root'
import { requestServerPatches } from '../utils/server'
import {
  buildIconDirectoryHashes,
  type ResolvedDirectoryIndex,
  type ResolvedIndexMap,
} from '../utils/sqpack-index'
import { processTextures, type TextureChanges } from './asset/patch'
import { AssetStorage } from './asset/storage'
import type { IconEntry } from './asset/types'
import { validateIndexFile } from './asset/ui-index'

const assetFileListPath = 'asset-files.json'

export interface AssetUiIconsOptions {
  server: string
  limit?: number
  storage?: string
}

export interface AssetUiIconsStateOptions {
  server: string
  output?: string
  storage?: string
}

export interface AssetUiIconsSyncOptions {
  server: string
  storage: string
  version?: string
}

export async function extractUiPatchIcons(
  options: AssetUiIconsOptions,
): Promise<void> {
  const cwd = getWorkingDir()
  const storage = new AssetStorage(options)
  const fromVersion = await storage.loadCurrentReference()
  await storage.loadExistingAssets(fromVersion)
  const iconState = await storage.loadIconState(fromVersion)
  let previousUiIndex: ResolvedIndexMap | undefined

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

    const patchPath = await downloadPatch(patch, cwd)
    await storage.fs.applyPatch(patchPath)

    const uiIndex = await validateIndexFile(storage.fs, iconDirectoryHashes)
    if (!uiIndex) {
      await storage.writePatchJson(patch.version, 'resolved-index.json', {
        valid: false,
      })
      await storage.writeCurrentReference(patch.version)
      continue
    }

    await storage.writePatchJson(
      patch.version,
      'resolved-index.json',
      serializeResolvedIndexMap(uiIndex),
    )

    await storage.fs.saveState()

    const changes = await processTextures({
      uiIndex,
      storage,
      iconState,
      previousUiIndex,
    })

    const serializedIconState = serializeIconState(iconState)
    const assetFileList = storage.getAssetFileList()
    await storage.writePatchJson(patch.version, 'changes.json', changes)
    await storage.writePatchJson(
      patch.version,
      'icons.json',
      serializedIconState,
    )
    await storage.writePatchJson(
      patch.version,
      assetFileListPath,
      assetFileList,
    )
    await storage.writeCurrentReference(patch.version)

    if (storage.hasRemoteStorage() && hasIconChanges(changes)) {
      await storage.syncToRemote(patch.version)
    }

    previousUiIndex = uiIndex
    await storage.fs.clear()
  }

  console.log(`Done. Assets: ${storage.assetRoot}`)
}

export async function resolveSavedUiIconState(
  options: AssetUiIconsStateOptions,
): Promise<void> {
  const storage = new AssetStorage(options)
  const currentVersion = await storage.loadCurrentReference()
  await storage.loadExistingAssets(currentVersion)
  await storage.fs.loadState()

  const iconDirectoryHashes = buildIconDirectoryHashes()
  const uiIndex = await validateIndexFile(storage.fs, iconDirectoryHashes)
  if (!uiIndex) {
    throw new Error('Invalid uiIndex')
  }

  const iconState = new Map<string, IconEntry>()
  const result = await processTextures({
    storage,
    iconState,
    uiIndex,
  })

  console.log(result)
}

export async function syncUiAssetsToRemoteStorage(
  options: AssetUiIconsSyncOptions,
): Promise<void> {
  const storage = new AssetStorage(options)
  await storage.syncToRemote(options.version)
}

function serializeIconState(iconState: Map<string, IconEntry>) {
  return [...iconState.values()]
}

function serializeResolvedIndexMap(
  resolvedIndexMap: Map<number, ResolvedDirectoryIndex>,
) {
  return [...resolvedIndexMap.entries()].map(([hash, entry]) => ({
    hash,
    path: entry.path,
    version: entry.version,
    files: [...entry.files.entries()].map(([fileHash, fileEntry]) => ({
      hash: fileHash.toString(),
      path: fileEntry.path,
      dataFileId: fileEntry.dataFileId,
      offset: fileEntry.offset,
    })),
  }))
}

function hasIconChanges(changes: TextureChanges) {
  return (
    changes.added.length > 0 ||
    changes.removed.length > 0 ||
    changes.edited.length > 0
  )
}
