import { writeFileSync } from 'node:fs'
import {
  ExcelColumnDataType,
  type ExhHeader,
  type SqPackReader,
} from '@ffcafe/ixion-sqpack'
import { Language, languageToCodeMap } from '@ffcafe/ixion-utils'
import type { DefinitionProvider } from './schema/interface'
import {
  type ExdFilter,
  getStringColumnIndexes,
  readColumnsFromSheet,
} from './utils'
import {
  listExdSheetsFromReader,
  readExhHeaderFromReader,
} from './utils/reader'

interface StringsExporterOptions {
  definitions: DefinitionProvider
}

interface StringItem {
  sheet: string
  rowId: string
  field: string
  values: Record<string, string>
}

export class StringsExporter {
  private readonly definitions: DefinitionProvider
  constructor(readonly options: StringsExporterOptions) {
    this.definitions = options.definitions
  }

  async export(
    readers: Array<{ languages: Language[]; reader: SqPackReader }>,
    output: string,
    filter?: ExdFilter,
  ) {
    if (readers.length === 0) {
      throw new Error('No readers provided')
    }

    const { reader: primaryReader } = readers[0]
    const readerMap: Map<Language, SqPackReader> = new Map()
    for (const { reader, languages } of readers) {
      for (const language of languages) {
        readerMap.set(language, reader)
      }
    }

    const sheets = await listExdSheetsFromReader(primaryReader)
    const strings: StringItem[] = []
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

      if (!hasStrings) {
        continue
      }

      this.exportSheet(strings, readerMap, sheet, primaryExh)
    }

    writeFileSync(output, JSON.stringify(strings, null, 2))
  }

  async exportSheet(
    strings: StringItem[],
    readers: Map<Language, SqPackReader>,
    sheet: string,
    exdHeader: ExhHeader,
  ) {
    const definitions = await this.definitions.getFlatFields(
      sheet,
      exdHeader.columns,
    )
    const stringFields = getStringColumnIndexes(exdHeader).map(
      (index) => definitions[index].name,
    )

    // collect all strings
    const stringMap: Record<string, Map<string, any[]>> = {}
    const idSet = new Set<string>()
    for (const [language, reader] of readers.entries()) {
      const header = await readExhHeaderFromReader(reader, sheet)
      const columnIndexes = getStringColumnIndexes(header)
      stringMap[languageToCodeMap[language]] = await readColumnsFromSheet(
        reader,
        {
          sheetName: sheet,
          header,
          language,
          columnIndexes,
        },
      )

      for (const id of stringMap[languageToCodeMap[language]].keys()) {
        idSet.add(id)
      }
    }

    const languages = Object.keys(stringMap)

    for (let i = 0; i < stringFields.length; i++) {
      const field = stringFields[i]

      for (const id of idSet) {
        const stringItem: StringItem = {
          sheet,
          rowId: id,
          field: field,
          values: {},
        }

        for (const language of languages) {
          const strings = stringMap[language].get(id)
          if (strings) {
            stringItem.values[language] = strings[i]
          }
        }

        strings.push(stringItem)
      }
    }
  }
}
