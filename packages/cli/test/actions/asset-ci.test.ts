import type { StorageManager } from '@ffcafe/ixion-storage'
import { expect, it, vi } from 'vitest'
import { processAssets } from '../../src/actions/ci/steps/assets'
import { checkAndUpdateVersions } from '../../src/actions/ci/steps/update'
import { updateCommand } from '../../src/actions/update'
import { collectStoredAssetReferences } from '../../src/actions/asset/references'
import { extractUiPatchIcons } from '../../src/actions/asset-ui-icons'

vi.mock('../../src/actions/update', () => ({ updateCommand: vi.fn(async () => ({ afterVersion: 'new' })) }))
vi.mock('../../src/actions/asset/references', () => ({ collectStoredAssetReferences: vi.fn() }))
vi.mock('../../src/actions/asset-ui-icons', () => ({ extractUiPatchIcons: vi.fn() }))
vi.mock('../../src/utils/storage', () => ({ getStorageManager: () => ({}) }))

it('collects patch references only for CN while preserving other server updates', async () => {
  const manager = { getLatestVersion: vi.fn(async () => 'old') } as unknown as StorageManager
  const versions = await checkAndUpdateVersions(manager, false)
  expect(Object.keys(versions)).toEqual(['sdo', 'squareEnix', 'actoz', 'userjoy'])
  expect(vi.mocked(updateCommand).mock.calls.map(([options]) => [options.server, options.collectReferences])).toEqual([
    ['sdo', true], ['squareEnix', false], ['actoz', false], ['userjoy', false],
  ])
})

it('bootstraps only CN references before incremental UI extraction', async () => {
  await processAssets({ sdo: 'cn-version', squareEnix: 'global-version', actoz: 'kr-version' })
  expect(collectStoredAssetReferences).toHaveBeenCalledExactlyOnceWith('sdo', 'cn-version', {})
  expect(extractUiPatchIcons).toHaveBeenCalledExactlyOnceWith({ server: 'sdo', storage: 'minio' })
  expect(vi.mocked(collectStoredAssetReferences).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(extractUiPatchIcons).mock.invocationCallOrder[0])
})
