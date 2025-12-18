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
