import {
  EXDReader,
  getExdPath,
  readExhHeader,
  readExlFile,
} from '@ffcafe/ixion-sqpack'
import type { DefinitionProvider, FlatField } from './schema/interface'

export interface AssetReferences {
  icons: number[]
  maps: string[]
}

export interface AssetResourceReader {
  readFile(path: string): Promise<Buffer | null>
}

/** A union of references ever observed, independent of game version. */
export class AssetReferenceCollector {
  private icons = new Set<number>()
  private maps = new Set<string>()

  constructor(initial?: AssetReferences) {
    if (initial) this.merge(initial)
  }

  merge(references: AssetReferences) {
    for (const icon of references.icons) {
      if (Number.isSafeInteger(icon) && icon > 0) this.icons.add(icon)
    }
    for (const map of references.maps) {
      const normalized = map.toLowerCase()
      if (/^[a-z0-9]+\/\d{2}$/.test(normalized)) this.maps.add(normalized)
    }
  }

  observe(sheet: string, fields: FlatField[], values: unknown[]) {
    for (const field of fields) {
      if (!field) continue
      const value = values[field.index]
      if (field.link === 'Image' && typeof value === 'number') {
        this.merge({ icons: [value], maps: [] })
      } else if (sheet.toLowerCase() === 'map' && field.name === 'Id') {
        const id = Buffer.isBuffer(value) ? value.toString('utf8') : value
        if (typeof id === 'string') this.merge({ icons: [], maps: [id] })
      }
    }
  }

  toJSON(): AssetReferences {
    return {
      icons: [...this.icons].sort((a, b) => a - b),
      maps: [...this.maps].sort(),
    }
  }
}

export async function collectAssetReferences(
  reader: AssetResourceReader,
  definitions: DefinitionProvider,
  collector = new AssetReferenceCollector(),
) {
  const required = async (path: string) => {
    const data = await reader.readFile(path)
    if (!data) throw new Error(`Missing EXD resource: ${path}`)
    return data
  }
  const skippedSheets: string[] = []
  for (const { name: sheet } of readExlFile(await required('exd/root.exl'))
    .entries) {
    const header = readExhHeader(await required(`exd/${sheet}.exh`))
    const fields = await definitions.getFlatFields(sheet, header.columns)
    if (
      sheet.toLowerCase() === 'map' &&
      !fields.some((field) => field?.name === 'Id')
    ) {
      throw new Error('Map.Id is missing from the supplied definitions')
    }
    if (!fields.some((field) => field?.name)) {
      skippedSheets.push(sheet)
      continue
    }
    if (
      !fields.some((field) => field?.link === 'Image') &&
      sheet.toLowerCase() !== 'map'
    )
      continue
    const assetFields = fields.filter(
      (field) =>
        field?.link === 'Image' ||
        (sheet.toLowerCase() === 'map' && field?.name === 'Id'),
    )
    const columnIndexes = assetFields.map((field) => field.index)
    for (const language of header.languages) {
      for (const page of header.paginations) {
        const exd = new EXDReader(
          await required(getExdPath(sheet, page.startId, language)),
          header,
        )
        for (const rowId of exd.listRowIds()) {
          try {
            if (exd.isSubrows) {
              for (let index = 0; index < exd.getSubRowCount(rowId); index++) {
                collector.observe(
                  sheet,
                  assetFields,
                  exd.readSubrow(rowId, index, columnIndexes).data,
                )
              }
            } else {
              collector.observe(
                sheet,
                assetFields,
                exd.readRow(rowId, columnIndexes),
              )
            }
          } catch (cause) {
            throw new Error(
              `Failed collecting asset references from ${sheet}#${rowId} (language ${language})`,
              { cause },
            )
          }
        }
      }
    }
  }
  return { references: collector.toJSON(), skippedSheets }
}

export const iconVariants = [
  '',
  '/en',
  '/ja',
  '/fr',
  '/de',
  '/hq',
  '/chs',
  '/cht',
  '/kr',
]

/** Enumerate all six-digit icon IDs, including zero, independently of EXD. */
export function* generateIconDirectories(): Generator<string> {
  for (let group = 0; group < 1000; group++) {
    const prefix = `${group.toString().padStart(3, '0')}000`
    for (const variant of iconVariants) yield `ui/icon/${prefix}${variant}`
  }
}

export function* generateIconPaths(directory: string): Generator<string> {
  const match = directory.match(
    /^ui\/icon\/(\d{3})000(?:\/(en|ja|fr|de|hq|chs|cht|kr))?$/,
  )
  if (!match) throw new Error(`Invalid icon directory: ${directory}`)
  const start = Number(match[1]) * 1000
  for (let icon = start; icon < start + 1000; icon++) {
    const base = `${directory}/${icon.toString().padStart(6, '0')}`
    yield `${base}.tex`
    yield `${base}_hr1.tex`
  }
}

export function* generateMapAssetPaths(
  references: AssetReferences,
): Generator<string> {
  const normalized = new AssetReferenceCollector(references).toJSON()
  for (const map of normalized.maps) {
    const base = `ui/map/${map}/${map.replace('/', '')}`
    for (const suffix of ['_m', 'm_m', 'd']) yield `${base}${suffix}.tex`
  }
}

/** Icons are exhaustive; only map candidates are restricted by EXD references. */
export function* generateAssetPaths(
  references: AssetReferences,
): Generator<string> {
  for (const directory of generateIconDirectories())
    yield* generateIconPaths(directory)
  yield* generateMapAssetPaths(references)
}
