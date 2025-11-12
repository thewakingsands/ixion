export const versionRegex = /(\d{4}\.\d{2}\.\d{2}\.\d{4}\.\d{4})/
export const fullVersionRegex =
  /^(\w*)(\d{4}\.\d{2}\.\d{2}\.\d{4}\.\d{4})(\w*)$/

export const sortVersions = (versions: string[]): string[] => {
  return versions.sort((a, b) => {
    const aMatch = fullVersionRegex.exec(a)
    const bMatch = fullVersionRegex.exec(b)
    if (!aMatch || !bMatch) {
      return 0
    }

    // Compare the version number
    const aVersion = aMatch[2]
    const bVersion = bMatch[2]
    if (!aVersion || !bVersion) {
      return 0
    }

    if (aVersion !== bVersion) {
      return aVersion.localeCompare(bVersion)
    }

    // Compare thr suffix: a < z < aa < ...
    const aSuffix = aMatch[3]
    const bSuffix = bMatch[3]
    if (!aSuffix || !bSuffix) {
      return 0
    }

    if (aSuffix.length !== bSuffix.length) {
      return aSuffix.length - bSuffix.length
    }

    return aSuffix.localeCompare(bSuffix)
  })
}
