import {
  EXDSchemaDefinitionProvider,
  SaintcoinachDefinitionProvider,
} from '@ffcafe/ixion-exd'
import { describe, expect, it } from 'vitest'
import { parseInputDefinitions } from '../../src/utils/input'

describe('parseInputDefinitions', () => {
  it('uses SaintCoinach definitions by default', () => {
    expect(parseInputDefinitions()).toBeInstanceOf(
      SaintcoinachDefinitionProvider,
    )
  })

  it('uses an explicit SaintCoinach definition directory', () => {
    expect(parseInputDefinitions('saintcoinach')).toBeInstanceOf(
      SaintcoinachDefinitionProvider,
    )
  })

  it('uses EXDSchema when its directory is provided', () => {
    expect(
      parseInputDefinitions(undefined, 'exd-schema'),
    ).toBeInstanceOf(EXDSchemaDefinitionProvider)
  })

  it('rejects ambiguous definition sources', () => {
    expect(() =>
      parseInputDefinitions('saintcoinach', 'exd-schema'),
    ).toThrow('--saintcoinach and --exd-schema are mutually exclusive')
  })
})
