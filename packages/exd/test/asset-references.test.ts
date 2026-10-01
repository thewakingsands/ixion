import {
  EXDWriter, ExcelColumnDataType, ExcelVariant, type ExhHeader,
  getExdPath, writeExhHeader, writeExlFile,
} from '@ffcafe/ixion-sqpack'
import { expect, it } from 'vitest'
import { AssetReferenceCollector, collectAssetReferences, generateAssetPaths, generateIconDirectories, generateIconPaths, generateMapAssetPaths } from '../src/asset-references'
import { CSVExporter } from '../src/csv'
import type { DefinitionProvider } from '../src/schema/interface'

function fixture() {
  const files = new Map<string, Buffer>()
  const headers = new Map<string, ExhHeader>()
  const definitions: DefinitionProvider = {
    getFlatFields: async (sheet) => sheet === 'Unknown' ? [] : [{ index: 0, name: sheet === 'Map' ? 'Id' : 'Texture', link: sheet === 'Map' ? '' : 'Image' }],
  }
  const entries = ['Item', 'Map', 'Sub', 'Unknown'].map((name, id) => ({ name, id }))
  files.set('exd/root.exl', writeExlFile({ magic: 'EXLT', version: 2, entries }))
  for (const { name } of entries) {
    const header: ExhHeader = {
      magic: 'EXHF', version: 3, dataOffset: 4, columnCount: 1,
      pageCount: 2, languageCount: 2, unknown1: 0, u2: 0,
      variant: name === 'Sub' ? ExcelVariant.Subrows : ExcelVariant.Default,
      u3: 0, rowCount: 2, u4: 0, u5: 0,
      columns: [{ offset: 0, type: name === 'Map' ? ExcelColumnDataType.String : ExcelColumnDataType.Int32 }],
      paginations: [{ startId: 0, rowCount: 1 }, { startId: 10, rowCount: 1 }], languages: [1, 2],
    }
    headers.set(name, header)
    files.set(`exd/${name}.exh`, writeExhHeader(header))
    for (const language of header.languages) {
      for (const page of header.paginations) {
        const writer = new EXDWriter(header)
        const value = language + page.startId
        writer.writeRows([{ rowId: page.startId, data: name === 'Sub'
          ? [{ subRowId: 7, data: [value + 100] }, { subRowId: 9, data: [0] }]
          : [name === 'Map' ? Buffer.from(page.startId === 0 ? 's1d1/00' : 's1d1/01') : value] }])
        files.set(getExdPath(name, page.startId, language), writer.output())
      }
    }
  }
  return { files, headers, definitions, reader: { readFile: async (path: string) => files.get(path) ?? null } }
}

it('unions references across pages, languages, subrows and previous runs', async () => {
  const { reader, definitions } = fixture()
  const collector = new AssetReferenceCollector({ icons: [999, 1], maps: ['old1/99'] })
  const result = await collectAssetReferences(reader, definitions, collector)
  expect(result.references).toEqual({ icons: [1, 2, 11, 12, 101, 102, 111, 112, 999], maps: ['old1/99', 's1d1/00', 's1d1/01'] })
  expect(result.skippedSheets).toEqual(['Unknown'])
  expect((await collectAssetReferences(reader, definitions, collector)).references).toEqual(result.references)
})

it('exhaustively generates icons independently of EXD, including zero and every variant', () => {
  const directories = [...generateIconDirectories()]
  expect(directories).toHaveLength(9000)
  expect(new Set(directories).size).toBe(9000)
  expect(directories).toContain('ui/icon/999000/kr')
  expect(directories).toContain('ui/icon/999000/cht')
  const icons = [...generateIconPaths('ui/icon/054000')]
  expect(icons).toHaveLength(2000)
  expect(icons).toContain('ui/icon/054000/054522_hr1.tex')
  expect([...generateIconPaths('ui/icon/999000/kr')].at(-1)).toBe('ui/icon/999000/kr/999999_hr1.tex')
  const paths = generateAssetPaths({ icons: [], maps: [] })
  expect(paths.next().value).toBe('ui/icon/000000/000000.tex')
  expect(paths.next().value).toBe('ui/icon/000000/000000_hr1.tex')
  paths.return(undefined)
})

it('uses only EXD map references for map composition sources', () => {
  const paths = [...generateMapAssetPaths({ icons: [51474], maps: ['s1d1/00', 's1d1/00', '../bad'] })]
  expect(paths).toEqual([
    'ui/map/s1d1/00/s1d100_m.tex', 'ui/map/s1d1/00/s1d100m_m.tex', 'ui/map/s1d1/00/s1d100d.tex',
  ])
  expect(new Set(paths).size).toBe(paths.length)
})

it('collects during CSV row parsing without another EXD scan', async () => {
  const { reader, definitions, headers } = fixture()
  const collector = new AssetReferenceCollector()
  const csv = new CSVExporter({ definitions, assetReferences: collector })
  // exportSheet only uses readFile on the supplied reader.
  await csv.exportSheet(reader as Parameters<CSVExporter['exportSheet']>[0], 'Sub', headers.get('Sub')!, 1)
  expect(collector.toJSON().icons).toEqual([101, 111])
})

it('surfaces a missing referenced EXD page rather than claiming a complete scan', async () => {
  const { reader, definitions, files } = fixture()
  files.delete(getExdPath('Item', 10, 2))
  await expect(collectAssetReferences(reader, definitions)).rejects.toThrow('Missing EXD resource')
})

it('reads only reference columns, without decoding unrelated string payloads', async () => {
  const { files, headers, reader } = fixture()
  const header: ExhHeader = { ...headers.get('Item')!, dataOffset: 8, columnCount: 2,
    columns: [{ offset: 0, type: ExcelColumnDataType.UInt32 }, { offset: 4, type: ExcelColumnDataType.String }],
    languages: [0], languageCount: 1, paginations: [{ startId: 0, rowCount: 1 }], pageCount: 1,
  }
  const writer = new EXDWriter(header)
  writer.writeRows([{ rowId: 1, data: [51474, Buffer.from('unused')] }])
  const data = writer.output()
  data.writeUInt32BE(0xffffffff, data.readUInt32BE(36) + 6 + 4)
  files.set('exd/root.exl', writeExlFile({ magic: 'EXLT', version: 2, entries: [{ name: 'Item', id: 1 }] }))
  files.set('exd/Item.exh', writeExhHeader(header))
  files.set('exd/Item_0.exd', data)
  const result = await collectAssetReferences(reader, { getFlatFields: async () => [
    { index: 0, name: 'Icon', link: 'Image' }, { index: 1, name: 'Description' },
  ] })
  expect(result.references.icons).toEqual([51474])
})
