import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { Readable } from 'node:stream'
import {
  type BucketLocationConstraint,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  PutObjectCommand,
  paginateListObjectsV2,
  S3Client,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import {
  compressDirectoryToBuffer,
  decompressToDirectory,
  sortVersions,
} from '@ffcafe/ixion-utils'
import {
  AbstractStorage,
  type StorageConfig,
  type StoragePathMap,
  type VersionData,
} from '../abstract.js'

export interface S3StorageConfig {
  endPoint: string
  port?: number
  useSSL?: boolean
  accessKey: string
  secretKey: string
  bucketName: string
  region?: string
  forcePathStyle?: boolean
  requestChecksumCalculation?: 'WHEN_SUPPORTED' | 'WHEN_REQUIRED'
  responseChecksumValidation?: 'WHEN_SUPPORTED' | 'WHEN_REQUIRED'
  prefix?: string
  paths?: StoragePathMap
  publicationMode?: 'conditional' | 'cooperative'
}

export class S3Storage extends AbstractStorage {
  private conditionalSupport?: Promise<void>

  override getPublicationKey(server: string): string {
    const c = this.config.config as S3StorageConfig
    const tls = c.useSSL ?? true
    return createHash('sha256')
      .update(
        JSON.stringify([
          tls,
          c.endPoint.toLowerCase(),
          c.port ?? (tls ? 443 : 80),
          c.bucketName,
          this.getRootPath('ui', server),
        ]),
      )
      .digest('hex')
  }

  private async checkConditionalSupport(server: string, pathKey: string) {
    const probe = `.capabilities/${randomUUID()}`
    const original = Buffer.from(randomUUID())
    if (!(await this.conditionalCreate(server, pathKey, probe, original))) {
      throw new Error('Conditional-write probe UUID collision')
    }
    try {
      const overwritten = await this.conditionalCreate(
        server,
        pathKey,
        probe,
        Buffer.from('must-not-overwrite'),
      )
      const actual = await this.readFileStrict(server, pathKey, probe)
      if (overwritten || !actual?.equals(original)) {
        throw new Error(
          'Storage does not enforce If-None-Match conditional creation; chunk publication is disabled',
        )
      }
    } finally {
      await this.deleteFile(server, pathKey, probe)
    }
  }
  private assetKey(server: string, pathKey: string, relativePath: string) {
    return [
      this.getPathPrefix(server, pathKey),
      trimStorageSegment(relativePath),
    ]
      .filter(Boolean)
      .join('/')
  }

  async readFileStrict(
    server: string,
    pathKey: string,
    relativePath: string,
  ): Promise<Buffer | null> {
    try {
      return await streamToBuffer(
        await this.getObject(
          this.bucketName,
          this.assetKey(server, pathKey, relativePath),
        ),
      )
    } catch (e) {
      if (isMissing(e)) return null
      throw e
    }
  }

  async createFile(
    server: string,
    pathKey: string,
    relativePath: string,
    content: Buffer,
    contentType = 'application/octet-stream',
  ): Promise<boolean> {
    if (this.getPublicationPolicy().mode === 'cooperative')
      throw new Error(
        'Atomic create is unavailable in cooperative mode; use the guarded publication workflow',
      )
    this.conditionalSupport ??= this.checkConditionalSupport(server, pathKey)
    await this.conditionalSupport
    return this.conditionalCreate(
      server,
      pathKey,
      relativePath,
      content,
      contentType,
    )
  }

  private async conditionalCreate(
    server: string,
    pathKey: string,
    relativePath: string,
    content: Buffer,
    contentType = 'application/octet-stream',
  ): Promise<boolean> {
    try {
      // Single PUT: conditional headers must not disappear in multipart completion.
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: this.assetKey(server, pathKey, relativePath),
          IfNoneMatch: '*',
          ContentType: contentType,
          Body: content,
          ContentLength: content.length,
        }),
      )
      return true
    } catch (e) {
      if (errorName(e) === 'PreconditionFailed' || statusCode(e) === 412)
        return false
      throw e
    }
  }

  async deleteFile(
    server: string,
    pathKey: string,
    relativePath: string,
  ): Promise<void> {
    await this.removeObject(
      this.bucketName,
      this.assetKey(server, pathKey, relativePath),
    )
  }
  private client: S3Client
  private bucketName: string
  private prefix: string
  private paths?: StoragePathMap
  private versionsPath: string

  constructor(config: StorageConfig) {
    super(config)
    const s3Config = config.config as S3StorageConfig
    this.bucketName = s3Config.bucketName
    this.prefix = trimStorageSegment(s3Config.prefix || '')
    this.paths = s3Config.paths
    this.versionsPath = trimStorageSegment(s3Config.paths?.versions || '')

    this.client = new S3Client({
      endpoint: `${s3Config.useSSL === false ? 'http' : 'https'}://${s3Config.endPoint}${s3Config.port === undefined ? '' : `:${s3Config.port}`}`,
      credentials: {
        accessKeyId: s3Config.accessKey,
        secretAccessKey: s3Config.secretKey,
      },
      region: s3Config.region ?? 'us-east-1',
      forcePathStyle: s3Config.forcePathStyle ?? true,
      requestChecksumCalculation:
        s3Config.requestChecksumCalculation ?? 'WHEN_SUPPORTED',
      responseChecksumValidation:
        s3Config.responseChecksumValidation ?? 'WHEN_SUPPORTED',
    })
  }

  private async getObject(
    bucket: string,
    key: string,
    range?: string,
  ): Promise<Readable> {
    const { Body } = await this.client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key, Range: range }),
    )
    if (!(Body instanceof Readable))
      throw new Error('S3 returned no readable object body')
    return Body
  }

  /** Read an inclusive HTTP byte range without exposing the SDK client. */
  async readFileRange(
    server: string,
    pathKey: string,
    relativePath: string,
    offset: number,
    length: number,
  ): Promise<Buffer> {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(length) ||
      length <= 0 ||
      !Number.isSafeInteger(offset + length - 1)
    )
      throw new Error('Invalid S3 byte range')
    return streamToBuffer(
      await this.getObject(
        this.bucketName,
        this.assetKey(server, pathKey, relativePath),
        `bytes=${offset}-${offset + length - 1}`,
      ),
    )
  }

  private async statObject(bucket: string, key: string) {
    return this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
  }

  private async putObject(
    bucket: string,
    key: string,
    body: Buffer | string,
    _size: number,
    metadata?: Record<string, string>,
  ) {
    const content = typeof body === 'string' ? Buffer.from(body, 'utf8') : body
    // Upload selects single PUT or multipart and aborts failed multipart uploads.
    await new Upload({
      client: this.client,
      params: {
        Bucket: bucket,
        Key: key,
        Body: content,
        ContentLength: content.length,
        ContentType: metadata?.['Content-Type'],
      },
      leavePartsOnError: false,
    }).done()
  }

  private async removeObject(bucket: string, key: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: key }),
    )
  }

  private async *listObjects(
    bucket: string,
    prefix: string,
    _recursive: boolean,
  ) {
    for await (const page of paginateListObjectsV2(
      { client: this.client },
      { Bucket: bucket, Prefix: prefix },
    )) {
      for (const object of page.Contents ?? []) yield { name: object.Key }
    }
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

  private getPathPrefix(server: string, pathKey: string): string {
    return [this.prefix, this.getPathSegment(pathKey), server]
      .filter(Boolean)
      .join('/')
  }

  async readCurrentVersion(server: string): Promise<VersionData | null> {
    try {
      const objectName = this.getObjectName(server, 'current.json')

      // Check if the object exists
      try {
        await this.statObject(this.bucketName, objectName)
      } catch (error: any) {
        if (isMissing(error)) {
          return null
        }
        throw error
      }

      // Get the object
      const stream = await this.getObject(this.bucketName, objectName)

      // Convert stream to string
      const chunks: Buffer[] = []
      for await (const chunk of stream) {
        chunks.push(chunk)
      }

      const content = Buffer.concat(chunks).toString('utf-8')
      const data = JSON.parse(content)
      return data as VersionData
    } catch (error) {
      console.warn('⚠️ Failed to read current.json from S3 storage:', error)
      return null
    }
  }

  getRootPath(pathKey: string, server?: string): string {
    return [this.prefix, this.getPathSegment(pathKey), server]
      .filter(Boolean)
      .join('/')
  }

  async writeCurrentVersion(
    server: string,
    versionData: VersionData,
  ): Promise<void> {
    try {
      const objectName = this.getObjectName(server, 'current.json')
      const content = JSON.stringify(versionData, null, 2)

      await this.putObject(
        this.bucketName,
        objectName,
        content,
        content.length,
        {
          'Content-Type': 'application/json',
        },
      )
    } catch (error) {
      throw new Error(`Failed to write current version to S3 storage: ${error}`)
    }
  }

  async readFile(
    server: string,
    pathKey: string,
    relativePath: string,
  ): Promise<Buffer | null> {
    try {
      const objectName = [
        this.getPathPrefix(server, pathKey),
        trimStorageSegment(relativePath),
      ]
        .filter(Boolean)
        .join('/')

      try {
        await this.statObject(this.bucketName, objectName)
      } catch (error: any) {
        if (isMissing(error)) {
          return null
        }
        throw error
      }

      const stream = await this.getObject(this.bucketName, objectName)
      return await streamToBuffer(stream)
    } catch (error) {
      console.warn(
        `⚠️ Failed to read ${pathKey}/${relativePath} from S3 storage:`,
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
    contentType?: string,
  ): Promise<void> {
    try {
      const objectName = [
        this.getPathPrefix(server, pathKey),
        trimStorageSegment(relativePath),
      ]
        .filter(Boolean)
        .join('/')
      const body =
        typeof content === 'string' ? Buffer.from(content, 'utf-8') : content

      await this.putObject(
        this.bucketName,
        objectName,
        body,
        body.length,
        contentType ? { 'Content-Type': contentType } : undefined,
      )
    } catch (error) {
      throw new Error(
        `Failed to write ${pathKey}/${relativePath} to S3 storage: ${error}`,
      )
    }
  }

  async listFiles(
    server: string,
    pathKey: string,
    prefix = '',
  ): Promise<string[]> {
    try {
      const basePrefix = this.getPathPrefix(server, pathKey)
      const searchPrefix = [basePrefix, trimStorageSegment(prefix)]
        .filter(Boolean)
        .join('/')
      const files: string[] = []
      const objects = this.listObjects(this.bucketName, searchPrefix, true)

      for await (const obj of objects) {
        if (!obj.name || obj.name.endsWith('/')) {
          continue
        }

        files.push(obj.name.slice(basePrefix.length + 1))
      }

      return files.sort()
    } catch (error) {
      console.warn(
        `⚠️ Failed to list ${pathKey}/${prefix} from S3 storage:`,
        error,
      )
      return []
    }
  }

  async hasVersion(server: string, version: string): Promise<boolean> {
    try {
      const objectName = this.getObjectName(server, `${version}.zip`)

      // Check if the zip file exists
      try {
        await this.statObject(this.bucketName, objectName)
        return true
      } catch (error: any) {
        if (isMissing(error)) {
          return false
        }
        throw error
      }
    } catch (error) {
      console.warn(
        `⚠️ Failed to check if version ${version} exists in S3 storage:`,
        error,
      )
      return false
    }
  }

  async listVersions(server: string): Promise<string[]> {
    try {
      const versions = new Set<string>()
      const searchPrefix = this.getServerPrefix(server)

      const objects = this.listObjects(this.bucketName, searchPrefix, true)

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
      console.warn('⚠️ Failed to list versions from S3 storage:', error)
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

      const stream = await this.getObject(this.bucketName, objectName)

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

      await this.putObject(
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
      await this.removeObject(this.bucketName, objectName)
    } catch (error) {
      throw new Error(`Failed to delete version ${version}: ${error}`)
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Try to list buckets to check connectivity
      await this.client.send(new ListBucketsCommand({}))

      // Try to check if our bucket exists
      let bucketExists = true
      try {
        await this.client.send(
          new HeadBucketCommand({ Bucket: this.bucketName }),
        )
      } catch (error) {
        if (!isMissing(error)) throw error
        bucketExists = false
      }

      if (!bucketExists) {
        // Try to create the bucket if it doesn't exist
        const region = await this.client.config.region()
        await this.client.send(
          new CreateBucketCommand({
            Bucket: this.bucketName,
            ...(region === 'us-east-1'
              ? {}
              : {
                  CreateBucketConfiguration: {
                    LocationConstraint: region as BucketLocationConstraint,
                  },
                }),
          }),
        )
      }

      return true
    } catch (error) {
      console.warn('⚠️ S3 storage health check failed:', error)
      return false
    }
  }

  private getPathSegment(pathKey: string): string {
    if (pathKey === 'versions') {
      return this.versionsPath
    }

    return trimStorageSegment(this.paths?.[pathKey] || pathKey)
  }
}

function trimStorageSegment(value: string): string {
  return value.replace(/^\/+|\/+$/g, '')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

function errorName(error: unknown): string | undefined {
  const e = error as { name?: string; code?: string }
  return e?.name === 'Error' ? e.code : (e?.name ?? e?.code)
}

function statusCode(error: unknown): number | undefined {
  return (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode
}

function isMissing(error: unknown): boolean {
  return (
    ['NoSuchKey', 'NotFound', 'NoSuchBucket'].includes(
      errorName(error) ?? '',
    ) || statusCode(error) === 404
  )
}
