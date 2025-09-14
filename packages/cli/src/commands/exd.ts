import type { Command } from 'commander'
import { extractExdFiles } from '../actions/exd-extract'
import { readExdFileList } from '../actions/exd-list'

export function registerExdCommand(program: Command) {
  const exdCmd = program
    .command('exd')
    .description('Manage EXD (Excel Data) files')

  exdCmd
    .command('list')
    .description('List EXD files in a specified version')
    .argument('<version>', 'Version to list EXD files from')
    .option(
      '-s, --server <name>',
      'Server name for storage operations',
      'default',
    )
    .action(async (version: string, options: { server: string }) => {
      const foundExdFiles = await readExdFileList(options.server, version)
      console.log(`📋 Found ${foundExdFiles.length} EXD files:`)

      if (foundExdFiles.length === 0) {
        console.log('  No EXD files found')
      } else {
        foundExdFiles.sort().forEach((file) => {
          console.log(`  - ${file}`)
        })
      }
    })

  exdCmd
    .command('extract')
    .description('Extract EXD files to a directory')
    .argument('<version>', 'Version to extract EXD files from')
    .argument('<output-dir>', 'Output directory for extracted files')
    .option(
      '-s, --server <name>',
      'Server name for storage operations',
      'default',
    )
    .action(
      async (
        version: string,
        outputDir: string,
        options: { server: string },
      ) => {
        await extractExdFiles(options.server, version, outputDir)
      },
    )

  return exdCmd
}
