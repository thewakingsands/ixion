import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXDReader } from '../../../src/structs/excel/exd-reader'
import { EXDWriter } from '../../../src/structs/excel/exd-writer'
import { readExhHeader } from '../../../src/structs/excel/exh'

const readExd = (sheetName: string) => {
  const fixtureBuffer = readFileSync(
    join(__dirname, `../../__fixtures__/${sheetName}_0.exd`),
  )
  const fixtureExhBuffer = readFileSync(
    join(__dirname, `../../__fixtures__/${sheetName}.exh`),
  )

  const exhHeader = readExhHeader(fixtureExhBuffer)
  const reader = new EXDReader(fixtureBuffer, exhHeader)
  return {
    buffer: fixtureBuffer,
    rows: reader.readRows(),
    exhHeader,
  }
}

describe('variant=1, Default', () => {
  const { rows, buffer, exhHeader } = readExd('AchievementCategory')

  it('should write EXD file correctly', () => {
    const writer = new EXDWriter(exhHeader)
    writer.writeRows(rows)

    const outputBuffer = writer.output()

    // read again
    const reader = new EXDReader(outputBuffer, exhHeader)
    const outputRows = reader.readRows()

    expect(outputRows).toEqual(rows)
    expect(outputBuffer).toEqual(buffer)
  })
})

describe('variant=2, Subrows', () => {
  const { rows, buffer, exhHeader } = readExd('TreasureSpot')

  it('should write EXD file correctly', () => {
    const writer = new EXDWriter(exhHeader)
    writer.writeRows(rows)

    const outputBuffer = writer.output()

    // read again
    const reader = new EXDReader(outputBuffer, exhHeader)
    const outputRows = reader.readRows()

    expect(outputRows).toEqual(rows)
    expect(outputBuffer).toEqual(buffer)
  })
})
