import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { ciVersionsPath } from './constants'

/**
 * Read released versions from .ci/versions.json
 */
export function readReleasedVersions(): Record<string, string> {
  if (!existsSync(ciVersionsPath)) {
    return {}
  }

  try {
    const content = readFileSync(ciVersionsPath, 'utf-8')
    return JSON.parse(content) as Record<string, string>
  } catch (error) {
    console.warn(`⚠️ Failed to read ${ciVersionsPath}:`, error)
    return {}
  }
}

/**
 * Write released versions to .ci/versions.json
 */
export function writeReleasedVersions(versions: Record<string, string>): void {
  writeFileSync(ciVersionsPath, JSON.stringify(versions, null, 2), 'utf-8')
}
