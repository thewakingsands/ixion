import type { StorageManager, VersionData } from '@ffcafe/ixion-storage'
import { baseGameVersion, expansions } from '../config'

export class CurrentVersion {
  private temporaryGameVersion?: string
  private versions: VersionData = {
    ffxiv: baseGameVersion,
  }

  private constructor(
    private storageManager: StorageManager,
    private serverName: string,
  ) {}

  static async create(
    storageManager: StorageManager,
    serverName: string,
  ): Promise<CurrentVersion> {
    const inst = new CurrentVersion(storageManager, serverName)
    await inst.load()

    return inst
  }

  private async load() {
    try {
      const versionData = await this.storageManager.readCurrentVersion(
        this.serverName,
      )
      if (versionData) {
        this.versions = { ...versionData }
        return
      }

      console.warn(
        '⚠️ No current version found in storage, falling back to latest version',
      )
    } catch (error) {
      console.warn(
        '⚠️ Failed to read current version from storage, falling back to latest version:',
        error,
      )
    }

    const latestVersion = await this.storageManager.getLatestVersion(
      this.serverName,
    )
    if (latestVersion) {
      this.versions.ffxiv = latestVersion
    }
  }

  get ffxiv(): string {
    return this.temporaryGameVersion || this.versions.ffxiv
  }

  get server(): string {
    return this.serverName
  }

  /**
   * Get expansion version
   */
  get expansions() {
    return Object.fromEntries(
      Object.entries(this.versions).filter(([key]) => key !== 'ffxiv'),
    )
  }

  /**
   * Update version
   */
  async update(input: Partial<VersionData>): Promise<void> {
    let isChanged = false
    for (const key of expansions) {
      if (input[key] && input[key] !== this.versions[key]) {
        isChanged = true
        this.versions[key] = input[key]
      }
    }

    if (isChanged) {
      await this.save()
    }
  }

  /**
   * Set a temporary version without saving to storage
   */
  setTemporaryVersion(input: string): void {
    this.temporaryGameVersion = input
  }

  /**
   * Save to storage system
   */
  async save(): Promise<void> {
    try {
      await this.storageManager.writeCurrentVersion(
        this.serverName,
        this.versions,
      )
      console.log('📝 Updated current version in storage')
    } catch (error) {
      console.error('❌ Failed to save current version to storage:', error)
      throw error
    }
  }
}
