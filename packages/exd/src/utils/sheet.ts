import type { ExhHeader } from '@ffcafe/ixion-sqpack'

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
