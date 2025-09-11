import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parsePatchList } from '../../src/utils/parser'

describe('Patch List Parser', () => {
  const responseText = readFileSync(
    join(__dirname, '../__fixtures__/sdo.txt'),
    'utf-8',
  )

  it('should parse patch list from fixture data', () => {
    // Read fixture data

    // Parse the patch list
    const result = parsePatchList(responseText, 'c38effbc')

    // Verify patches are parsed correctly
    expect(result).toHaveLength(3) // Based on the fixture, there should be 3 patches

    // Test first patch entry
    const firstPatch = result[0]
    expect(firstPatch).toEqual({
      expansion: 'ffxiv',
      patchSize: 238985483,
      version: '2025.03.18.0000.0000',
      hash: {
        type: 'sha1',
        blockSize: 50000000,
        values: [
          '1e8beaf7a35635b6f2cb057a9917e5fa76dbe03a',
          '5cfc5a402a7f7729e08a05361642c8d34d48f160',
        ],
      },
      url: 'http://ff.autopatch.sdo.com/ff/game/c38effbc/D2025.03.18.0000.0000.patch',
      repository: 'c38effbc',
    })

    // Test second patch entry
    const secondPatch = result[1]
    expect(secondPatch).toEqual({
      expansion: 'ffxiv',
      patchSize: 52014741,
      version: '2025.04.11.0000.0001',
      hash: {
        type: 'sha1',
        blockSize: 50000000,
        values: [
          '17c585165289d444af9bfd9023ad718fd1cb8656',
          'c4ec304a2461084bd404874c39766898aea82dd3',
        ],
      },
      url: 'http://ff.autopatch.sdo.com/ff/game/c38effbc/D2025.04.11.0000.0001.patch',
      repository: 'c38effbc',
    })

    // Test third patch entry (expansion patch)
    const thirdPatch = result[2]
    expect(thirdPatch).toEqual({
      expansion: 'ex1',
      patchSize: 64112,
      version: '2024.10.30.0000.0000',
      hash: {
        type: 'sha1',
        blockSize: 50000000,
        values: ['bc66ea165c0bcf1ae3a64b83d7113f95a04c97ac'],
      },
      url: 'http://ff.autopatch.sdo.com/ff/game/ex1/77420d17/D2024.10.30.0000.0000.patch',
      repository: '77420d17',
    })

    // Verify all patches have required fields
    result.forEach((patch) => {
      expect(patch.patchSize).toBeGreaterThan(0)
      expect(patch.version).toBeTruthy()
      expect(patch.hash).toBeTruthy()
      expect(patch.hash?.type).toBe('sha1')
      expect(patch.hash?.values.length).toBeGreaterThan(0)
      expect(patch.url).toMatch(/^http:\/\/ff\.autopatch\.sdo\.com\/ff\/game\//)
      expect(patch.repository).toBeTruthy()
      expect(['ffxiv', 'ex1', 'ex2', 'ex3', 'ex4', 'ex5']).toContain(
        patch.expansion,
      )
    })
  })

  it('should handle empty response gracefully', () => {
    const result = parsePatchList('', 'c38effbc')
    expect(result).toHaveLength(0)
  })

  it('should extract repository from URL when available', () => {
    const responseText = `238985483	53562230308	71	12	2025.03.18.0000.0000	sha1	50000000	1e8beaf7a35635b6f2cb057a9917e5fa76dbe03a,5cfc5a402a7f7729e08a05361642c8d34d48f160	http://ff.autopatch.sdo.com/ff/game/abc123def/D2025.03.18.0000.0000.patch`

    const result = parsePatchList(responseText, 'default-repo')
    expect(result).toHaveLength(1)
    expect(result[0].repository).toBe('abc123def')
  })

  it('should use default repository when URL parsing fails', () => {
    const responseText = `238985483	53562230308	71	12	2025.03.18.0000.0000	sha1	50000000	1e8beaf7a35635b6f2cb057a9917e5fa76dbe03a,5cfc5a402a7f7729e08a05361642c8d34d48f160	http://invalid.url/patch.patch`

    const result = parsePatchList(responseText, 'fallback-repo')
    expect(result).toHaveLength(1)
    expect(result[0].repository).toBe('fallback-repo')
  })

  it('should parse expansion patches correctly', () => {
    const responseText = `238985483	53562230308	71	12	2025.03.18.0000.0000	sha1	50000000	1e8beaf7a35635b6f2cb057a9917e5fa76dbe03a,5cfc5a402a7f7729e08a05361642c8d34d48f160	http://ff.autopatch.sdo.com/ff/game/c38effbc/ex1/77420d17/D2024.10.30.0000.0000.patch`

    const result = parsePatchList(responseText, 'c38effbc')
    expect(result).toHaveLength(1)
    expect(result[0].expansion).toBe('ex1')
    expect(result[0].repository).toBe('77420d17')
  })

  it('should handle mixed patch types in fixture data', () => {
    const result = parsePatchList(responseText, 'c38effbc')

    // Should have 3 patches: 2 ffxiv patches and 1 ex1 patch
    expect(result).toHaveLength(3)

    // Check that we have the right mix of patch types
    const expansions = result.map((p) => p.expansion)
    expect(expansions).toEqual(['ffxiv', 'ffxiv', 'ex1'])

    // Check that repositories are correctly extracted
    const repositories = result.map((p) => p.repository)
    expect(repositories).toEqual(['c38effbc', 'c38effbc', '77420d17'])
  })
})
