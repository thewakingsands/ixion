import { readFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { crc32 } from 'node:zlib'
import type { S3Client } from '@aws-sdk/client-s3'
import { expect, it } from 'vitest'
import { S3Storage } from '../src/adapter/s3'

it.each([false, true])('handles composite checksums with CI compatibility=%s', async (compatibility) => {
  const template = JSON.parse(readFileSync(new URL('../../../.ixion-config.ci.json', import.meta.url), 'utf8'))
  const backbone = template.storages.find((storage: { name: string }) => storage.name === 'backbone')
  const storage = new S3Storage({ ...backbone, config: {
    ...backbone.config,
    endPoint: 'localhost', port: 3900, useSSL: false,
    accessKey: 'test', secretKey: 'test-only', region: 'garage', bucketName: 'bucket', prefix: '',
    ...(!compatibility && { requestChecksumCalculation: 'WHEN_SUPPORTED', responseChecksumValidation: 'WHEN_SUPPORTED' }),
  } })
  const client = Reflect.get(storage, 'client') as S3Client
  const payload = Buffer.from('multipart payload')
  const partChecksum = Buffer.alloc(4)
  partChecksum.writeUInt32BE(crc32(payload))
  const composite = Buffer.alloc(4)
  composite.writeUInt32BE(crc32(partChecksum))
  const requests: { method: string; headers: Record<string, string> }[] = []
  client.config.requestHandler = {
    async handle(request) {
      requests.push(request)
      return { response: { statusCode: 200, headers: {
        etag: '"test-etag"',
        // The backend exposes a multipart checksum without the S3 part-count suffix.
        ...(request.method === 'GET' && { 'x-amz-checksum-crc32': composite.toString('base64') }),
      }, body: Readable.from(request.method === 'GET' ? [payload] : []) } }
    },
  }
  try {
    const download = storage.readFileStrict('sdo', 'versions', 'version.zip')
    if (compatibility) await expect(download).resolves.toEqual(payload)
    else await expect(download).rejects.toThrow('Checksum mismatch')
    expect(requests[0].headers['x-amz-checksum-mode']).toBe(compatibility ? undefined : 'ENABLED')
    await storage.writeFile('sdo', 'versions', 'version.zip', payload)
    if (compatibility) expect(requests[1].headers['x-amz-checksum-crc32']).toBeUndefined()
    else expect(requests[1].headers['x-amz-checksum-crc32']).toBeDefined()
  } finally {
    client.destroy()
  }
})
