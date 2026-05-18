import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type GameVersions, servers } from '@ffcafe/ixion-server'
import type { Language } from '@ffcafe/ixion-utils'
import { getVersionDir } from './root'

export type Server = (typeof servers)[keyof typeof servers]
export function getServer(name: string): Server {
  const server = servers[name as keyof typeof servers]
  if (!server) {
    throw new Error(`Unknown server: ${name}`)
  }

  return server
}

export function getServerLanguages(name: string): Language[] {
  const server = getServer(name)
  return server.languages
}

export async function requestServerPatches(
  name: string,
  baseVersion: GameVersions,
) {
  const cacheDir = getVersionDir('.cache')
  const cachePath = join(cacheDir, `${name}-${baseVersion.ffxiv}.json`)

  if (existsSync(cachePath)) {
    const cached = JSON.parse(await readFile(cachePath, 'utf-8')) as Awaited<
      ReturnType<Server['request']>
    >
    return splitPatches(cached)
  }

  const server = getServer(name)
  const allPatches = await server.request(baseVersion)
  await mkdir(cacheDir, { recursive: true })
  await writeFile(cachePath, `${JSON.stringify(allPatches, null, 2)}\n`)

  return splitPatches(allPatches)
}

function splitPatches(allPatches: Awaited<ReturnType<Server['request']>>) {
  // Separate FFXIV patches from expansion patches
  const ffxivPatches = allPatches.filter((patch) => patch.expansion === 'ffxiv')
  const expansionPatches = allPatches.filter(
    (patch) => patch.expansion !== 'ffxiv',
  )

  return {
    count: allPatches.length,
    ffxivPatches,
    expansionPatches,
  }
}
