import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  AssetReferenceCollector,
  type AssetReferences,
  collectAssetReferences,
  type DefinitionProvider,
} from '@ffcafe/ixion-exd'
import { GameSqPackReader } from '@ffcafe/ixion-sqpack'
import { readGameVersion } from '../utils/game'
import { processTextures } from './asset/patch'
import { AssetStorage } from './asset/storage'
import type { UiAssetEntry } from './asset/types'
import { generateLocalAssetPaths } from './asset/ui-index'

export interface ExtractLocalUiAssetsOptions {
  server: string
  references?: string
}

export async function extractLocalUiAssets(
  gamePath: string,
  definitions: DefinitionProvider,
  options: ExtractLocalUiAssetsOptions = { server: 'sdo' },
) {
  const version = readGameVersion(gamePath)
  if (!version || !/^\d{4}\.\d{2}\.\d{2}\.\d{4}\.\d{4}$/.test(version)) {
    throw new Error(`Missing or invalid ffxivgame.ver in ${gamePath}`)
  }
  // Publish the completed snapshot locally only; do not upload or alter .diff.
  const storage = new AssetStorage({ server: options.server })
  const referencesPath = options.references
  const reader = new GameSqPackReader(gamePath)
  try {
    await storage.loadExistingAssets(version)
    const collector = new AssetReferenceCollector(
      await storage.loadReferences(),
    )
    if (referencesPath) {
      try {
        collector.merge(
          JSON.parse(await readFile(referencesPath, 'utf8')) as AssetReferences,
        )
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    const { references } = await collectAssetReferences(
      reader,
      definitions,
      collector,
    )
    const mergedReferences = await storage.saveReferences(references)
    if (referencesPath) {
      await mkdir(dirname(referencesPath), { recursive: true })
      await writeFile(
        referencesPath,
        `${JSON.stringify(mergedReferences, null, 2)}\n`,
      )
    }
    const state = new Map<string, UiAssetEntry>()
    await processTextures({
      storage,
      reader,
      iconState: state,
      paths: generateLocalAssetPaths(gamePath, mergedReferences),
    })
    await storage.writeAssetState(version, state)
    await storage.writePatchJson(
      version,
      'asset-files.json',
      storage.getAssetFileList(),
    )
    await storage.writeCurrentReference({
      ffxiv: version,
      lastValidIndex: version,
    })
    console.log(
      `Extracted ${state.size} referenced textures to ${storage.outputRoot} (version ${version})`,
    )
  } finally {
    await reader.close()
  }
}
