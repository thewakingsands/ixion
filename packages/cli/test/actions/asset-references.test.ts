import type { AbstractStorage } from '@ffcafe/ixion-storage'
import { expect, it } from 'vitest'
import { loadAssetReferences, saveAssetReferences } from '../../src/actions/asset/references'

it('retains all prior local and remote references across repeated saves', async () => {
  const contents = [
    JSON.stringify({ icons: [1, 2], maps: ['s1d1/00'] }),
    JSON.stringify({ icons: [2, 3], maps: ['f1h1/02'] }),
  ]
  const stores = contents.map((_, index) => ({
    readFile: async () => Buffer.from(contents[index]),
    writeFile: async (_server: string, _key: string, _path: string, value: string) => { contents[index] = value },
  }) as unknown as AbstractStorage)
  const expected = { icons: [1, 2, 3, 4], maps: ['f1h1/02', 's1d1/00'] }
  expect(await saveAssetReferences('sdo', stores, { icons: [4], maps: [] })).toEqual(expected)
  expect(contents.map((value) => JSON.parse(value))).toEqual([expected, expected])
  expect(await saveAssetReferences('sdo', stores, { icons: [], maps: [] })).toEqual(expected)
  expect(await loadAssetReferences('sdo', stores)).toEqual(expected)
})
