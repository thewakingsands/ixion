import type { Command } from 'commander'
import { ciCommand } from '../actions/ci'

export const registerCiCommand = (program: Command) => {
  const ciCmd = program
    .command('ci')
    .description('Run CI actions')
    .action(ciCommand)

  return ciCmd
}
