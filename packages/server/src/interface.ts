export interface PatchHash {
  type: string
  blockSize: number
  values: string[]
}

export interface PatchEntry {
  patchSize: number
  version: string
  hash: PatchHash | null
  url: string
  expansion: string
  repository: string
}

export interface GameVersions {
  boot: string
  ffxiv: string
  expansions: Record<string, string>
}
