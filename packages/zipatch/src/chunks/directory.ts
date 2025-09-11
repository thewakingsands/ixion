import $debug from 'debug'
import { SmartBuffer } from 'smart-buffer'
import type { ZipatchChunk, ZipatchChunkHandler } from '../interface'

const debug = $debug('zipatch:dir')

/**
 * Directory operation chunk processors
 * Handles ADIR (Add Directory) and DELD (Delete Directory) chunks
 */
const parseDirectoryChunk = async (chunk: ZipatchChunk) => {
  const { buffer } = await chunk.read(null, chunk.size)
  const buf = SmartBuffer.fromBuffer(buffer)
  const pathLength = buf.readUInt32BE()
  if (chunk.size < 4 + pathLength) {
    throw new Error(`Invalid directory chunk length: ${chunk.size} bytes`)
  }

  return buf.readString(pathLength)
}

/**
 * Process an add directory (ADIR) chunk
 */
export const processAddDirectory: ZipatchChunkHandler = async (
  chunk,
  context,
) => {
  const path = await parseDirectoryChunk(chunk)
  await context.fs.createDirectory(path, true)
  debug(`Created directory: ${path}`)
}

/**
 * Process a delete directory (DELD) chunk
 */
export const processDeleteDirectory: ZipatchChunkHandler = async (
  chunk,
  context,
) => {
  const path = await parseDirectoryChunk(chunk)
  await context.fs.removeDirectory(path, true)
  debug(`Deleted directory: ${path}`)
}
