import { expect, it, vi } from 'vitest'
import { createAssetStateEntry, processTextures } from '../../src/actions/asset/patch'
import type { UiAssetEntry } from '../../src/actions/asset/types'

const paths = Array.from({ length: 80 }, (_, index) =>
  `ui/icon/009000/${(9000 + index).toString().padStart(6, '0')}.tex`,
)

it('skips empty placeholders and continues encoding other textures', async () => {
  const state = new Map<string, UiAssetEntry>()
  const encode = vi.fn(async () => ({ format: 'webp' as const, persisted: true }))
  const result = await processTextures({
    paths: paths.slice(0, 2), iconState: state,
    reader: { readFile: async (path) => path === paths[0] ? null : Buffer.from('texture') },
    storage: { ensureEncodedAsset: encode },
  })
  expect(result.added).toHaveLength(1)
  expect(state.has(paths[0])).toBe(false)
  expect(state.has(paths[1])).toBe(true)
  expect(encode).toHaveBeenCalledOnce()
})

it('removes stale incremental mappings when an indexed texture becomes a placeholder', async () => {
  const previous = createAssetStateEntry(paths[0], 'old-hash', 'webp')
  const state = new Map([[paths[0], previous]])
  const encode = vi.fn()
  const result = await processTextures({
    paths: [paths[0]], iconState: state,
    reader: { readFile: async () => null }, storage: { ensureEncodedAsset: encode },
  })
  expect(result.removed).toEqual([previous])
  expect(result.unreferenced).toEqual(['old-hash'])
  expect(state.size).toBe(0)
  expect(encode).not.toHaveBeenCalled()
})

it('continues encoding past a slow texture, duplicates and missing candidates', async () => {
  const gate = Promise.withResolvers<void>()
  const state = new Map<string, UiAssetEntry>()
  const encode = vi.fn(async (_hash: string, data: Buffer) => {
    if (data.toString() === 'slow') await gate.promise
    return { format: 'webp' as const, persisted: true }
  })
  const run = processTextures({
    paths, iconState: state, storage: { ensureEncodedAsset: encode },
    reader: { readFile: async (path) => {
      const index = paths.indexOf(path)
      if (index <= 20) return Buffer.from('slow')
      if (index <= 40) return null
      return Buffer.from(path)
    } },
  })
  try {
    await vi.waitFor(() => expect(state.has(paths[79])).toBe(true))
    expect(state.has(paths[0])).toBe(false)
    expect(encode).toHaveBeenCalledTimes(40)
  } finally {
    gate.resolve()
    await run
  }
  expect(state.size).toBe(60)
  expect(state.get(paths[0])?.sha256).toBe(state.get(paths[20])?.sha256)
})

it('bounds both read-ahead and active encoders while reporting slow work by time', async () => {
  vi.useFakeTimers()
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const gate = Promise.withResolvers<void>()
  let active = 0
  let peak = 0
  const readFile = vi.fn(async (path: string) => Buffer.from(path))
  const run = processTextures({
    paths, iconState: new Map(), reader: { readFile },
    storage: { ensureEncodedAsset: async () => {
      ++active
      peak = Math.max(peak, active)
      await gate.promise
      --active
      return { format: 'webp', persisted: true }
    } },
  })
  try {
    await vi.waitFor(() => expect(active).toBe(16))
    expect(readFile.mock.calls.length).toBeLessThanOrEqual(32)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('written 0, active 16'))
    expect(log).toHaveBeenCalledWith(expect.stringContaining(`oldest ${paths[0]}`))
  } finally {
    gate.resolve()
    await run
    vi.useRealTimers()
    log.mockRestore()
  }
  expect(peak).toBe(16)
})
