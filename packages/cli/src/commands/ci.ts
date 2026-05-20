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
    .option('-f, --force-release', 'Force release')
    .option(
      '--allow-missing-remote-version',
      'Allow CI to continue even when a remote version baseline is missing',
    )
    .action(
      async (options: {
        skipUpdate: boolean
        forceRelease: boolean
        allowMissingRemoteVersion: boolean
      }) => {
        return ciUpdateCommand({
          skipUpdate: options.skipUpdate,
          forceRelease: options.forceRelease,
          allowMissingRemoteVersion: options.allowMissingRemoteVersion,
        })
      },
    )

  return ciCmd
}
