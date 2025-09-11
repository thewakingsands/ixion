import { Command } from 'commander'
import { registerPatchCommand } from './commands/patch'
import { registerRecordCommand } from './commands/record'
import { registerStorageCommand } from './commands/storage'
import { registerUpdateCommand } from './commands/update'

const program = new Command()

program.name('ixion').description('CLI to FFXIV Patches').version('0.8.0')

registerPatchCommand(program)
registerRecordCommand(program)
registerStorageCommand(program)
registerUpdateCommand(program)

program.parse()
