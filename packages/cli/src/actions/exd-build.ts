import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { rootExlFile, validateHeadersCompatible } from '@ffcafe/ixion-exd'
import { servers } from '@ffcafe/ixion-server'
import {
  EXDReader,
  EXDWriter,
  ExcelColumnDataType,
  type ExhHeader,
  type ExlFile,
  getExdPath,
  type IExdDataRow,
  type IExdDataSubRow,
  readExhHeader,
  readExlFile,
  SqPackReader,
  SqPackWriter,
  writeExhHeader,
  writeExlFile,
} from '@ffcafe/ixion-sqpack'
import { Language } from '@ffcafe/ixion-utils'
import $debug from 'debug'
import { exdSqPackFile } from '../config'
import { getTempDir } from '../utils/root'
import { getStorageManager } from '../utils/storage'

const debug = $debug('ixion:exd-build')

export interface ServerVersion {
  server: string
  version: string
  sqpackPrefix?: string
}

export interface BuildOptions {
  serverVersions: ServerVersion[]
  outputPrefix: string
  filter?: (sheet: string) => boolean
}

export interface SheetInfo {
  server: string
  version: string
  reader: SqPackReader
  exhHeader: ExhHeader
  languages: Language[]
}

function formatLanguage(lang: Language): string {
  return Language[lang] || `Unknown(${lang})`
}

/**
 * Check if a sheet is multi-language
 */
function isMultiLanguageSheet(languages: number[]): boolean {
  return (
    languages.length > 1 ||
    (languages.length === 1 && languages[0] !== Language.None)
  )
}

class ExdBuilder {
  writer: SqPackWriter
  tempDirs: string[] = []
  readers: Array<ServerVersion & { reader: SqPackReader }> = []
  languages: Language[] = []
  paths: Set<string> = new Set()

  constructor(private options: BuildOptions) {
    // Create SqPackWriter
    this.writer = new SqPackWriter({
      prefix: options.outputPrefix,
    })

    const languages = new Set<Language>()
    for (const { server } of options.serverVersions) {
      for (const language of servers[server as keyof typeof servers]
        .languages) {
        languages.add(language)
      }
    }
    this.languages = Array.from(languages)
  }

  get firstReader() {
    return this.readers[0].reader
  }

  async build() {
    const rootExl = await this.#readRootExl()
    console.log(`📋 Processing ${rootExl.entries.length} filtered sheets...`)

    for (const entry of rootExl.entries) {
      await this.buildSheet(entry.name)
    }

    // Create updated root.exl with only filtered entries
    await this.#addFile(rootExlFile, writeExlFile(rootExl))
  }

  async buildSheet(sheetName: string) {
    const exhPath = `exd/${sheetName}.exh`

    // console.log(`🔍 Processing sheet: ${sheetName}`)
    const { mergedLanguages, isMultiLang, sheetInfos } =
      await this.#collectExhHeaders(sheetName)

    debug(
      `Merged languages for ${sheetName}: ${mergedLanguages.map(formatLanguage).join(', ')} (multi-lang: ${isMultiLang})`,
    )

    // Write merged header
    const firstSheetInfo = sheetInfos[0]
    const mergedHeader: ExhHeader = {
      ...firstSheetInfo.exhHeader,
      languages: mergedLanguages,
      languageCount: mergedLanguages.length,
    }
    await this.#addFile(exhPath, writeExhHeader(mergedHeader))

    // Collect data from first server
    await this.#copyExdFiles(sheetName, firstSheetInfo)

    // Single language sheet: use data from first server only
    if (!isMultiLang) {
      return
    }

    // Collect data from other servers
    for (const sheetInfo of sheetInfos.slice(1)) {
      let compatible = true
      try {
        validateHeadersCompatible(
          firstSheetInfo.exhHeader,
          sheetInfo.exhHeader,
          sheetName,
        )
      } catch (error: unknown) {
        compatible = false
        console.warn(
          `%s: Headers are not compatible between %s and %s: %s`,
          sheetName,
          firstSheetInfo.languages.map(formatLanguage).join(', '),
          sheetInfo.languages.map(formatLanguage).join(', '),
          error instanceof Error ? error.message : String(error),
        )
      }

      if (compatible) {
        await this.#copyExdFiles(sheetName, sheetInfo)
      } else {
        try {
          await this.#mergeExdFiles(sheetName, firstSheetInfo, sheetInfo)
        } catch (error: unknown) {
          console.warn(
            `%s: Failed to merge between %s and %s: %s`,
            sheetName,
            firstSheetInfo.server,
            firstSheetInfo.version,
            sheetInfo.server,
            sheetInfo.version,
            error instanceof Error ? error.message : String(error),
          )

          console.warn(
            `Falling back to copying data from ${sheetInfo.server}:${sheetInfo.version}`,
          )
          await this.#copyExdFiles(sheetName, sheetInfo)
        }
      }
    }

    const restLanguages = this.languages.filter(
      (language) => !mergedLanguages.includes(language),
    )

    if (restLanguages.length > 0) {
      const fromLanguage = firstSheetInfo.languages[0]
      console.warn(
        `Copying data from ${formatLanguage(fromLanguage)} to ${restLanguages.map(formatLanguage).join(', ')}`,
      )

      await this.#copyExdFiles(
        sheetName,
        {
          ...firstSheetInfo,
          languages: restLanguages,
        },
        fromLanguage,
      )
    }
  }

  async prepareReaders() {
    const storageManager = getStorageManager()
    const { serverVersions } = this.options
    // Download all versions to temporary directories
    for (const { server, version, sqpackPrefix } of serverVersions) {
      let prefix = sqpackPrefix
      if (!prefix) {
        const tempDir = await getTempDir()
        this.tempDirs.push(tempDir)

        await storageManager.downloadVersion(server, version, tempDir)

        prefix = join(tempDir, exdSqPackFile)
      }

      const reader = await SqPackReader.open({ prefix })
      this.readers.push({ reader, server, version })
    }
  }

  async close() {
    // Close writer
    await this.writer.close()

    writeFileSync(
      `${this.options.outputPrefix}.txt`,
      Array.from(this.paths).join('\n'),
    )

    // Clean up readers
    for (const { reader } of this.readers) {
      await reader.close()
    }

    // Clean up temporary directories
    for (const tempDir of this.tempDirs) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  }

  async #readRootExl(): Promise<ExlFile> {
    // Read root.exl from the first server
    const firstReader = this.readers[0].reader
    const rootData = await firstReader.readFile(rootExlFile)
    if (!rootData) {
      throw new Error(`Failed to read ${rootExlFile} from first server`)
    }

    const rootExl = readExlFile(rootData)
    const { filter } = this.options
    const filteredEntries = filter
      ? rootExl.entries.filter((entry) => filter(entry.name))
      : rootExl.entries

    return {
      ...rootExl,
      entries: filteredEntries,
    }
  }

  async #collectExhHeaders(sheetName: string) {
    const exhPath = `exd/${sheetName}.exh`
    const languageSet = new Set<Language>()
    const result: SheetInfo[] = []

    for (const { reader, server, version } of this.readers) {
      const data = await reader.readFile(exhPath)
      if (!data) {
        console.warn(
          `Failed to read ${exhPath} from server ${server} (${version})`,
        )
        continue
      }

      const exhHeader = readExhHeader(data)
      const languages: Language[] = []
      for (const language of exhHeader.languages) {
        if (languageSet.has(language)) {
          continue
        }

        if (language !== Language.None && !this.languages.includes(language)) {
          console.warn(
            `${sheetName} from ${server}:${version} has unexpected language: ${formatLanguage(language)}`,
          )
          continue
        }

        const hasLanguage = await reader.hasFile(
          getExdPath(sheetName, exhHeader.paginations[0].startId, language),
        )
        if (!hasLanguage) {
          continue
        }

        languageSet.add(language)
        languages.push(language)
      }

      if (languages.length > 0) {
        debug(
          `Read header from ${server}:${version} - languages: ${languages.map(formatLanguage).join(', ')}`,
        )
        result.push({ server, version, languages, reader, exhHeader })
      }
    }

    const mergedLanguages = Array.from(languageSet).sort()
    const isMultiLang = isMultiLanguageSheet(mergedLanguages)
    return {
      mergedLanguages,
      isMultiLang,
      sheetInfos: result,
    }
  }

  async #copyExdFiles(
    sheetName: string,
    { server, version, languages, exhHeader, reader }: SheetInfo,
    fromLanguage?: Language,
  ) {
    for (const language of languages) {
      for (const { startId } of exhHeader.paginations) {
        const toExdPath = getExdPath(sheetName, startId, language)
        const fromExdPath = fromLanguage
          ? getExdPath(sheetName, startId, fromLanguage)
          : toExdPath
        const data = await reader.readFile(fromExdPath)
        if (data) {
          await this.#addFile(toExdPath, data)
          debug(
            `Added %s from %s:%s %s`,
            toExdPath,
            server,
            version,
            fromLanguage ? `(from ${formatLanguage(fromLanguage)})` : '',
          )
        } else {
          debug(`No data found for ${toExdPath}`)
        }
      }
    }
  }

  async #mergeExdFiles(
    sheetName: string,
    baseSheetInfo: SheetInfo,
    stringSheetInfo: SheetInfo,
  ) {
    const baseStringColumns = baseSheetInfo.exhHeader.columns
      .map((column, index) =>
        column.type === ExcelColumnDataType.String ? index : -1,
      )
      .filter((index) => index !== -1)
    const stringStringColumns = stringSheetInfo.exhHeader.columns
      .map((column, index) =>
        column.type === ExcelColumnDataType.String ? index : -1,
      )
      .filter((index) => index !== -1)

    if (baseStringColumns.length !== stringStringColumns.length) {
      throw new Error(
        `${sheetName}: String columns length mismatch (base: ${baseStringColumns.length}, string: ${stringStringColumns.length})`,
      )
    }

    const baseSheetPages: Array<{
      startId: number
      rows: IExdDataRow[]
    }> = []
    const baseLanguage = baseSheetInfo.languages[0]

    // read base sheet pages
    for (const { startId } of baseSheetInfo.exhHeader.paginations) {
      const data = await baseSheetInfo.reader.readFile(
        getExdPath(sheetName, startId, baseLanguage),
      )
      if (data) {
        const reader = new EXDReader(data, baseSheetInfo.exhHeader)
        baseSheetPages.push({ startId, rows: reader.readRows() })
      }
    }

    for (const language of stringSheetInfo.languages) {
      const stringMap = new Map<string, string[]>()

      // read strings
      for (const { startId } of stringSheetInfo.exhHeader.paginations) {
        const data = await stringSheetInfo.reader.readFile(
          getExdPath(sheetName, startId, language),
        )
        if (data) {
          const reader = new EXDReader(data, stringSheetInfo.exhHeader)
          const rows = reader.readRows()
          for (const row of rows) {
            if (reader.isSubrows) {
              for (const subRow of row.data) {
                stringMap.set(
                  `${row.rowId}.${subRow.subRowId}`,
                  stringStringColumns.map((column) => subRow.data[column]),
                )
              }
            } else {
              stringMap.set(
                row.rowId.toString(),
                stringStringColumns.map((column) => row.data[column]),
              )
            }
          }
        }
      }

      // merge base sheet pages
      for (const page of baseSheetPages) {
        const writer = new EXDWriter(baseSheetInfo.exhHeader)
        for (const row of page.rows) {
          if (writer.isSubrows) {
            writer.writeRow({
              rowId: row.rowId,
              data: row.data.map((subRow: IExdDataSubRow) => {
                const strings = stringMap.get(`${row.rowId}.${subRow.subRowId}`)
                if (strings) {
                  const newData = [...subRow.data]
                  for (let i = 0; i < strings.length; i++) {
                    newData[baseStringColumns[i]] = strings[i]
                  }

                  return {
                    subRowId: subRow.subRowId,
                    data: newData,
                  }
                }

                return subRow
              }),
            })
          } else {
            const strings = stringMap.get(row.rowId.toString())
            if (strings) {
              const newData = [...row.data]
              for (let i = 0; i < strings.length; i++) {
                newData[baseStringColumns[i]] = strings[i]
              }
              writer.writeRow({ rowId: row.rowId, data: newData })
            } else {
              writer.writeRow(row)
            }
          }
        }

        await this.#addFile(
          getExdPath(sheetName, page.startId, language),
          writer.output(),
        )
      }
    }
  }

  async #addFile(path: string, data: Buffer) {
    this.paths.add(path)
    await this.writer.addFile(path, data)
  }
}

/**
 * Build merged EXD files from multiple servers
 */
export async function buildExdFiles(options: BuildOptions): Promise<void> {
  const builder = new ExdBuilder(options)

  try {
    await builder.prepareReaders()
    await builder.build()

    const { outputPrefix } = options
    console.log(
      `✅ Successfully built merged SqPack files with prefix: ${outputPrefix}`,
    )
    console.log(`📁 Output files:`)
    console.log(`  - ${outputPrefix}.dat0`)
    console.log(`  - ${outputPrefix}.index`)
    console.log(`  - ${outputPrefix}.index2`)
  } finally {
    await builder.close()
  }
}
