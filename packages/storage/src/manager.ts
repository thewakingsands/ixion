import type { AbstractStorage, StorageConfig, VersionData } from './abstract'
import { LocalStorage } from './adapter/local'
import { MinioStorage } from './adapter/minio'

export class StorageManager {
  private storages: Map<string, AbstractStorage> = new Map()

  constructor(storages: StorageConfig[]) {
    for (const storageConfig of storages) {
      try {
        let storage: AbstractStorage

        switch (storageConfig.type) {
          case 'local':
            storage = new LocalStorage(storageConfig)
            break
          case 'minio':
            storage = new MinioStorage(storageConfig)
            break
          default:
            console.warn(`⚠️ Unknown storage type: ${storageConfig.type}`)
            continue
        }

        this.storages.set(storageConfig.name, storage)
      } catch (error) {
        console.warn(
          `⚠️ Failed to initialize storage ${storageConfig.name}:`,
          error,
        )
      }
    }
  }

  /**
   * Get a storage instance by name
   */
  getStorage(name: string): AbstractStorage | undefined {
    return this.storages.get(name)
  }

  /**
   * Get all available storages
   */
  getAllStorages(): AbstractStorage[] {
    return Array.from(this.storages.values())
  }

  /**
   * Get all storage names
   */
  getStorageNames(): string[] {
    return Array.from(this.storages.keys())
  }

  /**
   * Read current version from the default storage
   */
  async readCurrentVersion(server: string): Promise<VersionData | null> {
    for (const storage of this.storages.values()) {
      try {
        const currentVersion = await storage.readCurrentVersion(server)
        if (currentVersion) {
          return currentVersion
        }
      } catch (error) {
        console.warn(
          `⚠️ Failed to read current version from storage ${storage.getName()}:`,
          error,
        )
      }
    }
    return null
  }

  /**
   * Write current version to all storages
   */
  async writeCurrentVersion(
    server: string,
    versionData: VersionData,
  ): Promise<void> {
    const errors: string[] = []

    for (const [name, storage] of this.storages) {
      try {
        await storage.writeCurrentVersion(server, versionData)
      } catch (error) {
        errors.push(`${name}: ${error}`)
      }
    }

    if (errors.length > 0) {
      throw new Error(`Failed to write to some storages: ${errors.join(', ')}`)
    }
  }

  /**
   * Check if a version exists in any storage
   */
  async hasVersion(server: string, version: string): Promise<boolean> {
    for (const storage of this.storages.values()) {
      try {
        if (await storage.hasVersion(server, version)) {
          return true
        }
      } catch (error) {
        console.warn(
          `⚠️ Failed to check version ${version} in storage ${storage.getName()}:`,
          error,
        )
      }
    }
    return false
  }

  /**
   * List all versions from all storages
   */
  async listVersions(server: string): Promise<string[]> {
    const allVersions = new Set<string>()

    for (const storage of this.storages.values()) {
      try {
        const versions = await storage.listVersions(server)
        versions.forEach((version) => {
          allVersions.add(version)
        })
      } catch (error) {
        console.warn(
          `⚠️ Failed to list versions from storage ${storage.getName()}:`,
          error,
        )
      }
    }

    return Array.from(allVersions).sort()
  }

  /**
   * Get the latest version from all storages
   */
  async getLatestVersion(server: string): Promise<string | null> {
    const versions = await this.listVersions(server)
    if (versions.length === 0) {
      return null
    }

    return versions[versions.length - 1]
  }

  /**
   * Download a version from the first available storage that has it
   */
  async downloadVersion(
    server: string,
    version: string,
    targetPath: string,
  ): Promise<void> {
    for (const storage of this.storages.values()) {
      try {
        if (await storage.hasVersion(server, version)) {
          await storage.downloadVersion(server, version, targetPath)
          return
        }
      } catch (error) {
        console.warn(
          `⚠️ Failed to download version ${version} from storage ${storage.getName()}:`,
          error,
        )
      }
    }

    throw new Error(`Version ${version} not found in any storage`)
  }

  /**
   * Upload a version to all storages
   */
  async uploadVersion(
    server: string,
    version: string,
    sourcePath: string,
  ): Promise<void> {
    const errors: string[] = []

    for (const [name, storage] of this.storages) {
      try {
        await storage.uploadVersion(server, version, sourcePath)
      } catch (error) {
        errors.push(`${name}: ${error}`)
      }
    }

    if (errors.length > 0) {
      throw new Error(`Failed to upload to some storages: ${errors.join(', ')}`)
    }
  }

  /**
   * Delete a version from all storages
   */
  async deleteVersion(server: string, version: string): Promise<void> {
    const errors: string[] = []

    for (const [name, storage] of this.storages) {
      try {
        if (await storage.hasVersion(server, version)) {
          await storage.deleteVersion(server, version)
        }
      } catch (error) {
        errors.push(`${name}: ${error}`)
      }
    }

    if (errors.length > 0) {
      throw new Error(
        `Failed to delete from some storages: ${errors.join(', ')}`,
      )
    }
  }

  /**
   * Perform health check on all storages
   */
  async healthCheck(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {}

    for (const [name, storage] of this.storages) {
      try {
        results[name] = await storage.healthCheck()
      } catch (error) {
        console.warn(`⚠️ Health check failed for storage ${name}:`, error)
        results[name] = false
      }
    }

    return results
  }

  /**
   * Sync versions from source storage to target storage
   */
  async syncVersions(
    server: string,
    sourceStorageName: string,
    targetStorageName: string,
    versionFilter?: (version: string) => boolean,
  ): Promise<{ synced: string[]; skipped: string[]; errors: string[] }> {
    const sourceStorage = this.storages.get(sourceStorageName)
    const targetStorage = this.storages.get(targetStorageName)

    if (!sourceStorage) {
      throw new Error(`Source storage '${sourceStorageName}' not found`)
    }

    if (!targetStorage) {
      throw new Error(`Target storage '${targetStorageName}' not found`)
    }

    const synced: string[] = []
    const skipped: string[] = []
    const errors: string[] = []

    try {
      // Get all versions from source storage
      const sourceVersions = await sourceStorage.listVersions(server)

      // Filter versions if filter function provided
      const versionsToSync = versionFilter
        ? sourceVersions.filter(versionFilter)
        : sourceVersions

      console.log(
        `📋 Found ${versionsToSync.length} versions to sync from ${sourceStorageName} to ${targetStorageName}`,
      )

      for (const version of versionsToSync) {
        try {
          // Check if version already exists in target storage
          const existsInTarget = await targetStorage.hasVersion(server, version)

          if (existsInTarget) {
            console.log(`⏭️  Skipping ${version} (already exists in target)`)
            skipped.push(version)
            continue
          }

          console.log(`📥 Syncing ${version}...`)

          // Create a temporary directory for the version
          const { tmpdir } = await import('node:os')
          const tempDir = `${tmpdir()}/ixion-sync-${version}-${Date.now()}`

          try {
            // Download from source
            await sourceStorage.downloadVersion(server, version, tempDir)

            // Upload to target
            await targetStorage.uploadVersion(server, version, tempDir)

            console.log(`✅ Synced ${version}`)
            synced.push(version)
          } catch (error) {
            const errorMsg = `Failed to sync ${version}: ${error}`
            console.error(`❌ ${errorMsg}`)
            errors.push(errorMsg)
          }
        } catch (error) {
          const errorMsg = `Failed to process ${version}: ${error}`
          console.error(`❌ ${errorMsg}`)
          errors.push(errorMsg)
        }
      }
    } catch (error) {
      throw new Error(`Failed to sync versions: ${error}`)
    }

    return { synced, skipped, errors }
  }

  /**
   * Sync all versions between all storages (bidirectional)
   */
  async syncAllVersions(
    server: string,
  ): Promise<
    Record<string, { synced: string[]; skipped: string[]; errors: string[] }>
  > {
    const results: Record<
      string,
      { synced: string[]; skipped: string[]; errors: string[] }
    > = {}
    const storageNames = Array.from(this.storages.keys())

    for (let i = 0; i < storageNames.length; i++) {
      for (let j = i + 1; j < storageNames.length; j++) {
        const sourceName = storageNames[i]
        const targetName = storageNames[j]
        const syncKey = `${sourceName}->${targetName}`

        try {
          console.log(`🔄 Syncing from ${sourceName} to ${targetName}...`)
          results[syncKey] = await this.syncVersions(
            server,
            sourceName,
            targetName,
          )

          console.log(`🔄 Syncing from ${targetName} to ${sourceName}...`)
          const reverseKey = `${targetName}->${sourceName}`
          results[reverseKey] = await this.syncVersions(
            server,
            targetName,
            sourceName,
          )
        } catch (error) {
          console.error(
            `❌ Failed to sync between ${sourceName} and ${targetName}:`,
            error,
          )
          results[syncKey] = {
            synced: [],
            skipped: [],
            errors: [`Sync failed: ${error}`],
          }
        }
      }
    }

    return results
  }
}
