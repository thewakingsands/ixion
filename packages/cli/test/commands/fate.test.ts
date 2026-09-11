import { EXDSchemaDefinitionProvider } from '@ffcafe/ixion-exd'
import { Command } from 'commander'
import { expect, it, vi } from 'vitest'
import { exportFateLocations } from '../../src/actions/fate-export'
import { registerFateCommand } from '../../src/commands/fate'

vi.mock('../../src/actions/fate-export', () => ({ exportFateLocations: vi.fn() }))

it('passes --exd-schema to the FATE exporter', async () => {
  vi.mocked(exportFateLocations).mockClear()
  const program = new Command()
  registerFateCommand(program)
  await program.parseAsync(['fate', 'export-locations', 'game', 'out.json', '--exd-schema', 'schemas'], { from: 'user' })
  expect(exportFateLocations).toHaveBeenCalledWith('game', 'out.json', expect.any(EXDSchemaDefinitionProvider))
})

it('rejects both definition options before exporting', async () => {
  vi.mocked(exportFateLocations).mockClear()
  const program = new Command()
  registerFateCommand(program)
  await expect(program.parseAsync(['fate', 'export-locations', 'game', 'out.json', '--exd-schema', 'schemas', '--saintcoinach', 'definitions'], { from: 'user' })).rejects.toThrow('mutually exclusive')
  expect(exportFateLocations).not.toHaveBeenCalled()
})
