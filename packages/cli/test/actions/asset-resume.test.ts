import { expect, it, vi } from 'vitest'
import { extractUiPatchIcons } from '../../src/actions/asset-ui-icons'

const mocks = vi.hoisted(() => ({
  state: new Map(),
  index: new Map(),
  references: { icons: [51474], maps: ['s1d1/00'] },
  loadState: vi.fn(), writeAssetState: vi.fn(), writePatchJson: vi.fn(), processTextures: vi.fn(async () => ({ added: [{}], removed: [], edited: [], unreferenced: [] })),
}))
vi.mock('../../src/actions/asset/storage', () => ({ AssetStorage: class {
  fs = { loadState: mocks.loadState }
  loadCurrentReference = async () => ({ ffxiv: 'current', lastValidIndex: 'current' })
  loadReferences = async () => mocks.references
  loadExistingAssets = async () => new Map()
  loadAssetState = async () => mocks.state
  getAssetFileList = () => []
  writeAssetState = mocks.writeAssetState
  writePatchJson = mocks.writePatchJson
} }))
vi.mock('../../src/actions/asset/ui-index', () => ({ validateIndexFile: async () => mocks.index }))
vi.mock('../../src/actions/asset/patch', () => ({ processTextures: mocks.processTextures }))
vi.mock('../../src/utils/server', () => ({ requestServerPatches: async () => ({ ffxivPatches: [] }) }))
vi.mock('../../src/utils/root', () => ({ getWorkingDir: () => '.' }))

it('processes newly collected references even when no UI patches are available', async () => {
  await extractUiPatchIcons({ server: 'sdo' })
  expect(mocks.loadState).toHaveBeenCalledOnce()
  expect(mocks.processTextures).toHaveBeenCalledWith(expect.objectContaining({ iconState: mocks.state, uiIndex: mocks.index }))
  expect(mocks.writeAssetState).toHaveBeenCalledWith('current', mocks.state)
  expect(mocks.writePatchJson).toHaveBeenCalledWith('current', 'asset-files.json', [])
})

it('can scan icons when no EXD asset references have been collected', async () => {
  mocks.references = { icons: [], maps: [] }
  await expect(extractUiPatchIcons({ server: 'sdo' })).resolves.toBeUndefined()
  expect(mocks.processTextures).toHaveBeenCalledWith(expect.objectContaining({ uiIndex: mocks.index }))
})
