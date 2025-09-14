import { StorageManager } from '@ffcafe/ixion-storage'
import { readConfig } from './config'

/**
 * Get a configured StorageManager instance
 */
export function getStorageManager(): StorageManager {
  try {
    const config = readConfig()
    return new StorageManager(config.storages)
  } catch (error) {
    console.error('❌ Configuration error:', error)
    process.exit(1)
  }
}
