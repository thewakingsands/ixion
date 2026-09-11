import { join } from 'node:path'
import type { Command } from 'commander'
import { exportFateLocations } from '../actions/fate-export'
import { parseInputDefinitions } from '../utils/input'
import { getWorkingDir } from '../utils/root'

export function registerFateCommand(program: Command) {
  program
    .command('fate')
    .description('Export local FATE and DynamicEvent data')
    .command('export-locations')
    .description(
      'Export FATE and DynamicEvent locations from a local game directory using territory default maps',
    )
    .argument('<game-path>', 'Path to the game folder containing sqpack')
    .argument('<output>', 'Output JSON file')
    .option(
      '--saintcoinach <dir>',
      'SaintCoinach definitions matching the game version',
    )
    .option(
      '--exd-schema <dir>',
      'EXDSchema definitions matching the game version (default: lib/EXDSchema)',
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
          parseInputDefinitions(
            options.saintcoinach,
            options.exdSchema ??
              (options.saintcoinach
                ? undefined
                : join(getWorkingDir(), 'lib/EXDSchema')),
          ),
        )
      },
    )
}
