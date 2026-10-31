import { copyFileSync } from 'node:fs'
import { basename, join } from 'node:path'

export function copyMergedAssets(
  gameDir: string,
  archiveDir: string,
): string[] {
  return [
    'ffxivgame.ver',
    'sqpack/ffxiv/0a0000.win32.dat0',
    'sqpack/ffxiv/0a0000.win32.index',
    'sqpack/ffxiv/0a0000.win32.index2',
  ].map((file) => {
    const target = join(archiveDir, `merged.${basename(file)}`)
    copyFileSync(join(gameDir, file), target)
    return target
  })
}
