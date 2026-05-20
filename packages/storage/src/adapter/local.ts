import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { sortVersions, versionRegex } from '@ffcafe/ixion-utils'
import {
  AbstractStorage,
  type StorageConfig,
  type StoragePathMap,
  type VersionData,
} from '../abstract.js'

export interface LocalStorageConfig {
  rootPath: string
  paths?: StoragePathMap
}

export class LocalStorage extends AbstractStorage {
  private versionsRootPath: string

  constructor(config: StorageConfig) {
    super(config)
    const localConfig = config.config as LocalStorageConfig
    this.versionsRootPath = join(
      localConfig.rootPath,
      localConfig.paths?.versions || '',
    )
  }

  async readCurrentVersion(server: string): Promise<VersionData | null> {
    try {
      const currentJsonPath = join(
        this.versionsRootPath,
        server,
        'current.json',
      )
      if (!existsSync(currentJsonPath)) {
        return null
      }

      const content = readFileSync(currentJsonPath, 'utf-8')
      const data = JSON.parse(content)
      return data as VersionData
    } catch (error) {
      console.warn('⚠️ Failed to read current.json from local storage:', error)
      return null
    }
  }

  async writeCurrentVersion(
    server: string,
    versionData: VersionData,
  ): Promise<void> {
    try {
      // Ensure root directory exists
      const serverPath = join(this.versionsRootPath, server)
      mkdirSync(serverPath, { recursive: true })

      const currentJsonPath = join(serverPath, 'current.json')
      writeFileSync(currentJsonPath, JSON.stringify(versionData, null, 2))
    } catch (error) {
      throw new Error(
        `Failed to write current version to local storage: ${error}`,
      )
    }
  }

  async hasVersion(server: string, version: string): Promise<boolean> {
    const versionPath = join(this.versionsRootPath, server, version)
    return existsSync(versionPath) && statSync(versionPath).isDirectory()
  }

  async listVersions(server: string): Promise<string[]> {
    try {
      const serverPath = join(this.versionsRootPath, server)
      if (!existsSync(serverPath)) {
        return []
      }

      const entries = readdirSync(serverPath)
      const versionDirs = entries.filter((entry) => versionRegex.test(entry))

      return sortVersions(versionDirs)
    } catch (error) {
      console.warn('⚠️ Failed to list versions from local storage:', error)
      return []
    }
  }

  async downloadVersion(
    server: string,
    version: string,
    targetPath: string,
  ): Promise<void> {
    const sourcePath = join(this.versionsRootPath, server, version)

    if (!existsSync(sourcePath)) {
      throw new Error(`Version ${version} not found in local storage`)
    }

    try {
      // Ensure target directory exists
      mkdirSync(targetPath, { recursive: true })

      // Copy the entire version directory
      await this.copyDirectory(sourcePath, targetPath)
    } catch (error) {
      throw new Error(`Failed to download version ${version}: ${error}`)
    }
  }

  async uploadVersion(
    server: string,
    version: string,
    sourcePath: string,
  ): Promise<void> {
    if (!existsSync(sourcePath)) {
      throw new Error(`Source path ${sourcePath} does not exist`)
    }

    try {
      const targetPath = join(this.versionsRootPath, server, version)

      // Ensure target directory exists
      mkdirSync(targetPath, { recursive: true })

      // Copy the entire source directory
      await this.copyDirectory(sourcePath, targetPath)
    } catch (error) {
      throw new Error(`Failed to upload version ${version}: ${error}`)
    }
  }

  async deleteVersion(server: string, version: string): Promise<void> {
    const versionPath = join(this.versionsRootPath, server, version)

    if (!existsSync(versionPath)) {
      throw new Error(`Version ${version} not found in local storage`)
    }

    try {
      rmSync(versionPath, { recursive: true, force: true })
    } catch (error) {
      throw new Error(`Failed to delete version ${version}: ${error}`)
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Try to create the root directory if it doesn't exist
      mkdirSync(this.versionsRootPath, { recursive: true })

      // Try to read the directory
      readdirSync(this.versionsRootPath)
      return true
    } catch (error) {
      console.warn('⚠️ Local storage health check failed:', error)
      return false
    }
  }

  private async copyDirectory(source: string, target: string): Promise<void> {
    const entries = readdirSync(source, { withFileTypes: true })

    for (const entry of entries) {
      const sourcePath = join(source, entry.name)
      const targetPath = join(target, entry.name)

      if (entry.isDirectory()) {
        mkdirSync(targetPath, { recursive: true })
        await this.copyDirectory(sourcePath, targetPath)
      } else {
        copyFileSync(sourcePath, targetPath)
      }
    }
  }
}
