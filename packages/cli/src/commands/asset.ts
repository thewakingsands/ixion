import { join } from 'node:path'
import type { Command } from 'commander'
import { extractLocalUiAssets } from '../actions/asset-local'
import {
  extractUiPatchIcons,
  resolveSavedUiIconState,
  syncUiAssetsToRemoteStorage,
} from '../actions/asset-ui-icons'
import { parseInputDefinitions } from '../utils/input'
import { getWorkingDir } from '../utils/root'

export function registerAssetCommand(program: Command) {
  const assetCmd = program
    .command('asset')
    .description('Build reusable asset outputs from patch data')

  assetCmd
    .command('ui-icons')
    .alias('ui')
    .description(
      'Extract all icon textures and EXD-referenced maps from base-game patches',
    )
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
    .command('ui-sync')
    .description('Sync local UI assets and metadata to a remote storage')
    .option('-s, --server <name>', 'Target server name', 'sdo')
    .requiredOption('--storage <name>', 'Remote storage name to sync to')
    .action(async (options) => {
      await syncUiAssetsToRemoteStorage(options)
    })

  assetCmd
    .command('ui-icons-state')
    .description(
      'Resolve all icons and EXD-referenced maps from saved patch state',
    )
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

  assetCmd
    .command('extract-local')
    .description(
      'Extract all icons and EXD-referenced maps into local storage, grouped by game version',
    )
    .argument('<game-path>', 'Game folder containing sqpack')
    .option('-s, --server <name>', 'Target server name', 'sdo')
    .option(
      '--references <file>',
      'Additional cumulative reference JSON to merge and update; storage references are always retained',
    )
    .option(
      '--exd-schema <dir>',
      'EXDSchema definitions (default: lib/EXDSchema)',
    )
    .option('--saintcoinach <dir>', 'SaintCoinach definitions')
    .action(
      async (
        gamePath: string,
        options: {
          server: string
          references?: string
          exdSchema?: string
          saintcoinach?: string
        },
      ) => {
        await extractLocalUiAssets(
          gamePath,
          parseInputDefinitions(
            options.saintcoinach,
            options.exdSchema ??
              (options.saintcoinach
                ? undefined
                : join(getWorkingDir(), 'lib/EXDSchema')),
          ),
          { server: options.server, references: options.references },
        )
      },
    )

  return assetCmd
}
