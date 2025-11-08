import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Command } from 'commander'
import {
  buildExdFiles,
  createExdFilter,
  type ServerVersion,
} from '../actions/exd-build'
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
        const { filter, description } = createExdFilter(
          options.name,
          options.rootOnly,
        )
        const foundExdFiles = await readExdFileList(
          options.server,
          version,
          filter,
        )

        console.log(`📋 Found ${foundExdFiles.length} EXD files${description}:`)

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
        const { filter, description } = createExdFilter(
          options.name,
          options.rootOnly,
        )

        console.log(`🔍 Extracting EXD files${description}...`)
        await extractExdFiles(options.server, version, outputDir, filter)
      },
    )

  exdCmd
    .command('build')
    .description('Build merged SqPack file from EXD files of different servers')
    .argument(
      '<output>',
      'Output directory for SqPack files (e.g., "merged-exd")',
    )
    .option(
      '-p, --prefix <prefix>',
      'Prefix for SqPack files (e.g., "merged-exd")',
      '0a0000.win32',
    )
    .option(
      '-m, --mapping <mappings...>',
      'Server:version mapping (e.g., "default:2024.01.01 actoz:2024.01.02")',
    )
    .option(
      '--root-only',
      'Only include files in the exd/ directory, ignore subdirectories',
    )
    .option(
      '-n, --name <keywords...>',
      'Filter files by name keywords (case-insensitive)',
    )
    .action(
      async (
        output: string,
        options: {
          prefix?: string
          mapping?: string[]
          rootOnly?: boolean
          name?: string[]
        },
      ) => {
        if (!options.mapping) {
          console.error('❌ mapping is required')
          console.log(
            'Example: -m sdo:2024.01.01.0000.0000 -m actoz:2024.01.02.0000.0000',
          )
          process.exit(1)
        }

        // Parse server:version mappings
        const serverVersions: ServerVersion[] = []
        const mappings = options.mapping

        for (const mapping of mappings) {
          const [server, version] = mapping.split(':')
          if (!server || !version) {
            console.error(`❌ Invalid server:version mapping: "${mapping}"`)
            console.log('Expected format: "server:version"')
            process.exit(1)
          }
          serverVersions.push({
            server: server.trim(),
            version: version.trim(),
          })
        }

        if (serverVersions.length === 0) {
          console.error('❌ No valid server:version mappings provided')
          process.exit(1)
        }

        const { filter, description } = createExdFilter(
          options.name,
          options.rootOnly,
        )

        console.log(`🔨 Building merged SqPack file${description}...`)
        console.log(`📋 Server versions:`)
        serverVersions.forEach(({ server, version }) => {
          console.log(`  - ${server}: ${version}`)
        })

        await mkdir(output, { recursive: true })
        const outputPrefix = join(output, options.prefix || '0a0000.win32')

        try {
          await buildExdFiles({
            serverVersions,
            outputPrefix,
            filter,
          })
        } catch (error) {
          console.error('❌ Failed to build merged SqPack:', error)
          process.exit(1)
        }
      },
    )
}
