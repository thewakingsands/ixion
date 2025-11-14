import { getStorageManager } from '../../utils/storage'
import { createConfigFromTemplate } from './init'
import { createRelease } from './steps/release'
import { checkAndUpdateVersions } from './steps/update'

export const ciCommand = async () => {
  try {
    console.log('🔍 Running CI actions...')

    // Step 1: Create config from template if needed
    createConfigFromTemplate()

    // Step 2: Get storage manager
    const storageManager = getStorageManager()

    // Step 3: Run update for all servers
    const currentVersions = await checkAndUpdateVersions(storageManager)

    // Step 4: Check if versions changed and create releases
    await createRelease(currentVersions)

    console.log('\n✅ CI actions completed successfully')
  } catch (error) {
    console.error('❌ CI actions failed:', error)
    process.exit(1)
  }
}
