import { servers } from '@ffcafe/ixion-server'
import type { Command } from 'commander'
import { getStorageManager } from '../utils/storage.js'

export const registerStorageCommand = (program: Command) => {
  const storageCmd = program
    .command('storage')
    .description('Manage storage configurations')

  storageCmd
    .command('list')
    .description('List all configured storages')
    .action(async () => {
      try {
        const storageManager = getStorageManager()
        const storages = storageManager.getAllStorages()

        console.log('📦 Configured storages:')
        for (const storage of storages) {
          const health = await storage.healthCheck()
          const status = health ? '✅' : '❌'
          console.log(`  ${status} ${storage.getName()} (${storage.getType()})`)
        }
      } catch (error) {
        console.error('❌ Failed to list storages:', error)
        process.exit(1)
      }
    })

  storageCmd
    .command('health')
    .description('Check health of all storages')
    .action(async () => {
      try {
        const storageManager = getStorageManager()
        const healthResults = await storageManager.healthCheck()

        console.log('🏥 Storage health check:')
        for (const [name, isHealthy] of Object.entries(healthResults)) {
          const status = isHealthy ? '✅' : '❌'
          console.log(`  ${status} ${name}`)
        }
      } catch (error) {
        console.error('❌ Failed to check storage health:', error)
        process.exit(1)
      }
    })

  storageCmd
    .command('versions')
    .description('List all available versions across all storages')
    .option(
      '-s, --server <name>',
      'Server name to list versions for',
      'default',
    )
    .option('-a, --all-servers', 'List versions for all servers')
    .action(async (options: { server: string; allServers?: boolean }) => {
      try {
        const storageManager = getStorageManager()

        if (options.allServers) {
          // List versions for all servers
          const serverKeys = Object.keys(servers)
          console.log('📋 Available versions across all servers:')

          for (const server of serverKeys) {
            try {
              const versions = await storageManager.listVersions(server)
              if (versions.length > 0) {
                console.log(`\n${server}:`)
                versions.forEach((version) => {
                  console.log(`  - ${version}`)
                })
              }
            } catch (error) {
              console.log(`\n${server}: (error: ${error})`)
            }
          }
        } else {
          // List versions for specific server
          const versions = await storageManager.listVersions(options.server)

          console.log(`📋 Available versions for server '${options.server}':`)
          if (versions.length === 0) {
            console.log('  No versions found')
          } else {
            versions.forEach((version) => {
              console.log(`  - ${version}`)
            })
          }
        }
      } catch (error) {
        console.error('❌ Failed to list versions:', error)
        process.exit(1)
      }
    })

  storageCmd
    .command('sync')
    .description('Sync versions between storages')
    .option('-s, --source <name>', 'Source storage name')
    .option('-t, --target <name>', 'Target storage name')
    .option('-a, --all', 'Sync all storages bidirectionally')
    .option('--server <name>', 'Server name for sync operations', 'default')
    .option('--from <version>', 'Sync versions from this version onwards')
    .option('--to <version>', 'Sync versions up to this version')
    .action(
      async (options: {
        source?: string
        target?: string
        all?: boolean
        server: string
        from?: string
        to?: string
      }) => {
        try {
          const storageManager = getStorageManager()
          const storageNames = storageManager.getStorageNames()

          if (options.all) {
            // Sync all storages bidirectionally
            console.log(
              `🔄 Syncing all storages bidirectionally for server '${options.server}'...`,
            )
            const results = await storageManager.syncAllVersions(options.server)

            console.log('\n📊 Sync Summary:')
            for (const [syncKey, result] of Object.entries(results)) {
              console.log(`\n${syncKey}:`)
              console.log(`  ✅ Synced: ${result.synced.length}`)
              console.log(`  ⏭️  Skipped: ${result.skipped.length}`)
              console.log(`  ❌ Errors: ${result.errors.length}`)

              if (result.errors.length > 0) {
                result.errors.forEach((error) => {
                  console.log(`    - ${error}`)
                })
              }
            }
          } else if (options.source && options.target) {
            // Sync from specific source to target
            if (!storageNames.includes(options.source)) {
              console.error(`❌ Source storage '${options.source}' not found`)
              console.log(`Available storages: ${storageNames.join(', ')}`)
              process.exit(1)
            }

            if (!storageNames.includes(options.target)) {
              console.error(`❌ Target storage '${options.target}' not found`)
              console.log(`Available storages: ${storageNames.join(', ')}`)
              process.exit(1)
            }

            // Create version filter if from/to options provided
            let versionFilter: ((version: string) => boolean) | undefined
            if (options.from || options.to) {
              versionFilter = (version: string) => {
                if (options.from && version < options.from) return false
                if (options.to && version > options.to) return false
                return true
              }
            }

            console.log(
              `🔄 Syncing from '${options.source}' to '${options.target}' for server '${options.server}'...`,
            )
            const result = await storageManager.syncVersions(
              options.server,
              options.source,
              options.target,
              versionFilter,
            )

            console.log('\n📊 Sync Summary:')
            console.log(`✅ Synced: ${result.synced.length}`)
            console.log(`⏭️  Skipped: ${result.skipped.length}`)
            console.log(`❌ Errors: ${result.errors.length}`)

            if (result.synced.length > 0) {
              console.log('\nSynced versions:')
              result.synced.forEach((version) => {
                console.log(`  - ${version}`)
              })
            }

            if (result.errors.length > 0) {
              console.log('\nErrors:')
              result.errors.forEach((error) => {
                console.log(`  - ${error}`)
              })
            }
          } else {
            console.error(
              '❌ Please specify either --all or both --source and --target',
            )
            console.log('Available storages:', storageNames.join(', '))
            process.exit(1)
          }
        } catch (error) {
          console.error('❌ Failed to sync versions:', error)
          process.exit(1)
        }
      },
    )

  return storageCmd
}
