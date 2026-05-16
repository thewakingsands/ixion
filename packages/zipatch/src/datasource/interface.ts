export interface ZipatchPreloadedChunk {
  name: string
  size: number
  offset: number
}

export interface ZipatchPreloadData {
  fileSize: number
  chunks: ZipatchPreloadedChunk[]
}

export interface ZipatchOpenOptions {
  chunks?: ZipatchPreloadData
  preloaded?: ZipatchPreloadData
}

export interface ZipatchDataSource {
  fileSize: number
  readAt: (
    offset: number,
    length: number,
    buf?: Buffer | null,
  ) => Promise<{ bytesRead: number; buffer: Buffer }>
  close: () => Promise<void>
}
