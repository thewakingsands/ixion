import type { Command } from 'commander'
import { exportFateLocations } from '../actions/fate-export'
import { parseInputDefinitions } from '../utils/input'

export function registerFateCommand(program: Command) {
  program
    .command('fate')
    .description('Export local FATE data')
    .command('export-locations')
    .description(
      'Export FATE locations from a local game directory using territory default maps',
    )
    .argument('<game-path>', 'Path to the game folder containing sqpack')
    .argument('<output>', 'Output JSON file')
    .option(
      '--saintcoinach <dir>',
      'SaintCoinach definitions matching the game version',
    )
    .option(
      '--exd-schema <dir>',
      'EXDSchema definitions matching the game version',
    )
    .action(
      async (
        gamePath: string,
        output: string,
        options: { saintcoinach?: string; exdSchema?: string },
      ) => {
        await exportFateLocations(
          gamePath,
          output,
          parseInputDefinitions(options.saintcoinach, options.exdSchema),
        )
      },
    )
}
