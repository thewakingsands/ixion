/**
 * SqPack interfaces based on XIV Dev documentation
 * @see https://xiv.dev/data-files/sqpack#reading-index-data
 */

export enum PlatformId {
  Win32 = 0,
  PS3 = 1,
  PS4 = 2,
}

export interface SqPackFileIndex {
  path: string
  dataFileId: number
  offset: number
  size?: number
}

export interface SqPackRepository {
  name: string
  path: string
  categories: Map<string, SqPackCategory>
}

export interface SqPackCategory {
  name: string
  indexFile: string
  index2File?: string
  dataFiles: string[]
}

export enum Language {
  None,
  Japanese,
  English,
  German,
  French,
  ChineseSimplified,
  ChineseTraditional,
  Korean,
  ChineseTraditional2,
}
