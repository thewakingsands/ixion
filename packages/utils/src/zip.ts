import { createWriteStream, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import * as yauzl from 'yauzl'
import * as yazl from 'yazl'

/**
 * Internal function to handle writing compressed data to a writable stream.
 * @param sourcePath - Path to the directory to compress
 * @param onStreamReady - Callback to handle the yazl outputStream (Writable)
 * @returns Promise that resolves when compression is complete
 */
async function compressDirectoryStream(
  sourcePath: string,
  onStreamReady: (
    stream: NodeJS.ReadableStream,
    zipfile: yazl.ZipFile,
  ) => void | Promise<void>,
): Promise<void> {
  const zipfile = new yazl.ZipFile()
  onStreamReady(zipfile.outputStream, zipfile)
  await addDirectoryToZip(zipfile, sourcePath, '')
  zipfile.end()
}

/**
 * Compress a directory to a zip file buffer
 * @param sourcePath - Path to the directory to compress
 * @returns Promise that resolves to the zip file buffer
 */
export async function compressDirectoryToBuffer(
  sourcePath: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    compressDirectoryStream(sourcePath, (stream) => {
      stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })
      stream.on('end', () => {
        resolve(Buffer.concat(chunks))
      })
      stream.on('error', reject)
    }).catch(reject)
  })
}

/**
 * Compress a directory to a zip file on disk
 * @param sourcePath - Path to the directory to compress
 * @param destPath - File path for the resulting zip file
 * @returns Promise that resolves when the file is written
 */
export async function compressDirectoryToFile(
  sourcePath: string,
  destPath: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    compressDirectoryStream(sourcePath, (stream) => {
      const writable = createWriteStream(destPath)
      stream.pipe(writable)
      stream.on('error', reject)
      writable.on('error', reject)
      writable.on('finish', resolve)
    }).catch(reject)
  })
}

/**
 * Recursively add directory contents to zip
 * @param zipfile - The yazl ZipFile instance
 * @param dirPath - Path to the directory to add
 * @param zipPath - Path within the zip file
 */
export async function addDirectoryToZip(
  zipfile: yazl.ZipFile,
  dirPath: string,
  zipPath: string,
): Promise<void> {
  const { readdirSync } = await import('node:fs')

  const entries = readdirSync(dirPath, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name)
    const entryZipPath = zipPath ? `${zipPath}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      await addDirectoryToZip(zipfile, fullPath, entryZipPath)
    } else {
      zipfile.addFile(fullPath, entryZipPath)
    }
  }
}

/**
 * Decompress a zip buffer to a directory
 * @param zipBuffer - The zip file buffer
 * @param targetPath - Path where to extract the files
 * @returns Promise that resolves when extraction is complete
 */
export async function decompressToDirectory(
  zipBuffer: Buffer,
  targetPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(zipBuffer, { lazyEntries: true }, (err, zipfile) => {
      if (err) {
        reject(err)
        return
      }

      if (!zipfile) {
        reject(new Error('Failed to open zip file'))
        return
      }

      zipfile.readEntry()
      zipfile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) {
          // Directory entry
          const dirPath = join(targetPath, entry.fileName)
          mkdirSync(dirPath, { recursive: true })
          zipfile.readEntry()
        } else {
          // File entry
          zipfile.openReadStream(entry, (err, readStream) => {
            if (err) {
              reject(err)
              return
            }

            if (!readStream) {
              reject(new Error('Failed to open read stream'))
              return
            }

            const filePath = join(targetPath, entry.fileName)
            mkdirSync(join(filePath, '..'), { recursive: true })

            const writeStream = createWriteStream(filePath)
            readStream.pipe(writeStream)

            writeStream.on('close', () => {
              zipfile.readEntry()
            })

            writeStream.on('error', reject)
          })
        }
      })

      zipfile.on('end', resolve)
      zipfile.on('error', reject)
    })
  })
}

/**
 * Compress a single file to a zip buffer
 * @param filePath - Path to the file to compress
 * @param zipFileName - Name of the file within the zip
 * @returns Promise that resolves to the zip file buffer
 */
export async function compressFile(
  filePath: string,
  zipFileName?: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zipfile = new yazl.ZipFile()
    const chunks: Buffer[] = []

    zipfile.outputStream.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })

    zipfile.outputStream.on('end', () => {
      resolve(Buffer.concat(chunks))
    })

    zipfile.outputStream.on('error', reject)

    const fileName = zipFileName || filePath.split('/').pop() || 'file'
    zipfile.addFile(filePath, fileName)
    zipfile.end()
  })
}

/**
 * Get the size of a zip file buffer
 * @param zipBuffer - The zip file buffer
 * @returns The size in bytes
 */
export function getZipSize(zipBuffer: Buffer): number {
  return zipBuffer.length
}

/**
 * Check if a buffer contains a valid zip file
 * @param buffer - The buffer to check
 * @returns True if the buffer contains a valid zip file
 */
export function isZipFile(buffer: Buffer): boolean {
  // ZIP file signature: PK (0x504B)
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b
}
