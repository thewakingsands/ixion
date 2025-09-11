/**
 * File Header (FHDR) chunk processor
 * Contains metadata about the patch file and information it contains.
 */

import $debug from 'debug'
import { SmartBuffer } from 'smart-buffer'
import type { ZipatchChunkHandler } from '../interface'

const debug = $debug('zipatch:fhdr')

/**
 * Process a file header chunk
 */
export const processFileHeader: ZipatchChunkHandler = async (chunk) => {
  // File header contains metadata about the patch
  // For extraction purposes, we mainly need to validate it
  if (chunk.size < 8) {
    throw new Error(`Invalid file header chunk: ${chunk.size} bytes`)
  }

  const { buffer } = await chunk.read(null, chunk.size)
  const buf = SmartBuffer.fromBuffer(buffer)
  const version = buffer[2]

  buf.readOffset = 4
  const patchType = buf.readString(4)

  debug(`version=${version}, type=${patchType}`)
}
