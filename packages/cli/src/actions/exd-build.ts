import { rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  type ExhHeader,
  getExdPath,
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
}

export interface BuildOptions {
  serverVersions: ServerVersion[]
  outputPrefix: string
  filter?: (sheet: string) => boolean
}

function formatLanguage(lang: Language): string {
  return Language[lang] || `Unknown(${lang})`
}

/**
 * Validate that two EXH headers are compatible for merging
 */
function validateHeadersCompatible(
  header1: ExhHeader,
  header2: ExhHeader,
  sheetName: string,
): boolean {
  // Check column definitions
  if (header1.columnCount !== header2.columnCount) {
    throw new Error(
      `Sheet ${sheetName}: Column count mismatch (${header1.columnCount} vs ${header2.columnCount})`,
    )
  }

  for (let i = 0; i < header1.columnCount; i++) {
    const col1 = header1.columns[i]
    const col2 = header2.columns[i]
    if (col1.type !== col2.type || col1.offset !== col2.offset) {
      throw new Error(
        `Sheet ${sheetName}: Column ${i} mismatch (type: ${col1.type} vs ${col2.type}, offset: ${col1.offset} vs ${col2.offset})`,
      )
    }
  }

  // Check paginations
  if (header1.pageCount !== header2.pageCount) {
    throw new Error(
      `Sheet ${sheetName}: Page count mismatch (${header1.pageCount} vs ${header2.pageCount})`,
    )
  }

  for (let i = 0; i < header1.pageCount; i++) {
    const page1 = header1.paginations[i]
    const page2 = header2.paginations[i]
    if (page1.startId !== page2.startId) {
      throw new Error(
        `Sheet ${sheetName}: Page ${i} startId mismatch (${page1.startId} vs ${page2.startId})`,
      )
    }
  }

  return true
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

/**
 * Create filter function
 */
export function createExdFilter(
  keywords?: string[],
  rootOnly?: boolean,
): { filter: (sheet: string) => boolean; description: string } {
  const filter = (sheet: string) => {
    if (rootOnly && sheet.includes('/')) {
      return false
    }

    if (keywords && keywords.length > 0) {
      const lowerSheet = sheet.toLowerCase()
      return keywords.some((keyword) =>
        lowerSheet.includes(keyword.toLowerCase()),
      )
    }

    return true
  }

  let description = ''
  if (rootOnly && keywords && keywords.length > 0) {
    description = ` (root-only + name: ${keywords.join(', ')})`
  } else if (rootOnly) {
    description = ' (root-only)'
  } else if (keywords && keywords.length > 0) {
    description = ` (name: ${keywords.join(', ')})`
  }

  return { filter, description }
}

/**
 * Build merged EXD files from multiple servers
 */
export async function buildExdFiles({
  serverVersions,
  outputPrefix,
  filter,
}: BuildOptions): Promise<void> {
  const storageManager = getStorageManager()
  const tempDirs: string[] = []
  const readers: { reader: SqPackReader; server: string; version: string }[] =
    []

  try {
    // Download all versions to temporary directories
    for (const { server, version } of serverVersions) {
      const tempDir = await getTempDir()
      tempDirs.push(tempDir)

      await storageManager.downloadVersion(server, version, tempDir)

      const sqPackPrefix = join(tempDir, exdSqPackFile)
      const reader = await SqPackReader.open({ prefix: sqPackPrefix })
      readers.push({ reader, server, version })
    }

    // Read root.exl from the first server
    const firstReader = readers[0].reader
    const rootData = await firstReader.readFile('exd/root.exl')
    if (!rootData) {
      throw new Error('Failed to read root.exl from first server')
    }

    const rootExl = readExlFile(rootData)
    const filteredEntries = filter
      ? rootExl.entries.filter((entry) => filter(entry.name))
      : rootExl.entries

    console.log(`📋 Processing ${filteredEntries.length} filtered sheets...`)

    // Create SqPackWriter
    const writer = new SqPackWriter({
      prefix: outputPrefix,
    })

    // Process each filtered sheet
    for (const entry of filteredEntries) {
      const sheetName = entry.name
      const exhPath = `exd/${sheetName}.exh`

      console.log(`🔍 Processing sheet: ${sheetName}`)

      // Read headers from all servers
      const headers: ExhHeader[] = []

      const languageMap = new Map<Language, SqPackReader>()
      for (const { reader, server, version } of readers) {
        try {
          const data = await reader.readFile(exhPath)
          if (!data) {
            throw new Error(
              `Failed to read ${exhPath} from server ${server} (${version})`,
            )
          }

          const header = readExhHeader(data)
          headers.push(header)

          // EXH may contain languages that are not present
          const languages: Language[] = []
          for (const language of header.languages) {
            // Skip languages that are already in the map
            if (languageMap.has(language)) {
              continue
            }

            const hasLanguage = await reader.hasFile(
              getExdPath(sheetName, header.paginations[0].startId, language),
            )
            if (hasLanguage) {
              languageMap.set(language, reader)
              languages.push(language)
            }
          }

          debug(
            `Read header from ${server}:${version} - languages: ${languages.map(formatLanguage).join(', ')}`,
          )
        } catch (e) {
          throw new Error(
            `Failed to read ${exhPath} from server ${server} (${version})`,
            { cause: e },
          )
        }
      }

      // Validate headers are compatible
      for (let i = 1; i < headers.length; i++) {
        validateHeadersCompatible(headers[0], headers[i], sheetName)
      }

      // Merge languages
      const mergedLanguages = Array.from(languageMap.keys()).sort()
      const isMultiLang = isMultiLanguageSheet(mergedLanguages)

      debug(
        `Merged languages for ${sheetName}: ${mergedLanguages.map(formatLanguage).join(', ')} (multi-lang: ${isMultiLang})`,
      )

      // Create merged header
      const mergedHeader = {
        ...headers[0],
        languages: mergedLanguages,
        languageCount: mergedLanguages.length,
      }

      // Write merged header
      const finalHeaderBuffer = writeExhHeader(mergedHeader)

      await writer.addFile(exhPath, finalHeaderBuffer)

      // Process data files
      if (isMultiLang) {
        // Multi-language sheet: collect data from all servers
        for (const lang of mergedLanguages) {
          for (const pagination of mergedHeader.paginations) {
            const exdPath = getExdPath(sheetName, pagination.startId, lang)

            // Try to find data from any server
            let foundData = false
            for (const { reader, server, version } of readers) {
              const data = await reader.readFile(exdPath)
              if (data) {
                await writer.addFile(exdPath, data)
                foundData = true
                debug(`Added ${exdPath} from ${server}:${version}`)
                break
              }
            }

            if (!foundData) {
              debug(`No data found for ${exdPath}`)
            }
          }
        }
      } else {
        // Single language sheet: use data from first server only
        for (const pagination of mergedHeader.paginations) {
          const exdPath = getExdPath(
            sheetName,
            pagination.startId,
            Language.None,
          )

          const data = await firstReader.readFile(exdPath)
          if (data) {
            await writer.addFile(exdPath, data)
            debug(`Added ${exdPath} from first server`)
          } else {
            debug(`No data found for ${exdPath}`)
          }
        }
      }
    }

    // Create updated root.exl with only filtered entries
    const updatedRootExl = {
      ...rootExl,
      entries: filteredEntries,
    }

    const finalRootBuffer = writeExlFile(updatedRootExl)

    await writer.addFile('exd/root.exl', finalRootBuffer)

    // Close writer to finalize SqPack files
    await writer.close()

    console.log(
      `✅ Successfully built merged SqPack files with prefix: ${outputPrefix}`,
    )
    console.log(`📁 Output files:`)
    console.log(`  - ${outputPrefix}.dat0`)
    console.log(`  - ${outputPrefix}.index`)
    console.log(`  - ${outputPrefix}.index2`)
  } finally {
    // Clean up readers
    for (const { reader } of readers) {
      await reader.close()
    }

    // Clean up temporary directories
    for (const tempDir of tempDirs) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  }
}
