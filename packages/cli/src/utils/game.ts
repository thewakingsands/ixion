import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const readGameVersion = (path: string) => {
  try {
    return readFileSync(join(path, 'ffxivgame.ver'), 'utf-8').trim()
  } catch (_) {
    return null
  }
}
