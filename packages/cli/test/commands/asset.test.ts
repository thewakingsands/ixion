import { EXDSchemaDefinitionProvider } from '@ffcafe/ixion-exd'
import { Command } from 'commander'
import { expect, it, vi } from 'vitest'
import { extractLocalUiAssets } from '../../src/actions/asset-local'
import { syncUiAssetsToRemoteStorage } from '../../src/actions/asset-ui-icons'
import { registerAssetCommand } from '../../src/commands/asset'

vi.mock('../../src/actions/asset-local', () => ({ extractLocalUiAssets: vi.fn() }))
vi.mock('../../src/actions/asset-ui-icons', () => ({
  extractUiPatchIcons: vi.fn(), resolveSavedUiIconState: vi.fn(), syncUiAssetsToRemoteStorage: vi.fn(),
}))

it('extracts to configured storage with the default CN server and no output argument', async () => {
  const program = new Command()
  registerAssetCommand(program)
  await program.parseAsync(['asset', 'extract-local', 'game'], { from: 'user' })
  expect(extractLocalUiAssets).toHaveBeenLastCalledWith('game', expect.any(EXDSchemaDefinitionProvider), { server: 'sdo', references: undefined })
})

it('passes server and additional references to local extraction', async () => {
  const program = new Command()
  registerAssetCommand(program)
  await program.parseAsync(['asset', 'extract-local', 'game', '--server', 'global', '--references', 'refs.json'], { from: 'user' })
  expect(extractLocalUiAssets).toHaveBeenLastCalledWith('game', expect.any(EXDSchemaDefinitionProvider), { server: 'global', references: 'refs.json' })
})

it('rejects the obsolete output argument rather than ignoring it', async () => {
  vi.mocked(extractLocalUiAssets).mockClear()
  const program = new Command().exitOverride().configureOutput({ writeErr: () => {} })
  registerAssetCommand(program)
  await expect(program.parseAsync(['asset', 'extract-local', 'game', 'old-output'], { from: 'user' })).rejects.toThrow('too many arguments')
  expect(extractLocalUiAssets).not.toHaveBeenCalled()
})

it('passes the selected destination to the manual sync action', async () => {
  const program = new Command()
  registerAssetCommand(program)
  await program.parseAsync(['asset', 'ui-sync', '--storage', 'minio'], { from: 'user' })
  expect(syncUiAssetsToRemoteStorage).toHaveBeenLastCalledWith({ server: 'sdo', storage: 'minio' })
})

it('rejects the old sync command name', async () => {
  vi.mocked(syncUiAssetsToRemoteStorage).mockClear()
  const program = new Command().exitOverride().configureOutput({ writeErr: () => {} })
  registerAssetCommand(program)
  await expect(program.parseAsync(['asset', 'ui-icons-sync', '--storage', 'minio'], { from: 'user' })).rejects.toThrow('unknown command')
  expect(syncUiAssetsToRemoteStorage).not.toHaveBeenCalled()
})
