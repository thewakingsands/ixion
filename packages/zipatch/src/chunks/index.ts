/**
 * Chunk processor exports
 */

import type {
  ZipatchChunk,
  ZipatchChunkHandler,
  ZipatchContext,
} from '../interface'
import { processAddDirectory, processDeleteDirectory } from './directory'
import { processFileHeader } from './fhdr'
import { processSqPack } from './sqpk'

const chunks: Record<
  string,
  {
    handler?: ZipatchChunkHandler
    skip?: boolean
  }
> = {
  FHDR: { handler: processFileHeader },
  APLY: { skip: true },
  ADIR: { handler: processAddDirectory },
  DELD: { skip: true, handler: processDeleteDirectory },
  SQPK: { handler: processSqPack },
  EOF_: { skip: true },
}

export const processChunk = async (
  chunk: ZipatchChunk,
  context: ZipatchContext,
): Promise<boolean> => {
  const chunkDef = chunks[chunk.name]
  if (!chunkDef) {
    console.warn(`Unknown chunk: ${chunk.name}`)
    return false
  }

  if (chunkDef.skip || !chunkDef.handler) {
    return false
  }

  await chunkDef.handler(chunk, context)

  return true
}
