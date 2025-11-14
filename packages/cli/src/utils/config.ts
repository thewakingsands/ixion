import { existsSync, readFileSync } from 'node:fs'
import type { StorageConfig } from '@ffcafe/ixion-storage'
import { defaultConfigPath } from '../config'

export interface IxionConfig {
  storages: StorageConfig[]
}

/**
 * Read and parse the Ixion configuration file
 * @param configPath - Path to the config file (defaults to .ixion-config.json in current directory)
 * @returns Parsed configuration object
 */
export function readConfig(configPath?: string): IxionConfig {
  const finalConfigPath = configPath || getDefaultConfigPath()

  if (!existsSync(finalConfigPath)) {
    throw new Error(
      `Configuration file not found: ${finalConfigPath}\n` +
        'Please create a configuration file based on .ixion-config.json.example',
    )
  }

  try {
    const content = readFileSync(finalConfigPath, 'utf-8')
    const config = JSON.parse(content) as IxionConfig

    // Validate required fields
    if (!config.storages || !Array.isArray(config.storages)) {
      throw new Error('Configuration must contain a "storages" array')
    }

    // Validate each storage configuration
    for (const storage of config.storages) {
      if (!storage.name || !storage.type || !storage.config) {
        throw new Error(
          'Each storage must have "name", "type", and "config" fields',
        )
      }

      if (!['local', 'minio'].includes(storage.type)) {
        throw new Error(
          `Unsupported storage type: ${storage.type}. Supported types: local, minio`,
        )
      }
    }

    return config
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in configuration file: ${finalConfigPath}`)
    }
    throw error
  }
}

/**
 * Get the default configuration path
 * @returns Path to the default configuration file
 */
export function getDefaultConfigPath(): string {
  return defaultConfigPath
}

/**
 * Check if a configuration file exists
 * @param configPath - Path to check (defaults to .ixion-config.json)
 * @returns True if the config file exists
 */
export function configExists(configPath?: string): boolean {
  const finalConfigPath = configPath || getDefaultConfigPath()
  return existsSync(finalConfigPath)
}
