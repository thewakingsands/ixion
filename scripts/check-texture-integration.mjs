import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { createTextureFormatter } from '../packages/cli/src/actions/asset/texture.ts'

const require = createRequire(import.meta.url)
const elpis = require(resolve(process.argv[2]))
const { encodeRgba } = require('../packages/image-encoder')
const baseline = require('../packages/tex')
const formatTex = createTextureFormatter(elpis.decodeTex, encodeRgba)
let comparisons = 0
for (const [width, height] of [[2, 2], [128, 129], [129, 128], [129, 129]]) {
  const input = Buffer.alloc(80 + width * height * 4)
  input.writeUInt32LE(0x00800000, 0)
  input.writeUInt32LE(0x1450, 4)
  input.writeUInt16LE(width, 8)
  input.writeUInt16LE(height, 10)
  input.writeUInt16LE(1, 12)
  input[14] = 1
  input.writeUInt32LE(80, 28)
  for (let i = 80; i < input.length; i++) input[i] = (i * 19) & 255
  for (const options of [undefined, { format: 'webp', quality: 90, effort: 6 }, { format: 'avif', quality: 60, effort: 10 }, { format: 'auto' }]) {
    const expected = await baseline.formatTex(input, options)
    const actual = await formatTex(input, options)
    assert.equal(actual.format, expected.format)
    assert.deepEqual(actual.data, expected.data)
    comparisons++
  }
}
console.log(JSON.stringify({ comparisons, node: process.version, platform: process.platform, result: 'WASM + native output matches old native TEX pipeline byte for byte' }))
