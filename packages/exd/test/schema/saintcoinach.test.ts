import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  generateFlatFields,
  loadSaintcoinachDefinition,
} from '../../src/schema/saintcoinach'

const dir = join(
  __dirname,
  '../../../../lib/SaintCoinach/SaintCoinach/Definitions',
)
const fixtureFile = join(__dirname, '../__fixtures__/saintcoinach.json')

const isLinkRegex = /^[A-Z]/
describe.runIf(existsSync(fixtureFile))('generate table headers', () => {
  const fixture = JSON.parse(readFileSync(fixtureFile, 'utf-8'))

  for (const [sheet, data] of Object.entries(fixture)) {
    it(`should generate table headers for ${sheet}`, async () => {
      const schema = await loadSaintcoinachDefinition(dir, sheet)
      expect(schema).toBeDefined()

      const flatFields = generateFlatFields(schema)
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

      expect(flatFields.map((field) => field.name).join(',')).toEqual(header)
      expect(flatFields.map((field) => field.link || '').join(',')).toEqual(
        type
          .split(',')
          .map((t) => (isLinkRegex.test(t) ? t : ''))
          .join(','),
      )
    })
  }
})
