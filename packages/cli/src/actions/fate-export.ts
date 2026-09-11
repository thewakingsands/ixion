import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { DefinitionProvider } from '@ffcafe/ixion-exd'
import {
  EXDReader,
  GameSqPackReader,
  getExdPath,
  type LgbVector3,
  readExhHeader,
  readLgbFile,
} from '@ffcafe/ixion-sqpack'
import type { Language } from '@ffcafe/ixion-utils'

type Row = Record<string, number | string>
type ResourceReader = Pick<GameSqPackReader, 'readFile'>

async function readSheet(
  reader: ResourceReader,
  definitions: DefinitionProvider,
  sheet: string,
  names: string[],
): Promise<Map<number, Row>> {
  const required = async (path: string) => {
    const data = await reader.readFile(path)
    if (!data) throw new Error(`Missing game resource: ${path}`)
    return data
  }
  const header = readExhHeader(await required(`exd/${sheet}.exh`))
  const fields = await definitions.getFlatFields(sheet, header.columns)
  const indexes = names.map((name) => {
    const index = fields.findIndex(
      (field) => field?.name.replace(/[{}]/g, '') === name,
    )
    if (index < 0 || index >= header.columns.length)
      throw new Error(
        `Missing ${sheet}.${name} in definitions; use definitions matching your game version`,
      )
    return index
  })
  const language = (header.languages[0] ?? 0) as Language
  const rows = new Map<number, Row>()
  for (const page of header.paginations) {
    const exd = new EXDReader(
      await required(getExdPath(sheet, page.startId, language)),
      header,
    )
    if (exd.isSubrows) throw new Error(`Unexpected subrows in ${sheet}`)
    for (const id of exd.listRowIds()) {
      const values = exd.readRow(id)
      const row: Row = {}
      names.forEach((name, i) => {
        const value: unknown = values[indexes[i]]
        if (Buffer.isBuffer(value)) row[name] = value.toString('utf8')
        else if (typeof value === 'number') row[name] = value
        else throw new Error(`Invalid ${sheet}.${name} in row ${id}`)
      })
      rows.set(id, row)
    }
  }
  return rows
}

function number(row: Row, name: string): number {
  const value = row[name]
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`Expected numeric ${name}`)
  return value
}

/** Teamcraft map coordinates: world X/Z become map X/Y; world Y is altitude. */
export function fateMapCoordinates(
  world: LgbVector3,
  sizeFactor: number,
  offsetX: number,
  offsetY: number,
) {
  if (
    sizeFactor <= 0 ||
    ![world.x, world.y, world.z, sizeFactor, offsetX, offsetY].every(
      Number.isFinite,
    )
  )
    throw new Error('Invalid map coordinates or size factor')
  const c = sizeFactor / 100
  const coordinate = (value: number, offset: number) =>
    Math.floor(((41 / c) * (((value + offset) * c + 1024) / 2048) + 1) * 100) /
    100
  return {
    x: coordinate(world.x, offsetX),
    y: coordinate(world.z, offsetY),
    z: Math.floor(world.y) / 100,
  }
}

export interface FateLocation {
  fateId: number
  location: number
  territoryId: number
  layerId: number
  lgbPath: string
  world: LgbVector3
  position: { map: number; zoneid: number; x: number; y: number; z: number }
}

export async function collectFateLocations(
  reader: ResourceReader,
  definitions: DefinitionProvider,
) {
  const fates = await readSheet(reader, definitions, 'Fate', ['Location'])
  const territories = await readSheet(reader, definitions, 'TerritoryType', [
    'Bg',
    'Map',
  ])
  const maps = await readSheet(reader, definitions, 'Map', [
    'SizeFactor',
    'OffsetX',
    'OffsetY',
    'PlaceName',
  ])
  const byLocation = new Map<number, number[]>()
  for (const [id, fate] of fates) {
    const location = number(fate, 'Location')
    if (!location) continue
    byLocation.set(location, [...(byLocation.get(location) ?? []), id])
  }
  const locations: FateLocation[] = []
  const missingLgbFiles: string[] = []
  const cache = new Map<string, ReturnType<typeof readLgbFile> | null>()
  for (const [territoryId, territory] of territories) {
    const bg = territory.Bg
    const mapId = number(territory, 'Map')
    if (!bg || !mapId) continue
    if (typeof bg !== 'string')
      throw new Error(`Invalid TerritoryType.Bg in ${territoryId}`)
    const map = maps.get(mapId)
    if (!map)
      throw new Error(`Missing Map ${mapId} for TerritoryType ${territoryId}`)
    const normalized = bg.replaceAll('\\', '/').toLowerCase()
    const level = normalized.indexOf('/level/')
    if (level < 0) throw new Error(`Invalid TerritoryType.Bg: ${bg}`)
    const root = `${normalized.startsWith('bg/') ? '' : 'bg/'}${normalized.slice(0, level)}/level`
    for (const name of ['bg', 'planmap', 'planevent', 'planlive']) {
      const lgbPath = `${root}/${name}.lgb`
      if (!cache.has(lgbPath)) {
        const data = await reader.readFile(lgbPath)
        try {
          cache.set(lgbPath, data ? readLgbFile(data) : null)
        } catch (cause) {
          throw new Error(`Failed to parse ${lgbPath}`, { cause })
        }
        if (!data) missingLgbFiles.push(lgbPath)
      }
      const lgb = cache.get(lgbPath)
      if (!lgb) continue
      for (const layer of lgb.layers) {
        for (const object of layer.instanceObjects) {
          if (object.assetType !== 49) continue
          const ids = byLocation.get(object.instanceId)
          if (!ids) continue
          const world = object.transform.translation
          const coords = fateMapCoordinates(
            world,
            number(map, 'SizeFactor'),
            number(map, 'OffsetX'),
            number(map, 'OffsetY'),
          )
          if (coords.x < 0 || coords.y < 0) continue
          for (const fateId of ids) {
            locations.push({
              fateId,
              location: object.instanceId,
              territoryId,
              layerId: layer.layerId,
              lgbPath,
              world,
              position: {
                map: mapId,
                zoneid: number(map, 'PlaceName'),
                ...coords,
              },
            })
          }
        }
      }
    }
  }
  const matched = new Set(locations.map((entry) => entry.fateId))
  const unmatchedFateIds = [...byLocation.values()]
    .flat()
    .filter((id) => !matched.has(id))
    .sort((a, b) => a - b)
  locations.sort(
    (a, b) =>
      a.fateId - b.fateId ||
      a.territoryId - b.territoryId ||
      a.lgbPath.localeCompare(b.lgbPath) ||
      a.layerId - b.layerId,
  )
  return {
    locations,
    unmatchedFateIds,
    missingLgbFiles: missingLgbFiles.sort(),
  }
}

export async function exportFateLocations(
  gamePath: string,
  output: string,
  definitions: DefinitionProvider,
) {
  const reader = new GameSqPackReader(gamePath)
  try {
    const result = await collectFateLocations(reader, definitions)
    if (!result.locations.length)
      throw new Error(
        'No FATE locations found; check the game directory and definitions',
      )
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, `${JSON.stringify(result, null, 2)}\n`)
    console.log(
      `Exported ${result.locations.length} FATE locations to ${output}; ${result.unmatchedFateIds.length} unmatched FATEs, ${result.missingLgbFiles.length} missing LGB files`,
    )
  } finally {
    await reader.close()
  }
}
