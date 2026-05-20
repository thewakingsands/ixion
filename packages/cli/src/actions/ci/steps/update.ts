import type { StorageManager } from '@ffcafe/ixion-storage'
import { type UpdateOptions, updateCommand } from '../../update'
import { serversToCheck } from '../constants'

export async function checkAndUpdateVersions(
  storageManager: StorageManager,
  skipUpdate = false,
  allowMissingRemoteVersion = false,
): Promise<Record<string, string>> {
  const currentVersions: Record<string, string> = {}
  const missingRemoteServers: string[] = []
  console.log('\n📡 Checking remote versions...')
  for (const serverName of serversToCheck) {
    const remoteVersion = await storageManager.getLatestVersion(serverName)
    if (remoteVersion) {
      console.log(`  ${serverName}: ${remoteVersion}`)
      currentVersions[serverName] = remoteVersion
    } else {
      console.log(`  ${serverName}: No remote version found`)
      missingRemoteServers.push(serverName)
    }
  }

  if (missingRemoteServers.length > 0 && !allowMissingRemoteVersion) {
    throw new Error(
      `Missing remote version for ${missingRemoteServers.join(', ')}. Refusing to continue without a remote version baseline. Re-run with --allow-missing-remote-version if this is intentional.`,
    )
  }

  // Step 3: Run update for both servers
  if (skipUpdate) {
    console.log('\n🔄 Skipping updates...')
  } else {
    console.log('\n🔄 Running updates...')
    for (const serverName of serversToCheck) {
      const updateResult = await updateCommand({
        server: serverName,
      } as UpdateOptions)

      currentVersions[serverName] = updateResult.afterVersion
    }
  }

  return currentVersions
}
