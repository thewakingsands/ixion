import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ExcelColumnDataType, type SqPackReader } from '@ffcafe/ixion-sqpack'
import { Language, languageToCodeMap } from '@ffcafe/ixion-utils'
import { SingleBar } from 'cli-progress'
import { formatSeString, parseSeString } from './sestring'
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
  outputDir: string
  /**
   * Show a progress bar for sheets when exporting.
   * Defaults to true.
   */
  showProgressBar?: boolean
}

interface StringItem {
  sheet: string
  rowId: string
  values: Record<string, string>
}

export class StringsExporter {
  private outputIndex = 0
  private rowCount = 0
  private buffer: StringItem[] = []
  private bufferSize = 10000

  constructor(readonly options: StringsExporterOptions) {}

  async export(
    readers: Array<{ languages: Language[]; reader: SqPackReader }>,
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

    const sheets = await listExdSheetsFromReader(primaryReader, filter)

    let progressBar: SingleBar | null = null
    if (this.options.showProgressBar !== false && sheets.length > 0) {
      progressBar = new SingleBar({
        format: 'Sheets [{bar}] {value}/{total}',
      })
      progressBar.start(sheets.length, 0)
    }

    try {
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

        if (!hasStrings) {
          progressBar?.increment()
          continue
        }

        await this.exportSheet(readerMap, sheet)
        progressBar?.increment()
      }

      this.flush()
    } finally {
      progressBar?.stop()
      console.log(`Exported ${this.rowCount} rows`)
    }
  }

  async exportSheet(readers: Map<Language, SqPackReader>, sheet: string) {
    // collect all strings
    let columnCount = 0
    const stringMap: Record<string, Map<string, any[]>> = {}
    const idSet = new Set<string>()
    for (const [language, reader] of readers.entries()) {
      try {
        const header = await readExhHeaderFromReader(reader, sheet)
        const columnIndexes = getStringColumnIndexes(header)
        columnCount = Math.max(columnCount, columnIndexes.length)

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
      } catch {
        console.error(
          `${sheet}: Failed reading language ${languageToCodeMap[language]}`,
        )
      }
    }

    const languages = Object.keys(stringMap)

    const idList = Array.from(idSet)
    idList.sort((a, b) => {
      if (a.includes('.')) {
        const [a1, a2] = a.split('.').map(Number)
        const [b1, b2] = b.split('.').map(Number)
        return a1 - b1 || a2 - b2
      }

      return Number(a) - Number(b)
    })

    for (const rowId of idList) {
      const record: Record<string, string[]> = {}

      for (const language of languages) {
        const strings = stringMap[language].get(rowId)
        if (strings) {
          record[language] = strings.map(this.formatString)
        }
      }

      const values = this.formatValues(record, columnCount)
      if (values) {
        this.add({ sheet, rowId, values })
      }
    }
  }

  add(item: StringItem) {
    this.buffer.push(item)
    if (this.buffer.length >= this.bufferSize) {
      this.flush()
    }
  }

  flush() {
    this.rowCount += this.buffer.length
    this.writeFile(
      this.options.outputDir,
      `strings-${this.outputIndex.toString().padStart(4, '0')}`,
      this.buffer,
    )
    this.buffer = []
    this.outputIndex++
  }

  writeFile(dir: string, sheet: string, data: StringItem[]) {
    const outputFile = join(dir, `${sheet}.json`)
    mkdirSync(dirname(outputFile), { recursive: true })
    writeFileSync(outputFile, JSON.stringify(data, null, 2))
  }

  private formatString(value: Buffer | undefined): string {
    if (!value) {
      return ''
    }

    try {
      const seString = parseSeString(value)
      return formatSeString(seString, {
        renderToText: true,
        ifBranch: true,
        lineBreak: '\n',
      })
        .trim()
        .replace(/ +/g, ' ')
    } catch {
      return ''
    }
  }

  private formatValues(
    record: Record<string, string[]>,
    columnCount: number,
  ): Record<string, string> | null {
    const languages = Object.keys(record)
    if (languages.length === 0) {
      return null
    }

    let hasValue = false
    const filteredRecord: Record<string, string[]> = {}
    for (const language of languages) {
      filteredRecord[language] = []
    }

    for (let i = 0; i < columnCount; i++) {
      const values = languages.map((language) => record[language][i])
      if (
        (values.length === 1 && !values[0]) ||
        (values.length > 1 && values.every((value) => value === values[0]))
      ) {
        continue
      }

      hasValue = true
      for (let j = 0; j < languages.length; j++) {
        if (typeof values[j] === 'string') {
          filteredRecord[languages[j]].push(values[j])
        }
      }
    }

    if (!hasValue) {
      return null
    }

    const formattedValues: Record<string, string> = {}
    for (const language of languages) {
      formattedValues[language] = filteredRecord[language].join('\n')
    }

    return formattedValues
  }
}
