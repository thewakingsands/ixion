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

export interface MapEntry {
  territory: string
  index: string
  variant: '_m' | 'm_m' | 'd'
  sha256: string
  format: AssetFormat
  path: string
}

export type UiAssetEntry = IconEntry | MapEntry

export interface CurrentReference {
  ffxiv?: string
  lastValidIndex?: string
}
