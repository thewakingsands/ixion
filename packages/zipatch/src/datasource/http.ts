import type { ZipatchDataSource, ZipatchPreloadData } from './interface'

export const createHttpDataSource = async (
  url: string,
  preloaded?: ZipatchPreloadData,
): Promise<ZipatchDataSource> => {
  const fileSize = preloaded?.fileSize ?? (await getHttpFileSize(url))

  return {
    fileSize,
    readAt: async (offset, length, buf) => {
      if (offset >= fileSize) {
        throw new Error('Moved out of file')
      }

      const end = Math.min(offset + length - 1, fileSize - 1)
      const response = await fetch(url, {
        headers: {
          Range: `bytes=${offset}-${end}`,
        },
      })

      if (!(response.ok || response.status === 206)) {
        throw new Error(
          `Failed to read zipatch range ${offset}-${end}: ${response.status} ${response.statusText}`,
        )
      }

      const body = Buffer.from(await response.arrayBuffer())
      const buffer = buf || Buffer.alloc(body.length)
      body.copy(buffer, 0, 0, body.length)

      return {
        bytesRead: body.length,
        buffer,
      }
    },
    close: async () => {},
  }
}

const getHttpFileSize = async (url: string): Promise<number> => {
  const head = await fetch(url, { method: 'HEAD' })
  const contentLength = head.headers.get('content-length')
  if (head.ok && contentLength) {
    return Number.parseInt(contentLength, 10)
  }

  const response = await fetch(url, {
    headers: {
      Range: 'bytes=0-0',
    },
  })
  if (!(response.ok || response.status === 206)) {
    throw new Error(
      `Failed to read zipatch size from ${url}: ${response.status} ${response.statusText}`,
    )
  }

  const contentRange = response.headers.get('content-range')
  if (!contentRange) {
    throw new Error(`Server did not return content-range for ${url}`)
  }

  const match = contentRange.match(/\/(\d+)$/)
  if (!match) {
    throw new Error(`Invalid content-range header: ${contentRange}`)
  }

  return Number.parseInt(match[1], 10)
}

export const isHttpUrl = (path: string) => /^https?:\/\//i.test(path)
