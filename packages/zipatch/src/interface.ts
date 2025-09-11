import type { FileSystem } from './fs'

export interface ZipatchContext {
  platform: 'win32'
  workspace: string
  allowList: string[]
  fs: FileSystem
}

export interface ZipatchChunk {
  name: string
  size: number
  read: (
    buf: Buffer | null,
    length: number,
  ) => Promise<{ bytesRead: number; buffer: Buffer }>
}

export type ZipatchChunkHandler = (
  chunk: ZipatchChunk,
  context: ZipatchContext,
) => Promise<void>
