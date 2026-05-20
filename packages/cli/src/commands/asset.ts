import type { Command } from 'commander'
import {
  extractUiPatchIcons,
  resolveSavedUiIconState,
  syncUiAssetsToRemoteStorage,
} from '../actions/asset-ui-icons'

export function registerAssetCommand(program: Command) {
  const assetCmd = program
    .command('asset')
    .description('Build reusable asset outputs from patch data')

  assetCmd
    .command('ui-icons')
    .description('Extract changed UI icon textures from base-game patches')
    .option('-s, --server <name>', 'Target server name', 'sdo')
    .option(
      '--storage <name>',
      'Remote storage name used to read and sync UI asset state',
    )
    .option(
      '--limit <n>',
      'Only process the first n patches after the current reference',
      (value) => Number.parseInt(value, 10),
    )
    .action(async (options) => {
      await extractUiPatchIcons(options)
    })

  assetCmd
    .command('ui-icons-sync')
    .description('Sync local UI icon assets and metadata to a remote storage')
    .option('-s, --server <name>', 'Target server name', 'sdo')
    .requiredOption('--storage <name>', 'Remote storage name to sync to')
    .action(async (options) => {
      await syncUiAssetsToRemoteStorage(options)
    })

  assetCmd
    .command('ui-icons-state')
    .description('Resolve UI icon index data from saved patch state')
    .option('-s, --server <name>', 'Target server name', 'sdo')
    .option(
      '--storage <name>',
      'Remote storage name used to read UI asset state',
    )
    .option(
      '-o, --output <name>',
      'Output file label under the server asset directory',
      'saved-state',
    )
    .action(async (options) => {
      await resolveSavedUiIconState(options)
    })

  return assetCmd
}
