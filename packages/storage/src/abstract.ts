export interface VersionData {
  ffxiv: string
  ex1?: string
  ex2?: string
  ex3?: string
  ex4?: string
  ex5?: string
}

export interface StorageConfig {
  name: string
  type: 'local' | 'minio'
  config: Record<string, any>
}

export abstract class AbstractStorage {
  protected config: StorageConfig

  constructor(config: StorageConfig) {
    this.config = config
  }

  /**
   * Get the name of this storage instance
   */
  getName(): string {
    return this.config.name
  }

  /**
   * Get the type of this storage instance
   */
  getType(): string {
    return this.config.type
  }

  /**
   * Read the current version data from storage
   */
  abstract readCurrentVersion(server: string): Promise<VersionData | null>

  /**
   * Write the current version data to storage
   */
  abstract writeCurrentVersion(
    server: string,
    versionData: VersionData,
  ): Promise<void>

  /**
   * Check if a version exists in storage
   */
  abstract hasVersion(server: string, version: string): Promise<boolean>

  /**
   * List all available versions in storage
   */
  abstract listVersions(server: string): Promise<string[]>

  /**
   * Download version files to a local directory
   */
  abstract downloadVersion(
    server: string,
    version: string,
    targetPath: string,
  ): Promise<void>

  /**
   * Upload version files from a local directory
   */
  abstract uploadVersion(
    server: string,
    version: string,
    sourcePath: string,
  ): Promise<void>

  /**
   * Delete a version from storage
   */
  abstract deleteVersion(server: string, version: string): Promise<void>

  /**
   * Check if storage is accessible and working
   */
  abstract healthCheck(): Promise<boolean>
}
