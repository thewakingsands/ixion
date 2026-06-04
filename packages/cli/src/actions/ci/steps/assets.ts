import { extractUiPatchIcons } from '../../asset-ui-icons'

const uiAssetServers = ['sdo'] as const
const ciAssetStorage = 'minio'

export async function processAssets(): Promise<void> {
  console.log('\nProcessing UI assets...')

  for (const server of uiAssetServers) {
    console.log(`Processing UI icon assets for ${server}...`)
    await extractUiPatchIcons({
      server,
      storage: ciAssetStorage,
    })
  }
}
