import { join } from 'node:path'
import {
  AssetReferenceCollector,
  type AssetReferences,
  collectAssetReferences,
  EXDSchemaDefinitionProvider,
} from '@ffcafe/ixion-exd'
import { GameSqPackReader } from '@ffcafe/ixion-sqpack'
import type { AbstractStorage, StorageManager } from '@ffcafe/ixion-storage'
import { getWorkingDir } from '../../utils/root'
import { ExdBase } from '../exd-base'

export const referenceFile = 'references.json'

export async function loadAssetReferences(
  server: string,
  storages: AbstractStorage[],
) {
  const collector = new AssetReferenceCollector()
  for (const storage of storages) {
    const data = await storage.readFile(server, 'ui', referenceFile)
    if (data)
      collector.merge(JSON.parse(data.toString('utf8')) as AssetReferences)
  }
  return collector.toJSON()
}

export async function saveAssetReferences(
  server: string,
  storages: AbstractStorage[],
  references: AssetReferences,
) {
  // Always merge both local and remote copies before writing either one.
  const collector = new AssetReferenceCollector(
    await loadAssetReferences(server, storages),
  )
  collector.merge(references)
  const merged = collector.toJSON()
  for (const storage of storages) {
    await storage.writeFile(
      server,
      'ui',
      referenceFile,
      `${JSON.stringify(merged, null, 2)}\n`,
      'application/json',
    )
  }
  return merged
}

export async function collectGameAssetReferences(
  gamePath: string,
  server: string,
  manager: StorageManager,
) {
  const reader = new GameSqPackReader(gamePath)
  try {
    const result = await collectAssetReferences(
      reader,
      new EXDSchemaDefinitionProvider(join(getWorkingDir(), 'lib/EXDSchema')),
    )
    await saveAssetReferences(
      server,
      manager.getAllStorages(),
      result.references,
    )
  } finally {
    await reader.close()
  }
}

export async function collectStoredAssetReferences(
  server: string,
  version: string,
  manager: StorageManager,
) {
  const exd = new ExdBase([{ server, version }])
  try {
    await exd.prepareReaders()
    const result = await collectAssetReferences(
      exd.firstReader,
      new EXDSchemaDefinitionProvider(join(getWorkingDir(), 'lib/EXDSchema')),
    )
    await saveAssetReferences(
      server,
      manager.getAllStorages(),
      result.references,
    )
  } finally {
    await exd.close()
  }
}
