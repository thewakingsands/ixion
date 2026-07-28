import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  EXDSchemaDefinitionProvider,
  loadAllEXDSchema,
} from '../../src/schema/exd-schema'

const dir = join(__dirname, '../../../../lib/EXDSchema')

describe('loadAllEXDSchema', () => {
  it('should load all EXD schemas correctly', async () => {
    const schema = await loadAllEXDSchema(dir)
    expect(schema).toBeDefined()
  })
})

const fixtureFile = join(__dirname, '../__fixtures__/saintcoinach.json')
const exhFixtureFile = join(__dirname, '../__fixtures__/exh.json')
const isLinkRegex = /^[A-Z]/
describe.runIf(existsSync(fixtureFile) && existsSync(exhFixtureFile))(
  'generate table headers',
  () => {
    const exhFixture = JSON.parse(readFileSync(exhFixtureFile, 'utf-8'))
    const fixture = JSON.parse(readFileSync(fixtureFile, 'utf-8'))

    for (const [sheet, data] of Object.entries(fixture)) {
      it(`should generate table headers for ${sheet}`, async () => {
        const provider = new EXDSchemaDefinitionProvider(dir)
        const flatFields = await provider.getFlatFields(
          sheet,
          exhFixture[sheet],
        )
        expect(flatFields).toBeDefined()

        const { header, type } = data as { header: string; type: string }
        const length = header.split(',').length
        if (flatFields.length < length) {
          // fill up the missing fields with empty name
          for (let i = flatFields.length; i < length; i++) {
            flatFields.push({ index: i, name: '' })
          }
        } else if (flatFields.length > length) {
          flatFields.length = length
        }

        expect(
          flatFields
            .map((field) => field.name)
            .join(',')
            .replace(/Unknown_?\d+/g, ''),
        ).toEqual(header.replace(/[{}[\]<>]/g, ''))
        expect(flatFields.map((field) => field.link || '').join(',')).toEqual(
          type
            .split(',')
            .map((t) => (isLinkRegex.test(t) ? t : ''))
            .join(','),
        )
      })
    }
  },
)
