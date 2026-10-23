const { test } = require('node:test')
const assert = require('node:assert/strict')
const { encodeRgba } = require('..')

const image = { width: 2, height: 2, data: Buffer.from([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 255, 255, 255, 255]) }
test('real WebP and AVIF encoders accept RGBA and return matching containers', async () => {
  for (const format of ['webp', 'avif']) {
    const output = await encodeRgba(image, { format })
    assert.equal(output.format, format)
    if (format === 'webp') assert.equal(output.data.subarray(8, 12).toString(), 'WEBP')
    else assert.equal(output.data.subarray(4, 12).toString(), 'ftypavif')
  }
})

test('invalid dimensions, lengths, formats and nonfinite options reject', async () => {
  for (const width of [0, -1, 1.5, 16385, NaN, Infinity])
    await assert.rejects(encodeRgba({ ...image, width }, { format: 'webp' }))
  await assert.rejects(encodeRgba({ ...image, data: new Uint8Array(16) }, { format: 'webp' }))
  await assert.rejects(encodeRgba({ ...image, data: Buffer.alloc(15) }, { format: 'webp' }))
  for (const format of ['auto', 'png', 'tex', undefined]) await assert.rejects(encodeRgba(image, { format }))
  for (const quality of [NaN, Infinity, -Infinity]) await assert.rejects(encodeRgba(image, { format: 'webp', quality }))
  for (const effort of [-1, 256, 1.5, NaN]) await assert.rejects(encodeRgba(image, { format: 'webp', effort }))
})

test('WebP quality and effort clamp to the existing encoder bounds', async () => {
  for (const [input, expected] of [[-100, 0], [1000, 100]]) {
    const a = await encodeRgba(image, { format: 'webp', quality: input, effort: 255 })
    const b = await encodeRgba(image, { format: 'webp', quality: expected, effort: 6 })
    assert.deepEqual(a.data, b.data)
  }
})

test('AVIF zero rejects normally and upper limits match existing settings', async () => {
  await assert.rejects(encodeRgba(image, { format: 'avif', quality: 0 }), /at least 1/)
  await assert.rejects(encodeRgba(image, { format: 'avif', effort: 0 }), /at least 1/)
  const a = await encodeRgba(image, { format: 'avif', quality: 1000, effort: 255 })
  const b = await encodeRgba(image, { format: 'avif', quality: 100, effort: 10 })
  assert.deepEqual(a.data, b.data)
})
