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
import { dirname, join, relative } from 'node:path'
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
  private rootPath: string
  private paths?: StoragePathMap
  private versionsRootPath: string

  constructor(config: StorageConfig) {
    super(config)
    const localConfig = config.config as LocalStorageConfig
    this.rootPath = localConfig.rootPath
    this.paths = localConfig.paths
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

  getRootPath(pathKey: string, server?: string): string {
    const rootPath = join(this.rootPath, this.getStoragePathSegment(pathKey))
    return server ? join(rootPath, server) : rootPath
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

  async readFile(
    server: string,
    pathKey: string,
    relativePath: string,
  ): Promise<Buffer | null> {
    try {
      const filePath = this.getStorageFilePath(server, pathKey, relativePath)
      if (!existsSync(filePath)) {
        return null
      }

      return readFileSync(filePath)
    } catch (error) {
      console.warn(
        `⚠️ Failed to read ${pathKey}/${relativePath} from local storage:`,
        error,
      )
      return null
    }
  }

  async writeFile(
    server: string,
    pathKey: string,
    relativePath: string,
    content: Buffer | string,
  ): Promise<void> {
    try {
      const filePath = this.getStorageFilePath(server, pathKey, relativePath)
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, content)
    } catch (error) {
      throw new Error(
        `Failed to write ${pathKey}/${relativePath} to local storage: ${error}`,
      )
    }
  }

  async listFiles(
    server: string,
    pathKey: string,
    prefix = '',
  ): Promise<string[]> {
    try {
      const rootPath = this.getStorageServerPath(server, pathKey)
      const searchPath = prefix ? join(rootPath, prefix) : rootPath
      if (!existsSync(searchPath)) {
        return []
      }

      return this.listDirectoryFiles(searchPath).map((filePath) =>
        relative(rootPath, filePath).replaceAll('\\', '/'),
      )
    } catch (error) {
      console.warn(
        `⚠️ Failed to list ${pathKey}/${prefix} from local storage:`,
        error,
      )
      return []
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

  private getStoragePathSegment(pathKey: string): string {
    if (pathKey === 'versions') {
      return this.paths?.versions || ''
    }

    return this.paths?.[pathKey] || pathKey
  }

  private getStorageServerPath(server: string, pathKey: string): string {
    return join(this.rootPath, this.getStoragePathSegment(pathKey), server)
  }

  private getStorageFilePath(
    server: string,
    pathKey: string,
    relativePath: string,
  ): string {
    return join(this.getStorageServerPath(server, pathKey), relativePath)
  }

  private listDirectoryFiles(rootPath: string): string[] {
    const entries = readdirSync(rootPath, { withFileTypes: true })
    const files: string[] = []

    for (const entry of entries) {
      const entryPath = join(rootPath, entry.name)
      if (entry.isDirectory()) {
        files.push(...this.listDirectoryFiles(entryPath))
      } else {
        files.push(entryPath)
      }
    }

    return files
  }
}
