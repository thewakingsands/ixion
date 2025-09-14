import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { StorageManager } from '@ffcafe/ixion-storage'
import { ZipatchReader } from '@ffcafe/ixion-zipatch'
import { baseGameVersion, files } from '../config'
import { readGameVersion } from '../utils/game'
import { getTempDir, getVersionDir } from '../utils/root'

/**
 * Create a new version from patches
 * @param patches - Path to patch files
 * @param from - Base version to patch from
 * @param to - Target version after patching
 * @param storageManager - Storage manager for downloading/uploading versions
 * @param server - Server name for storage operations
 */
export async function createVersionFromPatches(
  storageManager: StorageManager,
  {
    server,
    from,
    to,
    patches,
  }: {
    server: string
    from: string
    to: string
    patches: string[]
  },
) {
  // Check if patches exist
  for (const patch of patches) {
    if (!existsSync(patch)) {
      throw new Error(`Patch file not found: ${patch}`)
    }
  }

  const isBaseGameVersion = from === baseGameVersion
  if (!isBaseGameVersion) {
    const hasVersion = await storageManager.hasVersion(server, from)
    if (!hasVersion) {
      throw new Error(`Base version ${from} not found in storage`)
    }
  }

  console.log(`Patching from ${from} to ${to}`)
  console.log(`Applying ${patches.length} patch(es)`)

  // 1. Create a workspace dir in temp dir
  const workspaceDir = await getTempDir()
  console.log(`Created workspace: ${workspaceDir}`)

  try {
    // 2. Handle base version vs existing version
    if (isBaseGameVersion) {
      console.log(
        '🎯 Starting from base game version - working with empty workspace',
      )
      // For base game version, we start with an empty workspace
      // The patches will contain all necessary files
    } else {
      // Download base version from storage to workspace
      console.log(`📥 Downloading base version ${from} from storage...`)
      await storageManager.downloadVersion(server, from, workspaceDir)
      console.log(`✅ Base version ${from} downloaded to workspace`)
    }

    // 3. Apply patches one-by-one
    for (let i = 0; i < patches.length; i++) {
      const patch = patches[i]
      console.log(`\nApplying patch ${i + 1}/${patches.length}: ${patch}`)

      const reader = await ZipatchReader.open(patch)
      try {
        await reader.applyTo(workspaceDir, files)
        console.log(`✓ Applied patch: ${patch}`)
      } finally {
        await reader.close()
      }
    }

    // 4. Upload the patched version to storage
    console.log(`\n📤 Uploading patched version ${to} to storage...`)
    await storageManager.uploadVersion(server, to, workspaceDir)
    console.log(`✅ Successfully uploaded version ${to} to storage`)

    console.log(`\n✓ Successfully created version ${to}`)
  } finally {
    // Clean up workspace
    console.log(`\nCleaning up workspace: ${workspaceDir}`)
    rmSync(workspaceDir, { recursive: true, force: true })
  }
}

export function createVersionFromGame(gamePath: string) {
  let version = readGameVersion(gamePath)
  if (!version) {
    // try reading from {gamePath}/game
    gamePath = join(gamePath, 'game')
    version = readGameVersion(gamePath)
  }

  if (!version) {
    throw new Error('Not a valid game path')
  }

  const outputDir = getVersionDir(version)
  mkdirSync(outputDir, { recursive: true })
  for (const file of files) {
    mkdirSync(dirname(join(outputDir, file)), { recursive: true })
    copyFileSync(join(gamePath, file), join(outputDir, file))

    console.log(`${file} saved`)
  }
}
