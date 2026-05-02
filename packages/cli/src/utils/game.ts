import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const readGameVersion = (path: string) => {
  try {
    return readFileSync(join(path, 'ffxivgame.ver'), 'utf-8').trim()
  } catch (_) {
    return null
  }
}

const trunkRegexp =
  /ver_([^\\]+)\\trunk\\prog\\client\\Build\\FFXIVGame\\x64-Release\\ffxiv_dx11.pdb/

export const readGameTrunk = (path: string) => {
  const exe = join(path, 'ffxiv_dx11.exe')
  try {
    const source = readFileSync(exe, 'utf-8')
    const match = trunkRegexp.exec(source)
    if (match) {
      return match[1]
    }

    return 'unknown'
  } catch {
    return 'unknown'
  }
}
