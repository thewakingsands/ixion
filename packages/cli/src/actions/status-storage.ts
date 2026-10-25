import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { maxStatusBytes, parseStatus, type Status } from './status'

export interface StatusTarget {
  client: S3Client
  bucket: string
  key: string
}

export function statusTarget(
  env: NodeJS.ProcessEnv = process.env,
): StatusTarget {
  const required = (key: string) => {
    const value = env[key]
    if (!value) throw new Error(`Missing ${key}`)
    return value
  }
  const endpoint = new URL(required('STATUS_S3_ENDPOINT'))
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password)
    throw new Error(
      'Status S3 endpoint must use HTTPS without embedded credentials',
    )
  const style = env.STATUS_S3_FORCE_PATH_STYLE || 'false'
  if (style !== 'true' && style !== 'false')
    throw new Error('Invalid STATUS_S3_FORCE_PATH_STYLE')
  return {
    client: new S3Client({
      endpoint: endpoint.href,
      region: required('STATUS_S3_REGION'),
      forcePathStyle: style === 'true',
      maxAttempts: 2,
      credentials: {
        accessKeyId: required('AWS_ACCESS_KEY_ID'),
        secretAccessKey: required('AWS_SECRET_ACCESS_KEY'),
        sessionToken: env.AWS_SESSION_TOKEN || undefined,
      },
    }),
    bucket: required('STATUS_S3_BUCKET'),
    key: required('STATUS_S3_KEY'),
  }
}

export async function readStatus({
  client,
  bucket,
  key,
}: StatusTarget): Promise<Status | null> {
  try {
    const response = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { abortSignal: AbortSignal.timeout(30_000) },
    )
    const stream = response.Body as
      | (AsyncIterable<Uint8Array> & { destroy?: () => void })
      | undefined
    if (!stream || !stream[Symbol.asyncIterator])
      throw new Error('Invalid status object body')
    try {
      if ((response.ContentLength ?? 0) > maxStatusBytes)
        throw new Error('Status object exceeds 1 MiB')
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of stream) {
        const bytes = Buffer.from(chunk)
        size += bytes.length
        if (size > maxStatusBytes)
          throw new Error('Status object exceeds 1 MiB')
        chunks.push(bytes)
      }
      return parseStatus(
        new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
      )
    } finally {
      stream.destroy?.()
    }
  } catch (error) {
    if ((error as { name?: string }).name === 'NoSuchKey') return null
    throw error
  }
}

export async function publishStatus(
  target: StatusTarget,
  observe: (previous: Status | null) => Promise<Status>,
) {
  const previous = await readStatus(target)
  const next = await observe(previous)
  const body = `${JSON.stringify(parseStatus(JSON.stringify(next)), null, 2)}\n`
  await target.client.send(
    new PutObjectCommand({
      Bucket: target.bucket,
      Key: target.key,
      Body: body,
      ContentType: 'application/json',
      CacheControl: 'public, max-age=0, must-revalidate',
    }),
    { abortSignal: AbortSignal.timeout(30_000) },
  )
  return next
}
