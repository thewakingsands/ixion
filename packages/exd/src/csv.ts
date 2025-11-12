import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  EXDReader,
  type ExcelColumn,
  ExcelColumnDataType,
  type ExhHeader,
  getExdPath,
  type SqPackReader,
} from '@ffcafe/ixion-sqpack'
import { Language, languageToCodeMap } from '@ffcafe/ixion-utils'
import { loadEXDSchema, type NamedFieldSchema } from './schema'
import { listExdSheetsFromReader, readExhHeaderFromReader } from './utils'

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

const typeMap: Record<ExcelColumnDataType, string> = {
  [ExcelColumnDataType.String]: 'str',
  [ExcelColumnDataType.Bool]: 'bool',
  [ExcelColumnDataType.Int8]: 'sbyte',
  [ExcelColumnDataType.UInt8]: 'byte',
  [ExcelColumnDataType.Int16]: 'int16',
  [ExcelColumnDataType.UInt16]: 'uint16',
  [ExcelColumnDataType.Int32]: 'int32',
  [ExcelColumnDataType.UInt32]: 'uint32',
  [ExcelColumnDataType.Unk]: 'unk',
  [ExcelColumnDataType.Int64]: 'int64',
  [ExcelColumnDataType.UInt64]: 'uint64',
  [ExcelColumnDataType.Unk2]: 'unk',
  [ExcelColumnDataType.Float32]: 'single',
  [ExcelColumnDataType.PackedBool0]: 'bit&01',
  [ExcelColumnDataType.PackedBool1]: 'bit&02',
  [ExcelColumnDataType.PackedBool2]: 'bit&04',
  [ExcelColumnDataType.PackedBool3]: 'bit&08',
  [ExcelColumnDataType.PackedBool4]: 'bit&10',
  [ExcelColumnDataType.PackedBool5]: 'bit&20',
  [ExcelColumnDataType.PackedBool6]: 'bit&40',
  [ExcelColumnDataType.PackedBool7]: 'bit&80',
}

interface FormattedColumn {
  index: number
  name: string
  type: ExcelColumnDataType
  typeString: string
}

export class CSVExporter {
  private schemas: Record<string, NamedFieldSchema[]> = {}

  async init() {
    this.schemas = await loadEXDSchema(
      join(__dirname, '../../../lib/EXDSchema'),
    )
  }

  formatColumns(sheet: string, columns: ExcelColumn[]): FormattedColumn[] {
    const schema = this.schemas[sheet]
    return columns.map(({ type }, index) => {
      const result = { index, name: '', type, typeString: typeMap[type] }
      if (schema) {
        const field = schema[index]
        if (field) {
          result.name = field.name
        }
      }

      return result
    })
  }

  formatData(
    id: string | number,
    columns: FormattedColumn[],
    data: any[],
  ): string {
    return `${id},${columns.map((column, i) => {
      const value = data[i]
      if (typeof value === 'boolean') {
        return value ? 'True' : 'False'
      }

      return value
    })}`
  }

  async export(
    readers: Array<{ languages: Language[]; reader: SqPackReader }>,
    format: ExdCSVFormat,
    outputDir: string,
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
      const primaryExh = await readExhHeaderFromReader(primaryReader, sheet)
      const isNoneLanguage =
        primaryExh.languages.length === 1 &&
        primaryExh.languages[0] === Language.None
      const hasStrings =
        !isNoneLanguage &&
        primaryExh.columns.some(
          (column) => column.type === ExcelColumnDataType.String,
        )

      if (hasStrings) {
        if (format === ExdCSVFormat.Multiple) {
          for (let i = 0; i < readers.length; i++) {
            const { reader, languages } = readers[i]
            const exh =
              i === 0
                ? primaryExh
                : await readExhHeaderFromReader(reader, sheet)
            for (const language of languages) {
              const outputFile = join(outputDir, csvName(sheet, language))
              const csv = await this.exportSheet(reader, sheet, exh, language)
              writeFileSync(outputFile, csv)
            }
          }
        }

        // Merged format is not implemented yet
      } else {
        const outputFile = join(outputDir, csvName(sheet))
        const csv = await this.exportSheet(
          primaryReader,
          sheet,
          primaryExh,
          isNoneLanguage ? Language.None : primaryLanguage,
        )
        writeFileSync(outputFile, csv)
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

    const columns = this.formatColumns(sheet, exdHeader.columns)
    const lines: string[] = [
      `key,${columns.map(({ index }) => index).join(',')}`,
      `#,${columns.map(({ name }) => name).join(',')}`,
      `int32,${columns.map(({ typeString }) => typeString).join(',')}`,
    ]

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
            let subRowId = 0;
            subRowId < exdReader.getSubRowCount(rowId);
            subRowId++
          ) {
            const row = exdReader.readSubrow(rowId, subRowId)
            lines.push(this.formatData(`${rowId}.${subRowId}`, columns, row))
          }
        } else {
          const row = exdReader.readRow(rowId)
          lines.push(this.formatData(rowId, columns, row))
        }
      }
    }

    return lines.join('\n') + '\n'
  }
}
