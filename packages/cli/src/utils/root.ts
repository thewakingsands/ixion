import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function getWorkingDir() {
  const cwd = process.cwd()

  if (!existsSync(join(cwd, 'package.json'))) {
    throw new Error('Please run this command from repository root')
  }

  return cwd
}

export function getVersionDir(version: string) {
  const cwd = getWorkingDir()
  return join(cwd, 'versions', version)
}
