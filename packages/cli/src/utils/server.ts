import { type GameVersions, servers } from '@ffcafe/ixion-server'
import type { Language } from '@ffcafe/ixion-utils'

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
  const server = getServer(name)
  const allPatches = await server.request(baseVersion)

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
