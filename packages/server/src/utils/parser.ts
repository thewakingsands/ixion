import type { PatchEntry } from '../interface'

// game/c38effbc/D2025.06.04.0000.0000.patch
// game/ex1/77420d17/D2024.10.30.0000.0000.patch
const urlRegex = /(?:ex(\d+)\/)?([0-9a-f]+)\/([0-9A-Za-z]?[\d.]+)\.patch/

export const parsePatchList = (
  responseText: string,
  defaultRepository: string,
): PatchEntry[] => {
  // Split by boundary and process each part
  const lines = responseText.split('\n')
  const patches: PatchEntry[] = []

  for (const line of lines) {
    const fields = line.trim().split('\t')
    if (fields.length >= 9) {
      const url = fields[8].trim()
      const match = url.match(urlRegex)

      const exNumber = match?.[1]
      const expansion = exNumber ? `ex${exNumber}` : 'ffxiv'
      const repository = match?.[2] || defaultRepository

      // Parse hash information
      const hashType = fields[5].trim()
      const hashBlockSize = parseInt(fields[6], 10)
      const hashValue = fields[7]
        .split(',')
        .map((h) => h.trim())
        .filter((h) => h)

      const patch: PatchEntry = {
        patchSize: parseInt(fields[0], 10),
        version: fields[4].trim(),
        hash: hashValue
          ? {
              type: hashType,
              blockSize: hashBlockSize,
              values: hashValue,
            }
          : null,
        url,
        expansion,
        repository,
      }

      patches.push(patch)
    }
  }

  return patches
}
