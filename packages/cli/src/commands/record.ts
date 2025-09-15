import type { Command } from 'commander'
import { createVersionFromGame } from '../actions/create-version'

export function registerRecordCommand(program: Command) {
  program
    .command('record')
    .description('Record local game files to storage')
    .argument('<path>', 'path to `game` directory')
    .option(
      '-s, --server <name>',
      'Server name for storage operations',
      'default',
    )
    .option(
      '--storage <name>',
      'Target storage name (if not specified, uploads to all storages)',
    )
    .action(
      async (path: string, options: { server: string; storage?: string }) => {
        await createVersionFromGame(path, options.server, options.storage)
      },
    )
}
