import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  EXDReader,
  type ExcelColumn,
  ExcelColumnDataType,
  type ExhHeader,
  getExdPath,
  type SqPackReader,
} from '@ffcafe/ixion-sqpack'
import { Language, languageToCodeMap } from '@ffcafe/ixion-utils'
import {
  generateFlatFields,
  loadSaintcoinachDefinition,
} from './schema/saintcoinach'
import { getSaintcoinachType } from './schema/utils'
import { formatSeString, parseSeString } from './sestring'
import {
  type ExdFilter,
  listExdSheetsFromReader,
  readExhHeaderFromReader,
} from './utils'

export enum ExdCSVFormat {
  /**
   * Only one language (rawexd)
   * output: `{sheet}.csv`
   */
  Single,
  /**
   * Sheets with strings will be output as separate files (allrawexd)
   * output: `{sheet}.{language}.csv`
   *
   * Sheets without strings will be output as a single file
   * output: `{sheet}.csv`
   */
  Multiple,
  /**
   * All languages will be merged into a single file
   * String columns will be renamed to `{column}_{language}`
   */
  Merged,
}

const csvName = (sheet: string, language?: Language) => {
  if (language) {
    return `${sheet}.${languageToCodeMap[language]}.csv`
  }
  return `${sheet}.csv`
}

interface CSVExporterOptions {
  definitionDir: string
  crlf?: boolean
}

const bom = Buffer.from([0xef, 0xbb, 0xbf])
export class CSVExporter {
  constructor(private readonly options: CSVExporterOptions) {}

  async formatHeader(sheet: string, columns: ExcelColumn[]): Promise<string[]> {
    const definition = await loadSaintcoinachDefinition(
      this.options.definitionDir,
      sheet,
    )

    const fields = generateFlatFields(definition)

    return [
      `key,${columns.map((_, index) => index).join(',')}`,
      `#,${columns.map((_, i) => fields[i]?.name || '').join(',')}`,
      `int32,${columns.map(({ type }, index) => fields[index]?.link || getSaintcoinachType(type)).join(',')}`,
    ]
  }

  formatData(id: string | number, data: any[]): string {
    return `${id},${data.map((value) => {
      if (typeof value === 'boolean') {
        return value ? 'True' : 'False'
      }

      if (typeof value === 'string') {
        return `"${value.replace(/"/g, '""')}"`
      }

      if (typeof value === 'number') {
        if (value % 1 === 0) {
          return value.toString()
        }

        return (+value.toPrecision(6)).toString().replace('e', 'E')
      }

      if (typeof value === 'bigint') {
        // convert to 4 int16
        const array: number[] = []
        for (let i = 0; i < 4; i++) {
          const val = Number(value & 0xffffn)
          array.push(val >= 0x8000 ? val - 0x10000 : val)
          value >>= 16n
        }
        return `"${array.join(', ')}"`
      }

      if (Buffer.isBuffer(value)) {
        try {
          const seString = parseSeString(value)
          return `"${formatSeString(seString).replace(/"/g, '""')}"`
        } catch (error) {
          const hex = value.toString('hex')
          console.warn(
            'Failed parsing hex',
            hex,
            'as SeString:',
            error instanceof Error ? error.message : error,
          )
          return `__HEX__${hex}`
        }
      }

      return value
    })}`
  }

  async export(
    readers: Array<{ languages: Language[]; reader: SqPackReader }>,
    format: ExdCSVFormat,
    outputDir: string,
    filter?: ExdFilter,
  ) {
    if (readers.length === 0) {
      throw new Error('No readers provided')
    }

    if (
      format === ExdCSVFormat.Single &&
      (readers.length !== 1 || readers[0].languages.length !== 1)
    ) {
      throw new Error('Single format requires exactly one language')
    }

    if (format === ExdCSVFormat.Merged) {
      throw new Error('Not implemented')
    }

    const {
      reader: primaryReader,
      languages: [primaryLanguage],
    } = readers[0]
    const sheets = await listExdSheetsFromReader(primaryReader)
    for (const sheet of sheets) {
      if (filter && !filter(sheet)) {
        continue
      }

      const primaryExh = await readExhHeaderFromReader(primaryReader, sheet)
      const isNoneLanguage =
        primaryExh.languages.length === 1 &&
        primaryExh.languages[0] === Language.None
      const hasStrings =
        !isNoneLanguage &&
        primaryExh.columns.some(
          (column) => column.type === ExcelColumnDataType.String,
        )

      if (!hasStrings || format === ExdCSVFormat.Single) {
        const csv = await this.exportSheet(
          primaryReader,
          sheet,
          primaryExh,
          isNoneLanguage ? Language.None : primaryLanguage,
        )
        this.writeFile(outputDir, sheet, Language.None, csv)
      } else {
        if (format === ExdCSVFormat.Multiple) {
          for (let i = 0; i < readers.length; i++) {
            const { reader, languages } = readers[i]
            const exh =
              i === 0
                ? primaryExh
                : await readExhHeaderFromReader(reader, sheet)
            for (const language of languages) {
              const csv = await this.exportSheet(reader, sheet, exh, language)
              this.writeFile(outputDir, sheet, language, csv)
            }
          }
        }

        // Merged format is not implemented yet
      }
    }
  }

  async exportSheet(
    reader: SqPackReader,
    sheet: string,
    exdHeader: ExhHeader,
    language: Language,
  ) {
    if (!exdHeader.languages.includes(language)) {
      throw new Error(
        `${sheet} has no ${language} language, available languages: ${exdHeader.languages.join(',')}`,
      )
    }

    const header = await this.formatHeader(sheet, exdHeader.columns)
    const lines: string[] = [...header]

    for (const pagination of exdHeader.paginations) {
      const exdFile = getExdPath(sheet, pagination.startId, language)
      const exdData = await reader.readFile(exdFile)
      if (!exdData) {
        throw new Error(`Failed to read ${exdFile}`)
      }
      const exdReader = new EXDReader(exdData, exdHeader)
      for (const rowId of exdReader.listRowIds()) {
        if (exdReader.isSubrows) {
          for (
            let index = 0;
            index < exdReader.getSubRowCount(rowId);
            index++
          ) {
            const { subRowId, data } = exdReader.readSubrow(rowId, index)
            try {
              lines.push(this.formatData(`${rowId}.${subRowId}`, data))
            } catch (error) {
              console.warn('Columns:', header)
              throw new Error(
                `Failed formatting ${sheet}#${rowId}.${subRowId}`,
                { cause: error },
              )
            }
          }
        } else {
          const row = exdReader.readRow(rowId)
          try {
            lines.push(this.formatData(rowId, row))
          } catch (error) {
            console.warn('Columns:', header)
            throw new Error(`Failed formatting ${sheet}#${rowId}`, {
              cause: error,
            })
          }
        }
      }
    }

    const separator = this.options.crlf ? '\r\n' : '\n'
    return `${lines.join(separator)}${separator}`
  }

  writeFile(
    dir: string,
    sheet: string,
    language: Language,
    csv: string,
    addBom = true,
  ) {
    const outputFile = join(dir, csvName(sheet, language))
    mkdirSync(dirname(outputFile), { recursive: true })
    writeFileSync(
      outputFile,
      addBom ? Buffer.concat([bom, Buffer.from(csv)]) : csv,
    )
  }
}
