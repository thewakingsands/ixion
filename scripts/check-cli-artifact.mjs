import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Run against the extracted deploy artifact, not the development workspace.
const cli = resolve(process.argv[2])
const require = createRequire(join(cli, 'package.json'))
const texture = dirname(require.resolve('@ffcafe/elpis-texture/package.json'))
for (const file of ['dist/coordinator.cjs', 'dist/worker.cjs', 'dist/wasm/texture.js', 'dist/wasm/texture_bg.wasm', 'dist/wasm/build.json'])
  assert(existsSync(join(texture, file)), `Missing deployed texture resource: ${file}`)
assert(require.resolve('@ffcafe/ixion-image-encoder'))
const { formatTex } = await import(pathToFileURL(join(cli, 'dist/asset-texture.js')).href)
for (const [size, format] of [[2, 'webp'], [129, 'avif']]) {
  const tex = Buffer.alloc(80 + size * size * 4)
  tex.writeUInt32LE(0x00800000, 0)
  tex.writeUInt32LE(0x1450, 4)
  for (const offset of [8, 10]) tex.writeUInt16LE(size, offset)
  tex.writeUInt16LE(1, 12)
  tex[14] = 1
  tex.writeUInt32LE(80, 28)
  for (let i = 80; i < tex.length; i++) tex[i] = (i * 19) & 255
  const result = await formatTex(tex, { format: 'auto' })
  assert.equal(result.format, format)
  assert(Buffer.isBuffer(result.data))
  assert.equal(result.data.subarray(format === 'webp' ? 8 : 4, 12).toString(), format === 'webp' ? 'WEBP' : 'ftypavif')
}
console.log(JSON.stringify({ artifact: cli, texturePackage: texture, node: process.version, result: 'deployed TEX -> WASM RGBA -> native WebP/AVIF passed' }))
