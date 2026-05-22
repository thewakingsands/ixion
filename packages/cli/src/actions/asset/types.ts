export type EncodedAssetFormat = 'webp' | 'avif'
export type AssetFormat = EncodedAssetFormat | 'tex'

export interface IconEntry {
  id: number
  version: string
  hr: boolean
  sha256: string
  format: AssetFormat
  path: string
}

export interface CurrentReference {
  ffxiv?: string
}
