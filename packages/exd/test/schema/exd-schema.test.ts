import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadAllEXDSchema } from '../../src/schema/exd-schema'

describe('loadAllEXDSchema', () => {
  it.skip('should load all EXD schemas correctly', async () => {
    const schema = await loadAllEXDSchema(
      join(__dirname, '../../../lib/EXDSchema'),
    )
    expect(schema).toBeDefined()
  })
})
