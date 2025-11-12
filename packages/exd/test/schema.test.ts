import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadEXDSchema } from '../src/schema'

describe('loadEXDSchema', () => {
  it('should load EXD schema correctly', async () => {
    const schema = await loadEXDSchema(
      join(__dirname, '../../../lib/EXDSchema'),
    )
    expect(schema).toBeDefined()
  })
})
