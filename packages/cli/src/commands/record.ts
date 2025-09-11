import type { Command } from 'commander'
import { createVersionFromGame } from '../actions/create-version'

export function registerRecordCommand(program: Command) {
  program
    .command('record')
    .description('Record local game files')
    .argument('<path>', 'path to `game` directory')
    .action((path: string) => {
      createVersionFromGame(path)
    })
}
