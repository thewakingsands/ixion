import type { PatchEntry } from '@ffcafe/ixion-server'
import { servers } from '@ffcafe/ixion-server'
import { bootVersion } from '../config.js'
import { downloadPatch } from '../utils/download.js'
import { getStorageManager } from '../utils/storage.js'
import { createVersionFromPatches } from './create-version'
import { CurrentVersion } from './current-version'

export interface UpdateOptions {
  from?: string
  dryRun?: boolean
  server: string
}

export const updateCommand = async (options: UpdateOptions) => {
  try {
    console.log('🔍 Checking current version...')

    const server = servers[options.server as keyof typeof servers]
    if (!server) {
      throw new Error(`Unknown server: ${options.server}`)
    }

    // Create storage manager from config
    const storageManager = getStorageManager()

    const currentVersion = await CurrentVersion.create(
      storageManager,
      options.server,
    )

    // Use the manually specified version if provided, otherwise use the detected version
    if (options.from) {
      currentVersion.setTemporaryVersion(options.from)
      console.log(`📝 Using manually specified version: ${options.from}`)
    } else {
      console.log(`Current FFXIV version: ${currentVersion.ffxiv}`)
    }

    console.log(
      `📡 Fetching patch list from ${options.server} server (${server.displayName})...`,
    )

    // Convert CurrentVersion to GameVersions format
    const gameVersions = {
      boot: bootVersion,
      ffxiv: currentVersion.ffxiv,
      expansions: currentVersion.expansions,
    }

    const allPatches = await server.request(gameVersions)

    if (allPatches.length === 0) {
      console.log('✅ No updates available')
      return
    }

    // Separate FFXIV patches from expansion patches
    const ffxivPatches = allPatches.filter(
      (patch) => patch.expansion === 'ffxiv',
    )
    const expansionPatches = allPatches.filter(
      (patch) => patch.expansion !== 'ffxiv',
    )

    console.log(`Found ${allPatches.length} total patches:`)
    console.log(`  - FFXIV patches: ${ffxivPatches.length}`)
    console.log(`  - Expansion patches: ${expansionPatches.length}`)

    // Track latest expansion versions
    const latestExpansions = getLatestExpansionVersions(expansionPatches)
    console.log('📊 Latest expansion versions detected:')
    Object.entries(latestExpansions).forEach(([expansion, version]) => {
      console.log(`  - ${expansion}: ${version}`)
    })

    if (ffxivPatches.length === 0) {
      console.log('✅ No FFXIV updates available')
      await currentVersion.update(latestExpansions)
      return
    }

    if (options.dryRun) {
      console.log('\n🔍 Dry run - FFXIV patches that would be applied:')
      ffxivPatches.forEach((patch, index) => {
        console.log(
          `  ${index + 1}. ${patch.version} (${formatBytes(patch.patchSize)})`,
        )
      })
      if (Object.keys(latestExpansions).length > 0) {
        console.log('\n📊 Expansion versions that would be updated:')
        Object.entries(latestExpansions).forEach(([expansion, version]) => {
          console.log(`  - ${expansion}: ${version}`)
        })
      }
      return
    }

    console.log('\n📥 Starting FFXIV patch download and application...')

    // Track the current version
    let version = currentVersion.ffxiv

    for (let i = 0; i < ffxivPatches.length; i++) {
      const patch = ffxivPatches[i]
      console.log(
        `\n[${i + 1}/${ffxivPatches.length}] Processing patch: ${patch.version}`,
      )

      try {
        // Download the patch
        const patchPath = await downloadPatch(patch)

        // Apply the patch
        await createVersionFromPatches(storageManager, {
          server: options.server,
          from: version,
          to: patch.version,
          patches: [patchPath],
        })
        console.log(`✅ Patch ${patch.version} applied`)

        // Update the current version
        version = patch.version

        console.log(`✅ Successfully applied patch ${patch.version}`)
      } catch (error) {
        console.error(`❌ Failed to apply patch ${patch.version}:`, error)
        throw error
      }
    }

    // Update expansion versions
    await currentVersion.update({
      ...latestExpansions,
      ffxiv: version,
    })

    console.log('\n🎉 All FFXIV patches applied successfully!')
  } catch (error) {
    console.error('❌ Update failed:', error)
    process.exit(1)
  }
}

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B'

  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`
}

const getLatestExpansionVersions = (
  expansionPatches: PatchEntry[],
): Record<string, string> => {
  const latestVersions: Record<string, string> = {}

  // Use index order instead of string comparison since patch list is in chronological order
  // Later patches in the list are newer versions
  for (let i = 0; i < expansionPatches.length; i++) {
    const patch = expansionPatches[i]
    const expansion = patch.expansion

    // Always update to the latest patch we've seen for this expansion
    // Since patches are in chronological order, later patches are newer
    latestVersions[expansion] = patch.version
  }

  return latestVersions
}
