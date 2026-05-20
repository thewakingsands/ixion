import { mkdirSync } from 'node:fs'
import {
  compressDirectoryToBuffer,
  decompressToDirectory,
  sortVersions,
} from '@ffcafe/ixion-utils'
import { Client } from 'minio'
import {
  AbstractStorage,
  type StorageConfig,
  type StoragePathMap,
  type VersionData,
} from '../abstract.js'

export interface MinioStorageConfig {
  endPoint: string
  port?: number
  useSSL?: boolean
  accessKey: string
  secretKey: string
  bucketName: string
  region?: string
  prefix?: string
  paths?: StoragePathMap
}

export class MinioStorage extends AbstractStorage {
  private client: Client
  private bucketName: string
  private prefix: string
  private versionsPath: string

  constructor(config: StorageConfig) {
    super(config)
    const minioConfig = config.config as MinioStorageConfig
    this.bucketName = minioConfig.bucketName
    this.prefix = trimStorageSegment(minioConfig.prefix || '')
    this.versionsPath = trimStorageSegment(minioConfig.paths?.versions || '')

    this.client = new Client({
      endPoint: minioConfig.endPoint,
      port: minioConfig.port,
      useSSL: minioConfig.useSSL ?? true,
      accessKey: minioConfig.accessKey,
      secretKey: minioConfig.secretKey,
      region: minioConfig.region,
    })
  }

  /**
   * Build object name with prefix
   */
  private getObjectName(server: string, name: string): string {
    return [this.prefix, this.versionsPath, server, name]
      .filter(Boolean)
      .join('/')
  }

  private getServerPrefix(server: string): string {
    return [this.prefix, this.versionsPath, server].filter(Boolean).join('/')
  }

  async readCurrentVersion(server: string): Promise<VersionData | null> {
    try {
      const objectName = this.getObjectName(server, 'current.json')

      // Check if the object exists
      try {
        await this.client.statObject(this.bucketName, objectName)
      } catch (error: any) {
        if (error.code === 'NotFound') {
          return null
        }
        throw error
      }

      // Get the object
      const stream = await this.client.getObject(this.bucketName, objectName)

      // Convert stream to string
      const chunks: Buffer[] = []
      for await (const chunk of stream) {
        chunks.push(chunk)
      }

      const content = Buffer.concat(chunks).toString('utf-8')
      const data = JSON.parse(content)
      return data as VersionData
    } catch (error) {
      console.warn('⚠️ Failed to read current.json from MinIO storage:', error)
      return null
    }
  }

  async writeCurrentVersion(
    server: string,
    versionData: VersionData,
  ): Promise<void> {
    try {
      const objectName = this.getObjectName(server, 'current.json')
      const content = JSON.stringify(versionData, null, 2)

      await this.client.putObject(
        this.bucketName,
        objectName,
        content,
        content.length,
        {
          'Content-Type': 'application/json',
        },
      )
    } catch (error) {
      throw new Error(
        `Failed to write current version to MinIO storage: ${error}`,
      )
    }
  }

  async hasVersion(server: string, version: string): Promise<boolean> {
    try {
      const objectName = this.getObjectName(server, `${version}.zip`)

      // Check if the zip file exists
      try {
        await this.client.statObject(this.bucketName, objectName)
        return true
      } catch (error: any) {
        if (error.code === 'NotFound') {
          return false
        }
        throw error
      }
    } catch (error) {
      console.warn(
        `⚠️ Failed to check if version ${version} exists in MinIO storage:`,
        error,
      )
      return false
    }
  }

  async listVersions(server: string): Promise<string[]> {
    try {
      const versions = new Set<string>()
      const searchPrefix = this.getServerPrefix(server)

      const objects = this.client.listObjects(
        this.bucketName,
        searchPrefix,
        true,
      )

      for await (const obj of objects) {
        if (obj.name) {
          const match = obj.name.match(
            new RegExp(`^${escapeRegExp(searchPrefix)}\\/(.+)\\.zip$`),
          )
          if (match) {
            versions.add(match[1])
          }
        }
      }

      return sortVersions(Array.from(versions))
    } catch (error) {
      console.warn('⚠️ Failed to list versions from MinIO storage:', error)
      return []
    }
  }

  async downloadVersion(
    server: string,
    version: string,
    targetPath: string,
  ): Promise<void> {
    try {
      // Ensure target directory exists
      mkdirSync(targetPath, { recursive: true })

      // Download the zip file
      const objectName = this.getObjectName(server, `${version}.zip`)

      const stream = await this.client.getObject(this.bucketName, objectName)

      // Convert stream to buffer
      const chunks: Buffer[] = []
      for await (const chunk of stream) {
        chunks.push(chunk)
      }
      const zipBuffer = Buffer.concat(chunks)

      // Decompress the zip file to the target directory
      await decompressToDirectory(zipBuffer, targetPath)
    } catch (error) {
      throw new Error(`Failed to download version ${version}: ${error}`)
    }
  }

  async uploadVersion(
    server: string,
    version: string,
    sourcePath: string,
  ): Promise<void> {
    try {
      // Compress the entire directory into a zip file
      const zipBuffer = await compressDirectoryToBuffer(sourcePath)

      // Upload the zip file
      const objectName = this.getObjectName(server, `${version}.zip`)

      await this.client.putObject(
        this.bucketName,
        objectName,
        zipBuffer,
        zipBuffer.length,
        {
          'Content-Type': 'application/zip',
        },
      )
    } catch (error) {
      throw new Error(`Failed to upload version ${version}: ${error}`)
    }
  }

  async deleteVersion(server: string, version: string): Promise<void> {
    try {
      const objectName = this.getObjectName(server, `${version}.zip`)

      // Delete the zip file
      await this.client.removeObject(this.bucketName, objectName)
    } catch (error) {
      throw new Error(`Failed to delete version ${version}: ${error}`)
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Try to list buckets to check connectivity
      await this.client.listBuckets()

      // Try to check if our bucket exists
      const bucketExists = await this.client.bucketExists(this.bucketName)

      if (!bucketExists) {
        // Try to create the bucket if it doesn't exist
        await this.client.makeBucket(this.bucketName)
      }

      return true
    } catch (error) {
      console.warn('⚠️ MinIO storage health check failed:', error)
      return false
    }
  }
}

function trimStorageSegment(value: string): string {
  return value.replace(/^\/+|\/+$/g, '')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
