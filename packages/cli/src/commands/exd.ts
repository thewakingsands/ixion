import type { Command } from 'commander'
import { extractExdFiles } from '../actions/exd-extract'
import { readExdFileList } from '../actions/exd-list'

/**
 * Create filter function
 */
function createFilter(
  keywords?: string[],
  rootOnly?: boolean,
): (path: string) => boolean {
  return (path: string) => {
    if (rootOnly && path.includes('/')) {
      return false
    }

    if (keywords && keywords.length > 0) {
      const lowerPath = path.toLowerCase()
      return keywords.some((keyword) =>
        lowerPath.includes(keyword.toLowerCase()),
      )
    }

    return true
  }
}

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
    .option(
      '--root-only',
      'Only show files in the exd/ directory, ignore subdirectories',
    )
    .option(
      '-n, --name <keywords...>',
      'Filter files by name keywords (case-insensitive)',
    )
    .action(
      async (
        version: string,
        options: {
          server: string
          rootOnly?: boolean
          name?: string[]
        },
      ) => {
        const filter = createFilter(options.name, options.rootOnly)
        const foundExdFiles = await readExdFileList(
          options.server,
          version,
          filter,
        )

        let filterDescription = ''
        if (options.rootOnly && options.name && options.name.length > 0) {
          filterDescription = ` (root-only + name: ${options.name.join(', ')})`
        } else if (options.rootOnly) {
          filterDescription = ' (root-only)'
        } else if (options.name && options.name.length > 0) {
          filterDescription = ` (name: ${options.name.join(', ')})`
        }

        console.log(
          `📋 Found ${foundExdFiles.length} EXD files${filterDescription}:`,
        )

        if (foundExdFiles.length === 0) {
          console.log('  No EXD files found matching the criteria')
        } else {
          foundExdFiles.sort().forEach((file) => {
            console.log(`  - ${file}`)
          })
        }
      },
    )

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
    .option(
      '--root-only',
      'Only extract files in the exd/ directory, ignore subdirectories',
    )
    .option(
      '-n, --name <keywords...>',
      'Filter files by name keywords (case-insensitive)',
    )
    .action(
      async (
        version: string,
        outputDir: string,
        options: {
          server: string
          rootOnly?: boolean
          name?: string[]
        },
      ) => {
        const filter = createFilter(options.name, options.rootOnly)

        let filterDescription = ''
        if (options.rootOnly && options.name && options.name.length > 0) {
          filterDescription = ` (root-only + name: ${options.name.join(', ')})`
        } else if (options.rootOnly) {
          filterDescription = ' (root-only)'
        } else if (options.name && options.name.length > 0) {
          filterDescription = ` (name: ${options.name.join(', ')})`
        }

        console.log(`🔍 Extracting EXD files${filterDescription}...`)
        await extractExdFiles(options.server, version, outputDir, filter)
      },
    )

  return exdCmd
}
