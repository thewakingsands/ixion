import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  type ExlFile,
  readExlFile,
  writeExlFile,
} from '../../../src/structs/excel/exl'

describe('Excel EXL File Structs', () => {
  const fixtureBuffer = readFileSync(
    join(__dirname, '../../__fixtures__/root.exl'),
  )

  let exlFile: ExlFile

  describe('ExlFile', () => {
    it('should read EXL file correctly', () => {
      exlFile = readExlFile(fixtureBuffer)

      expect(exlFile.magic).toBe('EXLT')
      expect(exlFile.version).toBe(2)
      expect(exlFile.entries).toHaveLength(7549)
      expect(exlFile.entries[0]).toEqual({ name: 'Achievement', id: 209 })
    })

    it('should write EXL file correctly', () => {
      const buffer = writeExlFile(exlFile)
      expect(buffer.toString('utf8')).toEqual(fixtureBuffer.toString('utf8'))
    })

    it('should write EXL file with empty entries', () => {
      const exlFile: ExlFile = {
        magic: 'EXLT',
        version: 1,
        entries: [],
      }

      const buffer = writeExlFile(exlFile)
      const content = buffer.toString('utf8')

      const expectedLines = ['EXLT,1', '']

      expect(content).toBe(expectedLines.join('\r\n'))
    })

    it('should round-trip read and write correctly', () => {
      const originalExlFile: ExlFile = {
        magic: 'EXLT',
        version: 2,
        entries: [
          { name: 'TestItem', id: 123 },
          { name: 'AnotherItem', id: 456 },
          { name: 'Special_Item-Name', id: 789 },
        ],
      }

      // Write EXL file
      const buffer = writeExlFile(originalExlFile)

      // Read EXL file back
      const readExlFileResult = readExlFile(buffer)

      expect(readExlFileResult.magic).toBe(originalExlFile.magic)
      expect(readExlFileResult.version).toBe(originalExlFile.version)
      expect(readExlFileResult.entries).toEqual(originalExlFile.entries)
    })
  })
})
