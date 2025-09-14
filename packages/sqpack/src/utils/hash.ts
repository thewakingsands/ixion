import { createHash } from 'node:crypto'

/**
 * CRC32 table for fast CRC32 calculation
 */
const CRC32_TABLE = new Uint32Array(256)

// Initialize CRC32 table
for (let i = 0; i < 256; i++) {
  let c = i
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  CRC32_TABLE[i] = c
}

/**
 * Calculate CRC32 hash
 */
export const crc32 = (data: Buffer | string): number => {
  const buffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
  let crc = 0xffffffff

  for (let i = 0; i < buffer.length; i++) {
    crc = CRC32_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  }

  // Return the 32-bit unsigned integer
  return ~(crc ^ 0xffffffff) >>> 0
}

/**
 * Merge directory and filename hash into a 64-bit hash
 */
export const mergeIndexHash = (dirHash: number, fileHash: number): bigint => {
  return (BigInt(dirHash) << 32n) | BigInt(fileHash)
}

/**
 * Calculate hash for index files (directory + filename)
 * @see https://xiv.dev/data-files/sqpack#reading-index
 */
export const calculateIndexHash = (filePath: string) => {
  // Convert to lowercase
  const path = filePath.toLowerCase()

  // Find the last instance of '/' and split
  const lastSlashIndex = path.lastIndexOf('/')
  if (lastSlashIndex === -1) {
    throw new Error(`Invalid file path: ${filePath}`)
  }

  const directory = path.substring(0, lastSlashIndex)
  const filename = path.substring(lastSlashIndex + 1)

  // Calculate CRC32 of both parts
  const dirHash = crc32(directory)
  const fileHash = crc32(filename)

  return mergeIndexHash(dirHash, fileHash)
}

/**
 * Calculate hash for index2 files (entire path)
 * @see https://xiv.dev/data-files/sqpack#reading-index2
 */
export const calculateIndex2Hash = (filePath: string): number => {
  // Convert to lowercase
  const path = filePath.toLowerCase()

  // Calculate CRC32 of entire path
  return crc32(path)
}

export const sqPackHashSize = 0x40

/**
 * Calculate SHA1 hash
 */
export const calculateSqPackHash = (input: Buffer): Buffer => {
  const buffer = Buffer.alloc(sqPackHashSize)
  const hash = createHash('sha1').update(input).digest()
  buffer.set(hash)

  return buffer
}

/**
 * Parse SHA1 hash from hex string
 */
export const parseSqPackHashFromHex = (input: string): Buffer => {
  const buffer = Buffer.alloc(sqPackHashSize)
  buffer.set(Buffer.from(input, 'hex'))

  return buffer
}

/**
 * Create empty SHA1 hash
 */
export const createEmptySqPackHash = (): Buffer => {
  return Buffer.alloc(sqPackHashSize, 0)
}
