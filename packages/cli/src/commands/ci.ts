import type { Command } from 'commander'
import { ciInitCommand, ciUpdateCommand } from '../actions/ci'

export const registerCiCommand = (program: Command) => {
  const ciCmd = program.command('ci').description('Run CI actions')

  ciCmd
    .command('init')
    .description('Initialize CI configuration')
    .action(ciInitCommand)

  ciCmd
    .command('update')
    .description('Update game to the latest version')
    .option('-s, --skip-update', 'Skip update')
    .action(async (options: { skipUpdate: boolean }) => {
      return ciUpdateCommand(options.skipUpdate)
    })

  return ciCmd
}
