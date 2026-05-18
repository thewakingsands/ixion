import { mkdir, readFile as readBuffer, rm } from 'node:fs/promises'
import { VirtualFileSystem, ZipatchReader } from '@ffcafe/ixion-zipatch'

const MAX_IN_MEMORY_FILE_SIZE = 10 * 1024 * 1024
export class PatchFileSystem extends VirtualFileSystem {
  constructor(root: string, allowList?: string[]) {
    super(root, allowList)
  }

  async applyPatch(patchPath: string) {
    const reader = await ZipatchReader.open(patchPath)

    try {
      await reader.apply(this)
    } finally {
      await reader.close()
    }
  }

  async readFile(path: string, start = 0, end?: number) {
    const ranges = this.getFileRanges(path)
    if (!ranges) {
      return null
    }

    if (!end) {
      end = ranges.reduce((max, range) => Math.max(max, range.end), 0)
    }

    const size = end - start
    if (size > MAX_IN_MEMORY_FILE_SIZE) {
      throw new Error(
        `Requested file size (${size}) exceeds limit (${MAX_IN_MEMORY_FILE_SIZE})`,
      )
    }

    const buffer = Buffer.alloc(size)
    let pendingRanges: Array<[number, number]> = [[start, end]]

    for (let i = ranges.length - 1; i >= 0; --i) {
      const range = ranges[i]
      const nextPendingRanges: Array<[number, number]> = []

      for (const [pendingStart, pendingEnd] of pendingRanges) {
        const overlapStart = Math.max(pendingStart, range.start)
        const overlapEnd = Math.min(pendingEnd, range.end)

        if (overlapStart >= overlapEnd) {
          nextPendingRanges.push([pendingStart, pendingEnd])
          continue
        }

        if (pendingStart < overlapStart) {
          nextPendingRanges.push([pendingStart, overlapStart])
        }
        if (overlapEnd < pendingEnd) {
          nextPendingRanges.push([overlapEnd, pendingEnd])
        }

        if (range.type === 'erase') {
          buffer.fill(0, overlapStart - start, overlapEnd - start)
          continue
        }

        const data = await readBuffer(range.dataPath)
        const dataStart = overlapStart - range.start
        const dataEnd = overlapEnd - range.start
        data.copy(buffer, overlapStart - start, dataStart, dataEnd)
      }

      if (nextPendingRanges.length === 0) {
        return buffer
      }

      pendingRanges = nextPendingRanges
    }

    // cannot fulfill the request
    return null
  }
}
