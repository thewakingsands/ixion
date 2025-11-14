import type { Command } from 'commander'
import { ciUpdateCommand } from '../actions/ci'

export const registerCiCommand = (program: Command) => {
  const ciCmd = program.command('ci').description('Run CI actions')

  ciCmd
    .command('update')
    .description('Update game to the latest version')
    .action(ciUpdateCommand)

  return ciCmd
}
