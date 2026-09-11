import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { EXDSchemaDefinitionProvider } from '../../src/schema/exd-schema'

it('expands scalar, structured and nested arrays before mapping physical columns', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ixion-schema-'))
  try {
    await writeFile(join(dir, 'Fate.yml'), JSON.stringify({ name: 'Fate', fields: [
      { name: 'Text', type: 'array', count: 2 },
      { name: 'Icons', type: 'array', count: 2, fields: [{ name: 'Id' }, { name: 'Icon', type: 'icon' }] },
      { name: 'Nested', type: 'array', count: 2, fields: [{ type: 'array', count: 2, fields: [{ type: 'link', targets: ['Map'] }] }] },
      { name: 'Location' },
    ] }))
    const columns = Array.from({ length: 11 }, (_, index) => ({ type: 7, offset: (10 - index) * 4 }))
    const fields = await new EXDSchemaDefinitionProvider(dir).getFlatFields('Fate', columns)
    expect(fields.map((field) => field.name)).toEqual([
      'Location', 'Nested11', 'Nested10', 'Nested01', 'Nested00',
      'Icons1Icon', 'Icons1Id', 'Icons0Icon', 'Icons0Id', 'Text1', 'Text0',
    ])
    expect(fields.map((field) => field.index)).toEqual(columns.map((_, index) => index))
    expect(fields[1].link).toBe('Map')
    expect(fields[5].link).toBe('Image')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

it('locates Fate.Location after the actual EXDSchema arrays', async () => {
  const dir = join(__dirname, '../../../../lib/EXDSchema')
  const columns = Array.from({ length: 140 }, (_, index) => ({ type: 7, offset: index * 4 }))
  const fields = await new EXDSchemaDefinitionProvider(dir).getFlatFields('Fate', columns)
  expect(fields.findIndex((field) => field.name === 'Location')).toBe(81)
})
