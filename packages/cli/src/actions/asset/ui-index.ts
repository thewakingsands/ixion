import { readIndexEntries } from '@ffcafe/ixion-sqpack'
import { uiSqPackFile } from '../../config'
import type { PatchFileSystem } from '../../utils/patch-fs'
import {
  type ResolvedIndexMap,
  resolveIndexMap,
} from '../../utils/sqpack-index'

const sqpackHeaderSize = 0x400
const indexHeaderSize = 0x400

export async function validateIndexFile(
  fs: PatchFileSystem,
  dirHashMap: Map<number, string>,
): Promise<ResolvedIndexMap | null> {
  const buffer = await fs.readFile(`${uiSqPackFile}.index`)

  if (!buffer || buffer.length < sqpackHeaderSize + indexHeaderSize) {
    return null
  }

  try {
    const parsed = readIndexEntries(buffer, false)
    return resolveIndexMap({
      ...parsed,
      dirHashMap,
      fileNameGenerator: generateIconFileNames,
    })
  } catch {
    return null
  }
}

function generateIconFileNames(dirPath: string) {
  const match = dirPath.match(/^ui\/icon\/(\d{3})000/)
  if (!match) {
    return []
  }

  const startId = Number.parseInt(match[1], 10) * 1000
  const fileNames: string[] = []

  for (let id = startId; id < startId + 1000; id += 1) {
    const paddedId = id.toString().padStart(6, '0')
    fileNames.push(`${paddedId}.tex`)
    fileNames.push(`${paddedId}_hr1.tex`)
  }

  return fileNames
}
