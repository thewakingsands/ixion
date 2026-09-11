import { EXDWriter, ExcelColumnDataType, ExcelVariant, type ExhHeader, writeExhHeader } from '@ffcafe/ixion-sqpack'
import { expect, it } from 'vitest'
import { collectFateLocations, fateMapCoordinates } from '../../src/actions/fate-export'

function input() {
  const files = new Map<string, Buffer>()
  const names: Record<string, string[]> = {}
  const sheet = (name: string, fields: string[], rows: { rowId: number; data: (number | Buffer)[] }[]) => {
    names[name] = fields
    const header: ExhHeader = {
      magic: 'EXHF', version: 3, dataOffset: fields.length * 4, columnCount: fields.length,
      pageCount: 1, languageCount: 1, unknown1: 0, u2: 0, variant: ExcelVariant.Default,
      u3: 0, rowCount: rows.length, u4: 0, u5: 0,
      columns: fields.map((_, i) => ({ offset: i * 4, type: Buffer.isBuffer(rows[0].data[i]) ? ExcelColumnDataType.String : ExcelColumnDataType.Int32 })),
      paginations: [{ startId: 0, rowCount: rows.length }], languages: [0],
    }
    files.set(`exd/${name}.exh`, writeExhHeader(header))
    const writer = new EXDWriter(header)
    writer.writeRows(rows)
    files.set(`exd/${name}_0.exd`, writer.output())
  }
  // Shared locations must match all FATE rows, not only the first one.
  sheet('Fate', ['Location'], [{ rowId: 1, data: [123] }, { rowId: 2, data: [123] }, { rowId: 3, data: [999] }, { rowId: 4, data: [0] }])
  sheet('TerritoryType', ['Bg', 'Map'], [{ rowId: 100, data: [Buffer.from('ffxiv/test/level/test.lvb'), 10] }])
  sheet('Map', ['SizeFactor', 'Offset{X}', 'Offset{Y}', 'PlaceName'], [{ rowId: 10, data: [100, 0, 0, 77] }])
  const data = Buffer.alloc(144)
  data.write('LGB1')
  data.writeInt32LE(144, 4)
  data.writeInt32LE(1, 8)
  data.write('LGP1', 12)
  data.writeInt32LE(24, 16)
  data.writeInt32LE(16, 28)
  data.writeInt32LE(1, 32)
  data.writeInt32LE(4, 36)
  data.writeInt32LE(11, 40)
  data.writeInt32LE(52, 48)
  data.writeInt32LE(1, 52)
  data.writeInt32LE(4, 92)
  data.writeInt32LE(49, 96)
  data.writeInt32LE(123, 100)
  data.writeFloatLE(123.5, 112)
  files.set('bg/ffxiv/test/level/planevent.lgb', data)
  return {
    files,
    reader: { readFile: async (path: string) => files.get(path) ?? null },
    definitions: { getFlatFields: async (sheet: string) => names[sheet].map((name, index) => ({ name, index })) },
  }
}

it('joins local EXD and LGB resources and reports missing/unmatched data', async () => {
  const { reader, definitions } = input()
  const result = await collectFateLocations(reader, definitions)
  expect(result.locations.map((entry) => entry.fateId)).toEqual([1, 2])
  expect(result.locations[0]).toMatchObject({ location: 123, territoryId: 100, layerId: 11, position: { map: 10, zoneid: 77, x: 21.5, y: 21.5, z: 1.23 } })
  expect(result.unmatchedFateIds).toEqual([3])
  expect(result.missingLgbFiles).toHaveLength(3)
})

it('finds placements stored only in planlive.lgb', async () => {
  const { reader, definitions, files } = input()
  const path = 'bg/ffxiv/test/level/planevent.lgb'
  const data = Buffer.from(files.get(path)!)
  data.writeInt32LE(999, 100)
  data.writeFloatLE(-411.18780517578125, 108)
  data.writeFloatLE(43.50844955444336, 112)
  data.writeFloatLE(320.8276062011719, 116)
  files.set('bg/ffxiv/test/level/planlive.lgb', data)
  const result = await collectFateLocations(reader, definitions)
  expect(result.locations.find((entry) => entry.fateId === 3)).toMatchObject({
    location: 999,
    lgbPath: 'bg/ffxiv/test/level/planlive.lgb',
    world: { x: -411.18780517578125, y: 43.50844955444336, z: 320.8276062011719 },
  })
  expect(result.unmatchedFateIds).toEqual([])
})

it('fails on missing required EXD data instead of returning a partial export', async () => {
  const { reader, definitions, files } = input()
  files.delete('exd/Fate_0.exd')
  await expect(collectFateLocations(reader, definitions)).rejects.toThrow('Missing game resource')
})

it('rejects incompatible definitions', async () => {
  const { reader } = input()
  await expect(collectFateLocations(reader, { getFlatFields: async () => [] })).rejects.toThrow('Fate.Location')
})

it('converts world X/Z, applies offsets and scale, and floors negative altitude', () => {
  expect(fateMapCoordinates({ x: 1024, y: -1.2, z: -1024 }, 200, -1024, 1024)).toEqual({ x: 11.25, y: 11.25, z: -0.02 })
  expect(() => fateMapCoordinates({ x: 0, y: 0, z: 0 }, 0, 0, 0)).toThrow()
})
