import { getStorageManager } from '../../utils/storage'
import { createConfigFromTemplate } from './init'
import { createRelease } from './steps/release'
import { checkAndUpdateVersions } from './steps/update'

export const ciUpdateCommand = async () => {
  try {
    console.log('🔍 Running CI actions...')

    // Step 1: Get storage manager
    const storageManager = getStorageManager()

    // Step 2: Run update for all servers
    const currentVersions = await checkAndUpdateVersions(storageManager)

    // Step 3: Check if versions changed and create releases
    await createRelease(currentVersions)

    console.log('\n✅ CI actions completed successfully')
  } catch (error) {
    console.error('❌ CI actions failed:', error)
    process.exit(1)
  }
}

export const ciInitCommand = async () => {
  try {
    console.log('🔍 Running CI initialization...')
    createConfigFromTemplate()
    console.log('\n✅ CI initialization completed successfully')
  } catch (error) {
    console.error('❌ CI initialization failed:', error)
    process.exit(1)
  }
}
