import { open } from 'node:fs/promises'
import type { ZipatchDataSource } from './interface'

export const createFileDataSource = async (
  path: string,
): Promise<ZipatchDataSource> => {
  const handle = await open(path)
  const stat = await handle.stat()

  return {
    fileSize: stat.size,
    readAt: async (offset, length, buf) => {
      if (offset >= stat.size) {
        throw new Error('Moved out of file')
      }

      return handle.read(buf || Buffer.alloc(length), 0, length, offset)
    },
    close: async () => {
      await handle.close()
    },
  }
}
