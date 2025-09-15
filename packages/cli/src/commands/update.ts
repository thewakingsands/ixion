import type { Command } from 'commander'
import { updateCommand } from '../actions/update'

export const registerUpdateCommand = (program: Command) => {
  const updateCmd = program
    .command('update')
    .description('Update FFXIV to the latest version')
    .option(
      '-f, --from <version>',
      'Manually specify the current FFXIV version to update from',
    )
    .option('--dry-run', 'Show what would be updated without actually updating')
    .option('-s, --server <name>', 'Target server name')
    .option(
      '--storage <name>',
      'Target specific storage (default: all storages)',
    )
    .action(updateCommand)

  return updateCmd
}
