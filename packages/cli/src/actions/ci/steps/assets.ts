import { getStorageManager } from '../../../utils/storage'
import { collectStoredAssetReferences } from '../../asset/references'
import { extractUiPatchIcons } from '../../asset-ui-icons'
import { mergedVersionReference } from '../constants'

const uiAssetServers = [mergedVersionReference] as const
const ciAssetStorage = 'minio'

export async function processAssets(
  versions: Record<string, string>,
): Promise<void> {
  console.log('\nProcessing UI assets...')

  for (const server of uiAssetServers) {
    const version = versions[server]
    if (!version) throw new Error(`Missing EXD version for ${server}`)
    // Also bootstraps installations whose EXD was processed before reference collection existed.
    await collectStoredAssetReferences(server, version, getStorageManager())
    console.log(`Processing referenced UI assets for ${server}...`)
    await extractUiPatchIcons({
      server,
      storage: ciAssetStorage,
    })
  }
}
