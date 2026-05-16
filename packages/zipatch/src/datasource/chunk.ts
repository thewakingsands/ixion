import type { ZipatchChunk } from '../interface'
import type { ZipatchDataSource, ZipatchPreloadedChunk } from './interface'

export const createChunkReader = (
  source: ZipatchDataSource,
  chunk: ZipatchPreloadedChunk,
): ZipatchChunk => {
  let pos = chunk.offset
  const end = chunk.offset + chunk.size

  return {
    name: chunk.name,
    size: chunk.size,
    read: async (buf, length) => {
      if (pos >= end) {
        throw new Error('Moved out of chunk')
      }

      const remaining = end - pos
      const readLength = Math.min(length, remaining)
      const ret = await source.readAt(pos, readLength, buf)
      pos += ret.bytesRead
      return ret
    },
  }
}
