import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createExdFilter, ExdCSVFormat } from '@ffcafe/ixion-exd'
import { servers } from '@ffcafe/ixion-server'
import { languageToCodeMap } from '@ffcafe/ixion-utils'
import type { Command } from 'commander'
import { parseServerVersions } from '../actions/exd-base'
import { buildExdFiles } from '../actions/exd-build'
import { exportExdFilesToCSV } from '../actions/exd-csv-export'
import { extractExdFiles } from '../actions/exd-extract'
import { readExdFileList } from '../actions/exd-list'
import { exportExdStrings } from '../actions/exd-strings-export'
import { verifyExdFilesFromStorage } from '../actions/exd-verify'
import { parseInputDefinitions, parseInputLanguages } from '../utils/input'
import { getServerLanguages } from '../utils/server'
import { getStorageManager } from '../utils/storage'

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
      'Server:version mapping (e.g., "-m actoz:2024.01.02.0000.0000"). Version is optional and will use the latest version if not provided.',
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
        const serverVersions = parseServerVersions(options.mapping)

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

  exdCmd
    .command('verify')
    .description('Verify EXD files from storage')
    .option(
      '-s, --server <name...>',
      'Server name to verify (can be repeated, or use --all-servers)',
    )
    .option('--all-servers', 'Verify all servers')
    .option(
      '--storage <name...>',
      'Storage name to verify (can be repeated, or use --all-storages)',
    )
    .option('--all-storages', 'Verify all storages')
    .option(
      '-v, --version <version...>',
      'Version to verify (can be repeated, or use --all-versions)',
    )
    .option('--all-versions', 'Verify all versions for each server')
    .action(
      async (options: {
        server?: string[]
        allServers?: boolean
        storage?: string[]
        allStorages?: boolean
        version?: string[]
        allVersions?: boolean
      }) => {
        try {
          // Storage verification mode
          const storageManager = getStorageManager()
          const allStorageNames = storageManager.getStorageNames()

          // Determine which storages to check
          let storagesToCheck: string[]
          if (options.allStorages) {
            storagesToCheck = allStorageNames
          } else if (options.storage && options.storage.length > 0) {
            storagesToCheck = options.storage
            // Validate storage names
            for (const storage of storagesToCheck) {
              if (!allStorageNames.includes(storage)) {
                console.error(`❌ Storage '${storage}' not found`)
                console.log(`Available storages: ${allStorageNames.join(', ')}`)
                process.exit(1)
              }
            }
          } else {
            storagesToCheck = allStorageNames
          }

          // Determine which servers to check
          let serversToCheck: string[]
          if (options.allServers) {
            serversToCheck = Object.keys(servers)
          } else if (options.server && options.server.length > 0) {
            serversToCheck = options.server
          } else {
            serversToCheck = ['default']
          }

          // Determine which versions to check
          let hasVersionFilter = false
          let versionsToCheck: string[] = []

          if (options.allVersions) {
            hasVersionFilter = true
            // Will be determined per server
          } else if (options.version && options.version.length > 0) {
            hasVersionFilter = true
            versionsToCheck = options.version
          }

          let totalChecked = 0
          let totalPassed = 0
          let totalFailed = 0

          // Verify each storage separately for better reporting
          for (const storageName of storagesToCheck) {
            const storageSubset = storageManager.createSubset([storageName])

            // Verify each server
            for (const server of serversToCheck) {
              console.log(
                `\n🔍 Verifying storage: ${storageName}, server: ${server}`,
              )

              // Get versions to check for this server
              let serverVersions: string[]
              if (hasVersionFilter) {
                if (options.allVersions) {
                  serverVersions = await storageSubset.listVersions(server)
                  if (serverVersions.length === 0) {
                    console.log(
                      `  ⚠️  No versions found for server '${server}' in storage '${storageName}'`,
                    )
                    continue
                  }
                } else {
                  serverVersions = versionsToCheck
                }
              } else {
                // If no version specified, check latest version
                const latestVersion =
                  await storageSubset.getLatestVersion(server)
                if (!latestVersion) {
                  console.log(
                    `  ⚠️  No versions found for server '${server}' in storage '${storageName}'`,
                  )
                  continue
                }
                serverVersions = [latestVersion]
              }

              // Verify each version
              for (const version of serverVersions) {
                totalChecked++
                console.log(
                  `  📦 Verifying ${storageName}:${server}:${version}...`,
                )

                try {
                  const result = await verifyExdFilesFromStorage(
                    storageSubset,
                    server,
                    version,
                  )

                  if (result.success) {
                    totalPassed++
                    console.log(`    ✅ All EXD files verified`)
                  } else {
                    totalFailed++
                    console.error(
                      `    ❌ Missing EXD files: ${result.missingFiles.join(', ')}`,
                    )
                  }
                } catch (error) {
                  totalFailed++
                  console.error(`    ❌ Verification failed: ${error}`)
                }
              }
            }
          }

          // Summary
          console.log(`\n📊 Verification Summary:`)
          console.log(`  Total checked: ${totalChecked}`)
          console.log(`  ✅ Passed: ${totalPassed}`)
          console.log(`  ❌ Failed: ${totalFailed}`)

          if (totalFailed > 0) {
            process.exit(1)
          }
        } catch (error) {
          console.error('❌ Verification failed:', error)
          process.exit(1)
        }
      },
    )

  exdCmd
    .command('export-csv')
    .description('Export EXD files to CSV format')
    .argument('<output-dir>', 'Output directory for CSV files')
    .option('-s, --server <name>', 'Server name for storage operations')
    .option('-v, --version <version>', 'Version to export from')
    .option(
      '--saintcoinach <dir>',
      'Directory containing SaintCoinach definitions',
    )
    .option('--exd-schema <dir>', 'Directory containing EXDSchema definitions')
    .option(
      '-l, --language <lang...>',
      'Languages to export (e.g., ja, en, chs)',
    )
    .option(
      '-f, --format <format>',
      'CSV format: single, multiple, or merged',
      'single',
    )
    .option('--crlf', 'Use CRLF line endings instead of LF', false)
    .option(
      '--root-only',
      'Only export files in the exd/ directory, ignore subdirectories',
    )
    .option(
      '-n, --name <keywords...>',
      'Filter files by name keywords (case-insensitive)',
    )
    .action(
      async (
        outputDir: string,
        options: {
          server?: string
          version?: string
          saintcoinach?: string
          language?: string[]
          format?: string
          crlf?: boolean
          rootOnly?: boolean
          name?: string[]
        },
      ) => {
        try {
          // Get definition directory
          const definitions = parseInputDefinitions(options.saintcoinach)

          const server = options.server
          if (!server) {
            console.error('❌ --server is required')
            process.exit(1)
          }

          // Parse languages
          const languages = parseInputLanguages(options.language)
          if (languages.length === 0) {
            languages.push(...getServerLanguages(server))
          }

          // Parse format
          const formatMap: Record<string, ExdCSVFormat> = {
            single: ExdCSVFormat.Single,
            multiple: ExdCSVFormat.Multiple,
            merged: ExdCSVFormat.Merged,
          }
          const format =
            formatMap[options.format?.toLowerCase() || 'single'] ||
            ExdCSVFormat.Single

          // Create filter
          const { filter, description } = createExdFilter(
            options.name,
            options.rootOnly,
          )

          console.log(`📊 Exporting EXD files${description}...`)
          console.log(`  Format: ${options.format || 'single'}`)
          console.log(
            `  Languages: ${languages.map((l) => languageToCodeMap[l]).join(', ')}`,
          )
          await exportExdFilesToCSV({
            server,
            version: options.version,
            outputDir,
            languages,
            format,
            definitions,
            crlf: options.crlf || false,
            filter,
          })
        } catch (error) {
          console.error('❌ CSV export failed:', error)
          process.exit(1)
        }
      },
    )

  exdCmd
    .command('export-strings')
    .description('Export EXD string fields to a JSON file')
    .argument('<output-dir>', 'Output directory for exported strings')
    .option(
      '-m, --mapping <mappings...>',
      'Server:version mapping (e.g., "-m actoz:2024.01.02.0000.0000"). Version is optional and will use the latest version if not provided.',
    )
    .option(
      '--root-only',
      'Only export files in the exd/ directory, ignore subdirectories',
    )
    .option(
      '-n, --name <keywords...>',
      'Filter files by name keywords (case-insensitive)',
    )
    .action(
      async (
        outputDir: string,
        options: {
          mapping?: string[]
          rootOnly?: boolean
          name?: string[]
        },
      ) => {
        try {
          // Parse server versions
          const serverVersions = parseServerVersions(options.mapping)

          // Create filter
          const { filter, description } = createExdFilter(
            options.name,
            options.rootOnly,
          )

          console.log(`📊 Exporting EXD strings${description}...`)
          await exportExdStrings({
            serverVersions,
            outputDir,
            filter,
          })
        } catch (error) {
          console.error('❌ String export failed:', error)
          process.exit(1)
        }
      },
    )
}
