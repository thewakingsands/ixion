import { baseGameVersion, bootVersion } from '../config'
import { downloadPatch } from '../utils/download'
import { getWorkingDir } from '../utils/root'
import { requestServerPatches } from '../utils/server'
import type {
  ResolvedDirectoryIndex,
  ResolvedIndexMap,
} from '../utils/sqpack-index'
import { processTextures, type TextureChanges } from './asset/patch'
import { AssetStorage } from './asset/storage'
import type { UiAssetEntry } from './asset/types'
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
  const currentReference = await storage.loadCurrentReference()
  const fromVersion = currentReference.lastValidIndex
  const references = await storage.loadReferences()
  await storage.loadExistingAssets(fromVersion)
  const iconState = await storage.loadAssetState(fromVersion)
  let previousUiIndex: ResolvedIndexMap | undefined

  if (fromVersion !== baseGameVersion) {
    await storage.fs.loadState()
    previousUiIndex =
      (await validateIndexFile(storage.fs, references)) ?? undefined
  }

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
    // A reference can be discovered without any new UI patch (e.g. schema updates).
    if (previousUiIndex) {
      const changes = await processTextures({
        storage,
        iconState,
        uiIndex: previousUiIndex,
        onlyMissing: true,
      })
      await storage.writeAssetState(fromVersion, iconState)
      await storage.writePatchJson(
        fromVersion,
        assetFileListPath,
        storage.getAssetFileList(),
      )
      if (hasIconChanges(changes))
        await storage.writePatchJson(fromVersion, 'changes.json', changes)
      console.log(formatTextureChangeSummary(changes))
    }
    console.log(
      `No ${options.server} main-game UI patches to process after ${fromVersion}.`,
    )
    return
  }

  console.log(
    `Processing ${ffxivPatches.length} ${options.server} main-game patch(es) from ${fromVersion}.`,
  )

  if (currentReference.ffxiv !== currentReference.lastValidIndex) {
    console.log(
      `Replaying from last valid index state ${currentReference.lastValidIndex} while current reference is ${currentReference.ffxiv}.`,
    )
  }

  for (const [index, patch] of ffxivPatches.entries()) {
    console.log(`[${index + 1}/${ffxivPatches.length}] ${patch.version}`)

    console.log(`  Downloading patch ${patch.version}...`)
    const patchPath = await downloadPatch(patch, cwd)

    console.log(`  Applying patch ${patch.version}...`)
    await storage.fs.applyPatch(patchPath)

    console.log(`  Validating UI index...`)
    const uiIndex = await validateIndexFile(storage.fs, references)
    if (!uiIndex) {
      console.log(
        `  UI index is invalid; skipping patch metadata and keeping last valid index at ${currentReference.lastValidIndex}.`,
      )
      currentReference.ffxiv = patch.version
      await storage.writeCurrentReference({
        ffxiv: patch.version,
        lastValidIndex: currentReference.lastValidIndex,
      })
      continue
    }

    console.log(
      `  UI index valid with ${countResolvedIndexFiles(uiIndex)} referenced file(s).`,
    )

    console.log(`  Writing resolved index snapshot...`)
    await storage.writePatchJson(
      patch.version,
      'resolved-index.json',
      serializeResolvedIndexMap(uiIndex),
    )

    console.log(`  Saving patch filesystem state...`)
    await storage.fs.saveState()

    console.log(`  Extracting and encoding changed textures...`)
    const changes = await processTextures({
      uiIndex,
      storage,
      iconState,
      previousUiIndex,
    })

    console.log(`  ${formatTextureChangeSummary(changes)}`)

    const assetFileList = storage.getAssetFileList()
    console.log(`  Writing patch metadata...`)
    await storage.writePatchJson(patch.version, 'changes.json', changes)
    await storage.writeAssetState(patch.version, iconState)
    await storage.writePatchJson(
      patch.version,
      assetFileListPath,
      assetFileList,
    )
    await storage.writeCurrentReference({
      ffxiv: patch.version,
      lastValidIndex: patch.version,
    })

    if (storage.hasRemoteStorage() && hasIconChanges(changes)) {
      console.log(`  Syncing changed assets to remote storage...`)
      await storage.syncToRemote(patch.version)
    }

    previousUiIndex = uiIndex
    currentReference.ffxiv = patch.version
    currentReference.lastValidIndex = patch.version
    console.log(`  Clearing in-memory patch state...`)
    await storage.fs.clear()
    console.log(`  Finished ${patch.version}.`)
  }

  console.log(`Done. Assets: ${storage.assetRoot}`)
}

export async function resolveSavedUiIconState(
  options: AssetUiIconsStateOptions,
): Promise<void> {
  const storage = new AssetStorage(options)
  const currentVersion = await storage.loadCurrentReference()
  await storage.loadExistingAssets(currentVersion.lastValidIndex)
  await storage.fs.loadState()

  const uiIndex = await validateIndexFile(
    storage.fs,
    await storage.loadReferences(),
  )
  if (!uiIndex) {
    throw new Error('Invalid uiIndex')
  }

  const iconState = new Map<string, UiAssetEntry>()
  const result = await processTextures({
    storage,
    iconState,
    uiIndex,
  })

  console.log(result)
  await storage.writePatchJson(
    currentVersion.lastValidIndex,
    `${options.output ?? 'saved-state'}.json`,
    [...iconState.values()],
  )
}

export async function syncUiAssetsToRemoteStorage(
  options: AssetUiIconsSyncOptions,
): Promise<void> {
  const storage = new AssetStorage(options)
  await storage.syncToRemote(options.version, { syncAssets: true })
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

function countResolvedIndexFiles(resolvedIndexMap: ResolvedIndexMap): number {
  let count = 0

  for (const entry of resolvedIndexMap.values()) {
    for (const file of entry.files.values()) if (file.path) count++
  }

  return count
}

function formatTextureChangeSummary(changes: TextureChanges): string {
  return `Processed textures: ${changes.added.length} added, ${changes.edited.length} updated, ${changes.removed.length} removed, ${changes.unreferenced.length} unreferenced asset(s).`
}
