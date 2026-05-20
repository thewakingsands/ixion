import { existsSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveLocalStoragePath } from './config'

export function getWorkingDir() {
  const cwd = process.cwd()

  if (!existsSync(join(cwd, 'package.json'))) {
    throw new Error('Please run this command from repository root')
  }

  return cwd
}

export function getVersionDir(version: string) {
  return resolveLocalStoragePath('versions', version)
}

export async function getTempDir() {
  const cwd = getWorkingDir()
  return mkdtemp(join(cwd, 'temp-'))
}
