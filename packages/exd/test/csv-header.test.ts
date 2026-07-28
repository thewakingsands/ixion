import { ExcelColumnDataType } from '@ffcafe/ixion-sqpack'
import { describe, expect, it } from 'vitest'
import { CSVExporter } from '../src/csv'

const definitions = {
  async getFlatFields() {
    return [
      { index: 0, name: 'Name' },
      { index: 1, name: 'Icon', link: 'Image' },
    ]
  },
}

const columns = [
  { type: ExcelColumnDataType.String, offset: 0 },
  { type: ExcelColumnDataType.UInt32, offset: 4 },
]

describe('CSVExporter headers', () => {
  it('includes the key index line by default', async () => {
    const exporter = new CSVExporter({ definitions })

    await expect(exporter.formatHeader('Example', columns)).resolves.toEqual([
      'key,0,1',
      '#,Name,Icon',
      'int32,str,Image',
    ])
  })

  it('can skip the key index line', async () => {
    const exporter = new CSVExporter({
      definitions,
      skipFirstLine: true,
    })

    await expect(exporter.formatHeader('Example', columns)).resolves.toEqual([
      '#,Name,Icon',
      'int32,str,Image',
    ])
  })
})
