import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { StorageManager } from '@ffcafe/ixion-storage'
import { ZipatchReader } from '@ffcafe/ixion-zipatch'
import { baseGameVersion, exdSqPackFile, files } from '../config'
import { readGameVersion } from '../utils/game'
import { getTempDir } from '../utils/root'
import { getServerLanguages } from '../utils/server'
import { getStorageManager } from '../utils/storage'
import { verifyExdFiles } from './exd-verify'

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

    // 4. Verify contents of 0a0000.win32.dat0
    if (existsSync(join(workspaceDir, `${exdSqPackFile}.dat0`))) {
      try {
        await verifyExdFiles(workspaceDir, getServerLanguages(server))
      } catch (error) {
        console.warn('⚠️ Failed to verify EXD files:', error)
      }
    } else {
      console.warn('⚠️ No EXD files found in workspace')
    }

    // 5. Upload the patched version to storage
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

export async function createVersionFromGame(
  gamePath: string,
  server: string = 'default',
  targetStorage?: string,
) {
  let version = readGameVersion(gamePath)
  if (!version) {
    // try reading from {gamePath}/game
    gamePath = join(gamePath, 'game')
    version = readGameVersion(gamePath)
  }

  if (!version) {
    throw new Error('Not a valid game path')
  }

  console.log(`🎮 Recording game version: ${version}`)
  console.log(`📁 Game path: ${gamePath}`)

  // Get storage manager
  let storageManager = getStorageManager()

  // Create subset if targeting specific storage
  if (targetStorage) {
    storageManager = storageManager.createSubset([targetStorage])
    console.log(`📦 Targeting storage: ${targetStorage}`)
  } else {
    console.log('📦 Targeting all storages')
  }

  // Create a temporary directory for the version
  const tempDir = await getTempDir()
  console.log(`📂 Created temporary directory: ${tempDir}`)

  try {
    // Copy game files to temporary directory
    for (const file of files) {
      const sourcePath = join(gamePath, file)
      const targetPath = join(tempDir, file)

      if (!existsSync(sourcePath)) {
        console.warn(`⚠️ File not found: ${file}`)
        continue
      }

      mkdirSync(dirname(targetPath), { recursive: true })
      copyFileSync(sourcePath, targetPath)
      console.log(`✅ Copied: ${file}`)
    }

    // Upload to storage
    console.log(`\n📤 Uploading version ${version} to storage...`)
    await storageManager.uploadVersion(server, version, tempDir)

    console.log(`✅ Successfully uploaded to storage`)
    console.log(`\n🎉 Successfully recorded version ${version}`)
  } finally {
    // Clean up temporary directory
    console.log(`\n🧹 Cleaning up temporary directory: ${tempDir}`)
    rmSync(tempDir, { recursive: true, force: true })
  }
}
