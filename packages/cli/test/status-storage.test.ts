import { Readable } from 'node:stream'
import {
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3'
import { expect, it, vi } from 'vitest'
import { regions, type Status } from '../src/actions/status'
import {
  publishStatus,
  readStatus,
  statusTarget,
} from '../src/actions/status-storage'

const status: Status = {
  schemaVersion: 1,
  regions: regions.map((r) => ({
    ...r,
    version: null,
    observedAt: null,
    attemptedAt: '2026-01-01T00:00:00.000Z',
    error: 'upstream',
  })),
}
const missing = Object.assign(new Error('missing'), { name: 'NoSuchKey' })
const target = (send: ReturnType<typeof vi.fn>) => ({
  client: { send } as unknown as S3Client,
  bucket: 'test',
  key: 'status.json',
})
const response = (text: string) => ({
  Body: Readable.from([Buffer.from(text)]),
})

it('creates the first complete object with the expected metadata', async () => {
  const send = vi.fn().mockRejectedValueOnce(missing).mockResolvedValueOnce({})
  const observe = vi.fn(async () => status)
  await publishStatus(target(send), observe)
  expect(observe).toHaveBeenCalledWith(null)
  expect(send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand)
  const command = send.mock.calls[1][0]
  expect(command).toBeInstanceOf(PutObjectCommand)
  expect(command.input).toEqual({
    Bucket: 'test',
    Key: 'status.json',
    Body: `${JSON.stringify(status, null, 2)}\n`,
    ContentType: 'application/json',
    CacheControl: 'public, max-age=0, must-revalidate',
  })
})
it.each(['AccessDenied', 'NoSuchBucket', 'TypeError', 'NotFound'])(
  'does not turn %s into a missing object',
  async (name) => {
    const send = vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('error'), { name })),
      observe = vi.fn()
    await expect(publishStatus(target(send), observe)).rejects.toThrow()
    expect(send).toHaveBeenCalledOnce()
    expect(observe).not.toHaveBeenCalled()
  },
)
it.each([
  '{bad',
  JSON.stringify({ schemaVersion: 1, regions: [] }),
  'x'.repeat(1024 * 1024 + 1),
])(
  'stops before observation for damaged or oversized prior data',
  async (text) => {
    const send = vi.fn().mockResolvedValue(response(text)),
      observe = vi.fn()
    await expect(publishStatus(target(send), observe)).rejects.toThrow()
    expect(send).toHaveBeenCalledOnce()
    expect(observe).not.toHaveBeenCalled()
  },
)
it('passes previous successful state to observation, and propagates upload failures', async () => {
  const send = vi
    .fn()
    .mockResolvedValueOnce(response(JSON.stringify(status)))
    .mockRejectedValueOnce(new Error('upload failed'))
  const observe = vi.fn(async () => status)
  await expect(publishStatus(target(send), observe)).rejects.toThrow(
    'upload failed',
  )
  expect(observe).toHaveBeenCalledWith(status)
  expect(send).toHaveBeenCalledTimes(2)
})
it('does not upload a failed generation or invalid output', async () => {
  const send = vi.fn().mockRejectedValue(missing)
  await expect(
    publishStatus(target(send), async () => {
      throw new Error('generation failed')
    }),
  ).rejects.toThrow()
  await expect(
    publishStatus(target(send), async () => ({
      schemaVersion: 1,
      regions: [],
    })),
  ).rejects.toThrow()
  expect(
    send.mock.calls.every(([command]) => command instanceof GetObjectCommand),
  ).toBe(true)
})
it('bounds the stream even if content length is absent', async () => {
  const stream = Readable.from([Buffer.alloc(600_000), Buffer.alloc(600_000)])
  await expect(
    readStatus(target(vi.fn().mockResolvedValue({ Body: stream }))),
  ).rejects.toThrow('1 MiB')
  expect(stream.destroyed).toBe(true)
})
it('rejects incomplete and non-HTTPS deployment configuration', () => {
  expect(() => statusTarget({})).toThrow('Missing')
  expect(() =>
    statusTarget({ STATUS_S3_ENDPOINT: 'http://example.test' }),
  ).toThrow('HTTPS')
})
it('accepts an unset Actions path-style variable as false', async () => {
  const config = statusTarget({
    STATUS_S3_ENDPOINT: 'https://example.test',
    STATUS_S3_REGION: 'us-east-1',
    STATUS_S3_BUCKET: 'test',
    STATUS_S3_KEY: 'status.json',
    STATUS_S3_FORCE_PATH_STYLE: '',
    AWS_ACCESS_KEY_ID: 'synthetic-access-key',
    AWS_SECRET_ACCESS_KEY: 'synthetic-secret',
  })
  expect(config.client.config.forcePathStyle).toBe(false)
  config.client.destroy()
})
