import { Readable } from 'node:stream'
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { afterEach, expect, it, vi } from 'vitest'
import { S3Storage } from '../src/adapter/s3'

const clients: S3Client[] = []
afterEach(() => { for (const client of clients.splice(0)) client.destroy(); vi.restoreAllMocks() })

function fixture(extra: Record<string, unknown> = {}) {
  const storage = new S3Storage({ name: 'garage', type: 's3', config: {
    endPoint: 'localhost', port: 3900, useSSL: false, accessKey: 'test', secretKey: 'test-only',
    region: 'garage', bucketName: 'bucket', prefix: 'root', paths: { ui: 'assets', versions: 'versions' },
    publicationMode: 'cooperative', ...extra,
  } })
  const client = Reflect.get(storage, 'client') as S3Client
  clients.push(client)
  return { storage, client }
}

it('preserves endpoint configuration and enables checksums unless explicitly configured', async () => {
  const { client } = fixture()
  expect(await client.config.region()).toBe('garage')
  expect(await client.config.endpoint!()).toMatchObject({ protocol: 'http:', hostname: 'localhost', port: 3900 })
  expect(client.config.forcePathStyle).toBe(true)
  expect(await client.config.requestChecksumCalculation()).toBe('WHEN_SUPPORTED')
  expect(await client.config.responseChecksumValidation()).toBe('WHEN_SUPPORTED')
  const compatible = fixture({ forcePathStyle: false, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' }).client
  expect(compatible.config.forcePathStyle).toBe(false)
  expect(await compatible.config.requestChecksumCalculation()).toBe('WHEN_REQUIRED')
  expect(await compatible.config.responseChecksumValidation()).toBe('WHEN_REQUIRED')
})

it('writes UTF-8 bytes and content type and consumes downloaded streams', async () => {
  const { storage, client } = fixture()
  const send = vi.spyOn(client, 'send').mockImplementation(async (command: any) => {
    if (command instanceof GetObjectCommand) return { Body: Readable.from([Buffer.from('hello'), Buffer.from(' world')]) }
    return { ETag: 'etag', $metadata: { httpStatusCode: 200 } }
  })
  await storage.writeFile('s', 'ui', 'nested/file', '中文', 'text/plain')
  const put = send.mock.calls.map(call => call[0]).find(command => command instanceof PutObjectCommand) as PutObjectCommand
  expect(put.input).toMatchObject({ Bucket: 'bucket', Key: 'root/assets/s/nested/file', ContentType: 'text/plain', ContentLength: 6 })
  expect(Buffer.from(put.input.Body as Uint8Array).toString()).toBe('中文')
  expect((await storage.readFileStrict('s', 'ui', 'nested/file'))?.toString()).toBe('hello world')
})

it('maps only missing objects to null and propagates authorization and stream failures', async () => {
  const { storage, client } = fixture()
  const send = vi.spyOn(client, 'send')
  send.mockRejectedValueOnce(Object.assign(new Error('missing'), { name: 'NoSuchKey' }))
  expect(await storage.readFileStrict('s', 'ui', 'missing')).toBeNull()
  send.mockRejectedValueOnce(Object.assign(new Error('forbidden'), { $metadata: { httpStatusCode: 403 } }))
  await expect(storage.readFileStrict('s', 'ui', 'secret')).rejects.toThrow('forbidden')
  send.mockResolvedValueOnce({ Body: Readable.from((async function* () { yield Buffer.from('partial'); throw new Error('broken stream') })()) } as never)
  await expect(storage.readFileStrict('s', 'ui', 'broken')).rejects.toThrow('broken stream')
})

it('sends inclusive byte ranges and rejects invalid ranges before making requests', async () => {
  const { storage, client } = fixture()
  const send = vi.spyOn(client, 'send').mockResolvedValue({ Body: Readable.from([Buffer.from('2345')]) } as never)
  expect((await storage.readFileRange('s', 'ui', 'probe', 2, 4)).toString()).toBe('2345')
  expect((send.mock.calls[0][0] as GetObjectCommand).input).toMatchObject({ Key: 'root/assets/s/probe', Range: 'bytes=2-5' })
  await expect(storage.readFileRange('s', 'ui', 'probe', -1, 4)).rejects.toThrow('Invalid')
  expect(send).toHaveBeenCalledTimes(1)
})

it('consumes continuation pages and preserves relative paths and sorting', async () => {
  const { storage, client } = fixture()
  const send = vi.spyOn(client, 'send').mockImplementation(async (command: any) => {
    expect(command.input).toMatchObject({ Bucket: 'bucket', Prefix: 'root/assets/s' })
    return command.input.ContinuationToken
      ? { Contents: [{ Key: 'root/assets/s/a' }] }
      : { Contents: [{ Key: 'root/assets/s/z' }, { Key: 'root/assets/s/folder/' }], IsTruncated: true, NextContinuationToken: 'page2' }
  })
  expect(await storage.listFiles('s', 'ui')).toEqual(['a', 'z'])
  expect(send).toHaveBeenCalledTimes(2)
  expect((send.mock.calls[1][0] as any).input.ContinuationToken).toBe('page2')
})

it.each([false, true])('uses multipart and cleans up after failure=%s', async (fail) => {
  const { storage, client } = fixture()
  const commands: any[] = []
  vi.spyOn(client, 'send').mockImplementation(async (command: any) => {
    commands.push(command)
    switch (command.constructor.name) {
      case 'CreateMultipartUploadCommand': return { UploadId: 'upload1' }
      case 'UploadPartCommand':
        if (fail && command.input.PartNumber === 2) throw new Error('part failed')
        return { ETag: `part-${command.input.PartNumber}` }
      default: return { ETag: 'done', $metadata: { httpStatusCode: 200 } }
    }
  })
  const upload = storage.writeFile('s', 'ui', 'big', Buffer.alloc(6 * 1024 * 1024), 'application/octet-stream')
  if (fail) await expect(upload).rejects.toThrow('part failed')
  else await upload
  const names = commands.map(command => command.constructor.name)
  expect(names).toContain('CreateMultipartUploadCommand')
  expect(names.filter(name => name === 'UploadPartCommand')).toHaveLength(2)
  expect(names).toContain(fail ? 'AbortMultipartUploadCommand' : 'CompleteMultipartUploadCommand')
  expect(names).not.toContain(fail ? 'CompleteMultipartUploadCommand' : 'AbortMultipartUploadCommand')
  expect(commands[0].input.ContentType).toBe('application/octet-stream')
})

it('rejects atomic creation in cooperative mode without sending a request', async () => {
  const { storage, client } = fixture()
  const send = vi.spyOn(client, 'send')
  await expect(storage.createFile('s', 'ui', 'lock', Buffer.from('lock'))).rejects.toThrow('cooperative')
  expect(send).not.toHaveBeenCalled()
})

it('does not misinterpret a conditional write conflict as an existing object', async () => {
  const { storage, client } = fixture({ publicationMode: 'conditional' })
  const send = vi.spyOn(client, 'send').mockRejectedValue(Object.assign(new Error('conflict'), { name: 'ConditionalRequestConflict', $metadata: { httpStatusCode: 409 } }))
  await expect(storage.createFile('s', 'ui', 'lock', Buffer.from('lock'))).rejects.toThrow('conflict')
  expect((send.mock.calls[0][0] as PutObjectCommand).input.IfNoneMatch).toBe('*')
})

it.each(['WHEN_SUPPORTED', 'WHEN_REQUIRED'] as const)('serializes signed path-style requests with checksum policy %s without network access', async (policy) => {
  const { storage, client: original } = fixture()
  const requests: any[] = []
  const client = new S3Client({
    endpoint: 'http://localhost:3900', region: 'garage', forcePathStyle: true,
    credentials: { accessKeyId: 'local-test', secretAccessKey: 'local-test-only' },
    requestChecksumCalculation: policy, responseChecksumValidation: policy,
    requestHandler: {
      async handle(request: any) {
        requests.push(request)
        return { response: { statusCode: 200, headers: { etag: '"test-etag"' }, body: Readable.from(request.method === 'GET' ? [Buffer.from('payload')] : []) } }
      },
    },
  })
  clients.push(client)
  Reflect.set(storage, 'client', client)
  original.destroy()
  await storage.writeFile('s', 'ui', 'space name/中文', 'payload', 'text/plain')
  expect((await storage.readFileStrict('s', 'ui', 'space name/中文'))?.toString()).toBe('payload')
  expect(requests).toHaveLength(2)
  expect(requests[0].path).toBe('/bucket/root/assets/s/space%20name/%E4%B8%AD%E6%96%87')
  expect(requests[0].headers.authorization).toContain('/garage/s3/aws4_request')
  expect(requests[0].headers['content-type']).toBe('text/plain')
  if (policy === 'WHEN_SUPPORTED') expect(requests[0].headers['x-amz-checksum-crc32']).toBeDefined()
  else expect(requests[0].headers['x-amz-checksum-crc32']).toBeUndefined()
})
