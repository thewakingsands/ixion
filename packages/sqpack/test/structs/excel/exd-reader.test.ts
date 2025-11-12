import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXDReader } from '../../../src/structs/excel/exd-reader'
import { readExhHeader } from '../../../src/structs/excel/exh'

const createReader = (sheetName: string) => {
  const fixtureBuffer = readFileSync(
    join(__dirname, `../../__fixtures__/${sheetName}_0.exd`),
  )
  const fixtureExhBuffer = readFileSync(
    join(__dirname, `../../__fixtures__/${sheetName}.exh`),
  )

  return new EXDReader(fixtureBuffer, readExhHeader(fixtureExhBuffer))
}

describe('variant=1, Default', () => {
  const reader = createReader('AchievementCategory')

  it('should read row correctly', () => {
    expect(reader.readRow(0)).toEqual(['', 0, true, false, 0])
    expect(reader.readRow(1)).toEqual(['整体', 1, true, false, 1])
    expect(reader.readRow(8)).toEqual(['排名', 2, true, true, 2])
  })

  it('should list row ids correctly', () => {
    expect(reader.listRowIds()).toHaveLength(83)
  })
})

describe('variant=2, Subrows', () => {
  const reader = createReader('TreasureSpot')

  it('should read row correctly', () => {
    expect(reader.readSubrow(0, 0)).toEqual([0, 0, 0])
    expect(reader.readSubrow(1, 0)).toEqual([4512071, 0, 0])
    expect(reader.readSubrow(2, 19)).toEqual([4520515, 0, 0])
  })

  it('should list row ids correctly', () => {
    expect(reader.listRowIds()).toHaveLength(31)
  })

  it('should get sub row count correctly', () => {
    expect(reader.getSubRowCount(0)).toBe(1)
    expect(reader.getSubRowCount(1)).toBe(45)
    expect(reader.getSubRowCount(2)).toBe(45)
  })
})
