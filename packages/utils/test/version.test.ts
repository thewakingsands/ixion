import { describe, expect, it } from 'vitest'
import { sortVersions } from '../src'

const versions = [
  'H2024.05.31.0000.0000aa',
  'H2024.05.31.0000.0000ae',
  'H2024.05.31.0000.0000a',
  'H2024.05.31.0000.0000z',
  '2025.10.30.0000.0000',
  '2025.10.28.0000.0000',
]

describe('sortVersions', () => {
  it('should sort versions correctly', () => {
    const sortedVersions = sortVersions(versions)
    expect(sortedVersions).toEqual([
      'H2024.05.31.0000.0000a',
      'H2024.05.31.0000.0000z',
      'H2024.05.31.0000.0000aa',
      'H2024.05.31.0000.0000ae',
      '2025.10.28.0000.0000',
      '2025.10.30.0000.0000',
    ])
  })
})
