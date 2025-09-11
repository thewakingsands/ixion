import type { PatchEntry } from '@ffcafe/ixion-server'
import { describe, expect, it } from 'vitest'
import { getPatchFileName } from '../../../src/utils/download'

describe('getPatchFileName', () => {
  it('should return the correct filename', () => {
    const patch: PatchEntry = {
      patchSize: 1024,
      version: '2025.03.18.0000.0000',
      hash: null,
      repository: 'test',
      url: 'http://example.com/test.patch',
      expansion: 'ffxiv',
    }

    const fileName = getPatchFileName(patch)
    expect(fileName).toBe('test.patch')
  })

  it('should return the correct filename if the URL has no .patch extension', () => {
    const patch: PatchEntry = {
      patchSize: 1024,
      version: '2025.03.18.0000.0000',
      hash: null,
      repository: 'test',
      url: 'http://example.com/test',
      expansion: 'ffxiv',
    }

    const fileName = getPatchFileName(patch)
    expect(fileName).toBe('2025.03.18.0000.0000.patch')
  })
})
