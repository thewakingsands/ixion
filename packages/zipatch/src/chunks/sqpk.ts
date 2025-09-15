import { inflateRawSync } from 'node:zlib'
import $debug from 'debug'
import { SmartBuffer } from 'smart-buffer'
import type { FileSystem } from '../fs'
import type { ZipatchChunkHandler } from '../interface'
import {
  type FileHeader,
  readFileBlockHeader,
  readFileHeader,
} from '../structs/file-header'
import { readSqpkAddData } from '../structs/sqpk-add-data'
import {
  createEmptyBlockHeader,
  readSqpkDataHeader,
} from '../structs/sqpk-data-header'
import { getSqpkFilePath } from '../structs/sqpk-file'
import {
  FileKind,
  HeaderKind,
  readSqpkHeaderUpdate,
} from '../structs/sqpk-header-update'

const debug = $debug('zipatch:sqpk')

/**
 * SqPack (SQPK) chunk processor
 * Handles SqPack-based game install operations
 */

type SqpkHandler = (buffer: SmartBuffer, fs: FileSystem) => Promise<void>

const eraseHandler: SqpkHandler = async (buffer, fs) => {
  const payload = readSqpkDataHeader(buffer)
  const path = getSqpkFilePath(payload.file, false)

  debug(
    '[D/E] file %s, offset %d, erase %d',
    path,
    payload.byteOffset,
    payload.byteCount,
  )

  const blockHeader = createEmptyBlockHeader(payload.blockCount - 1)
  await fs.write(path, blockHeader, payload.byteOffset)

  if (payload.byteCount > 1) {
    // Skip the block header
    const offset = payload.byteOffset + blockHeader.length
    const length = payload.byteCount - blockHeader.length
    await fs.erase(path, length, offset)
  }
}

const blockHeaderSize = 16
const addFileHandler = async (
  fileHeader: FileHeader,
  buffer: SmartBuffer,
  fs: FileSystem,
) => {
  const handle = await fs.getFileHandle(fileHeader.filePath)
  if (!handle) {
    return
  }

  let bytesWritten = 0
  while (buffer.readOffset + blockHeaderSize < buffer.length) {
    const pos = buffer.readOffset
    const blockHeader = readFileBlockHeader(buffer)

    // Validate the block header values
    if (
      blockHeader.headerSize !== blockHeaderSize ||
      blockHeader.compressedSize === 0 ||
      blockHeader.decompressedSize === 0
    ) {
      console.warn(
        `Invalid block header at offset ${pos}, stopping block parsing`,
      )
      break
    }

    // Validate that the aligned size is reasonable
    if (
      blockHeader.alignedBlockSize <= 0 ||
      blockHeader.alignedBlockSize > buffer.length - pos
    ) {
      console.warn(
        `Invalid aligned size ${blockHeader.alignedBlockSize} at offset ${pos}, stopping block parsing`,
      )
      break
    }

    // Write the block to the file
    const offset = Number(fileHeader.offset) + bytesWritten
    const data = buffer.readBuffer(blockHeader.blockSize)
    if (blockHeader.isBlockCompressed) {
      const inflated = inflateRawSync(data)
      await handle.write(inflated, 0, inflated.length, offset)
      bytesWritten += inflated.length
    } else {
      await handle.write(data, 0, data.length, offset)
      bytesWritten += data.length
    }

    // Move the buffer pointer to the next block
    buffer.readOffset = pos + blockHeader.alignedBlockSize
  }

  debug(`[F:A] file %s, wrote %d`, fileHeader.filePath, bytesWritten)
}

const fileOperationHandler: SqpkHandler = async (buffer, fs) => {
  const header = readFileHeader(buffer)
  if (!fs.isPathAllowed(header.filePath)) {
    return
  }

  // 'A' - Add file
  if (header.operation === 0x41) {
    return addFileHandler(header, buffer, fs)
  }

  switch (header.operation) {
    case 0x44: // 'D' - Delete file
      debug(`Would delete file: ${header.filePath}`)
      break

    case 0x52: // 'R' - Remove all
      debug(`Would remove all files in: ${header.filePath}`)
      break

    case 0x4d: // 'M' - Make directory tree
      debug(`Would create directory tree for: ${header.filePath}`)
      break

    default:
      debug(`Unknown file operation: 0x${header.operation.toString(16)}`)
      break
  }
}

const commands: Record<
  string,
  {
    handler?: SqpkHandler
    skip?: boolean
  }
> = {
  // Add Data
  A: {
    async handler(buffer, fs) {
      const payload = readSqpkAddData(buffer)

      const path = getSqpkFilePath(payload.file, false)
      if (!fs.isPathAllowed(path)) {
        return
      }

      debug(
        '[A] file %s offset %d, write %d, erase %d',
        path,
        payload.byteOffset,
        payload.byteCount,
        payload.byteDeleteCount,
      )
      await fs.write(path, payload.data, payload.byteOffset)

      if (payload.byteDeleteCount > 0) {
        const deleteOffset = payload.byteOffset + payload.byteCount
        await fs.erase(path, payload.byteDeleteCount, deleteOffset)
      }
    },
  },
  // Delete Data
  D: { handler: eraseHandler },
  // Expand Data
  E: { handler: eraseHandler },
  // File Operation
  F: { handler: fileOperationHandler },
  // Header Update
  H: {
    async handler(buffer, fs) {
      const payload = readSqpkHeaderUpdate(buffer)
      const isIndex = payload.fileKind === FileKind.Index
      const isVersion = payload.headerKind === HeaderKind.Version

      const path = getSqpkFilePath(payload.file, isIndex)
      if (!fs.isPathAllowed(path)) {
        return
      }

      debug(
        '[H] file %s, kind %d, header %d',
        path,
        payload.fileKind,
        payload.headerKind,
      )
      await fs.write(path, payload.data, isVersion ? 0 : 1024)
    },
  },
  // Index Update
  I: { skip: true },
  // Target Info
  T: { skip: true },
  // Patch Info
  X: { skip: true },
}

/**
 * Process a SqPack chunk
 */
export const processSqPack: ZipatchChunkHandler = async (
  chunk,
  context,
): Promise<void> => {
  if (chunk.size < 5) {
    throw new Error('Invalid SqPack chunk')
  }

  const { buffer } = await chunk.read(null, chunk.size)
  const size = buffer.readUInt32BE()
  const command = String.fromCharCode(buffer[4])

  if (chunk.size < size) {
    throw new Error('Invalid SqPack chunk - insufficient data')
  }

  const commandDef = commands[command]
  if (!commandDef) {
    console.warn(`Unknown command: ${command}`)
    return
  }

  if (commandDef.skip || !commandDef.handler) {
    return
  }

  const buf = SmartBuffer.fromBuffer(buffer.subarray(5, size))
  await commandDef.handler(buf, context.fs)
}
