import { expect, test, vi } from 'vitest'
import { createTextureFormatter } from '../../src/actions/asset/texture'

test.each([
  [128, 128, 'webp'], [129, 129, 'avif'], [129, 128, 'webp'],
  [128, 129, 'webp'], [1024, 1, 'webp'],
])('auto %ix%i chooses %s after a single decode', async (width, height, format) => {
  const image = { width: Number(width), height: Number(height), data: Buffer.alloc(4) }
  const decode = vi.fn(async () => image)
  const encode = vi.fn(async () => ({ format: 'webp' as const, data: Buffer.alloc(1) }))
  const input = Buffer.from('tex')
  await createTextureFormatter(decode, encode)(input, { format: 'auto', quality: 75, effort: 6 })
  expect(decode).toHaveBeenCalledExactlyOnceWith(input)
  expect(encode).toHaveBeenCalledExactlyOnceWith(image, { format, quality: 75, effort: 6 })
})

test('default and explicit choices preserve business rules', async () => {
  const decode = vi.fn(async () => ({ width: 512, height: 512, data: Buffer.alloc(4) }))
  const encode = vi.fn(async () => ({ format: 'webp' as const, data: Buffer.alloc(1) }))
  const format = createTextureFormatter(decode, encode)
  await format(Buffer.alloc(0))
  expect(encode).toHaveBeenNthCalledWith(1, expect.anything(), expect.objectContaining({ format: 'webp' }))
  await format(Buffer.alloc(0), { format: 'avif' })
  expect(encode).toHaveBeenNthCalledWith(2, expect.anything(), expect.objectContaining({ format: 'avif' }))
  await expect(format(Buffer.alloc(0), { format: 'png' as 'webp' })).rejects.toThrow('Unsupported')
  expect(decode).toHaveBeenCalledTimes(2)
})
