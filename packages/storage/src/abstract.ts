export interface VersionData {
  ffxiv: string
  ex1?: string
  ex2?: string
  ex3?: string
  ex4?: string
  ex5?: string
}

export interface StoragePathMap {
  versions?: string
  [key: string]: string | undefined
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
   * Get the root path or prefix for a storage path type.
   */
  abstract getRootPath(pathKey: string, server?: string): string

  /**
   * Write the current version data to storage
   */
  abstract writeCurrentVersion(
    server: string,
    versionData: VersionData,
  ): Promise<void>

  /**
   * Read a non-version file from storage.
   */
  abstract readFile(
    server: string,
    pathKey: string,
    relativePath: string,
  ): Promise<Buffer | null>

  /**
   * Write a non-version file to storage.
   */
  abstract writeFile(
    server: string,
    pathKey: string,
    relativePath: string,
    content: Buffer | string,
    contentType?: string,
  ): Promise<void>

  /**
   * List non-version files from storage recursively.
   */
  abstract listFiles(
    server: string,
    pathKey: string,
    prefix?: string,
  ): Promise<string[]>

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
