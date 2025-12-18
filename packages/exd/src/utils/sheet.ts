import {
  EXDReader,
  ExcelColumnDataType,
  type ExhHeader,
  getExdPath,
  type SqPackReader,
} from '@ffcafe/ixion-sqpack'
import type { Language } from '@ffcafe/ixion-utils'

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

export function getStringColumnIndexes(header: ExhHeader): number[] {
  return header.columns
    .map((column, index) =>
      column.type === ExcelColumnDataType.String ? index : -1,
    )
    .filter((index) => index !== -1)
}

export async function readColumnsFromSheet(
  reader: SqPackReader,
  {
    sheetName,
    header,
    language,
    columnIndexes,
  }: {
    sheetName: string
    header: ExhHeader
    language: Language
    columnIndexes: number[]
  },
): Promise<Map<string, any[]>> {
  const dataMap = new Map<string, any[]>()

  for (const { startId } of header.paginations) {
    const data = await reader.readFile(getExdPath(sheetName, startId, language))
    if (data) {
      const reader = new EXDReader(data, header)
      const rows = reader.readRows()
      for (const row of rows) {
        if (reader.isSubrows) {
          for (const subRow of row.data) {
            dataMap.set(
              `${row.rowId}.${subRow.subRowId}`,
              columnIndexes.map((column) => subRow.data[column]),
            )
          }
        } else {
          dataMap.set(
            row.rowId.toString(),
            columnIndexes.map((column) => row.data[column]),
          )
        }
      }
    }
  }

  return dataMap
}
