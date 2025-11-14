import {
  type ExhHeader,
  readExhHeader,
  readExlFile,
  type SqPackReader,
} from '@ffcafe/ixion-sqpack'
import { rootExlFile } from './const'

export type ExdFilter = (sheet: string) => boolean

/**
 * Create filter function
 */
export function createExdFilter(
  keywords?: string[],
  rootOnly?: boolean,
): { filter: ExdFilter; description: string } {
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
 * Validate that two EXH headers are compatible for merging
 */
export function validateHeadersCompatible(
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

export async function listExdSheetsFromReader(reader: SqPackReader) {
  const root = await reader.readFile(rootExlFile)
  if (!root) {
    throw new Error(`Failed to read ${rootExlFile}`)
  }

  const rootData = readExlFile(root)
  return rootData.entries.map((entry) => entry.name)
}

export async function readExhHeaderFromReader(
  reader: SqPackReader,
  sheet: string,
) {
  const exhFile = `exd/${sheet}.exh`
  const exhData = await reader.readFile(exhFile)
  if (!exhData) {
    throw new Error(`Failed to read ${exhFile}`)
  }
  return readExhHeader(exhData)
}
