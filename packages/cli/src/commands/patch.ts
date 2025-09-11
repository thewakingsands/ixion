import { StorageManager } from '@ffcafe/ixion-storage'
import type { Command } from 'commander'
import { createVersionFromPatches } from '../actions/create-version'
import { files } from '../config'
import { readConfig } from '../utils/config'

export function registerPatchCommand(program: Command) {
  program
    .command('patch')
    .description('Apply patches to create new version')
    .argument('<patches...>', 'Path to patch files')
    .option('-f, --from <version>', 'Base version to patch from')
    .option('-t, --to <version>', 'Target version name')
    .option('-s, --server <name>', 'Server name for storage operations')
    .option(
      '--include [files...]',
      'Include list patterns for extraction',
      files,
    )
    .action(
      async (
        patches: string[],
        options: {
          from?: string
          to?: string
          server: string
          include?: string[]
        },
      ) => {
        // Validate inputs
        if (!options.from) {
          throw new Error('Base version (--from) is required')
        }
        if (!options.to) {
          throw new Error('Target version (--to) is required')
        }

        // Create storage manager from config
        const config = readConfig()
        const storageManager = new StorageManager(config.storages)

        await createVersionFromPatches(storageManager, {
          server: options.server,
          from: options.from,
          to: options.to,
          patches,
        })
      },
    )
}
