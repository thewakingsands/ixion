import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { servers } from '@ffcafe/ixion-server'
import {
  getExdPath,
  readExhHeader,
  readExlFile,
  SqPackReader,
} from '@ffcafe/ixion-sqpack'
import type { StorageManager } from '@ffcafe/ixion-storage'
import type { Language } from '@ffcafe/ixion-utils'
import { exdSqPackFile } from '../config'
import { getTempDir } from '../utils/root'
import { getServerLanguages } from '../utils/server'

export async function verifyExdFilesFromReader(
  reader: SqPackReader,
  languages: Language[],
): Promise<{
  success: boolean
  missingFiles: string[]
}> {
  const rootData = await reader.readFile('exd/root.exl')
  if (!rootData) {
    throw new Error('Failed to read root.exl')
  }

  const rootExl = readExlFile(rootData)
  const missingFiles: string[] = []
  for (const entry of rootExl.entries) {
    const exhFile = `exd/${entry.name}.exh`
    const exhData = await reader.readFile(exhFile)
    if (!exhData) {
      missingFiles.push(exhFile)
      continue
    }

    const exhHeader = readExhHeader(exhData)
    for (const language of exhHeader.languages) {
      if (!languages.includes(language)) {
        continue
      }

      for (const pagination of exhHeader.paginations) {
        const exdFile = getExdPath(entry.name, pagination.startId, language)
        const hasExdFile = await reader.hasFile(exdFile)
        if (!hasExdFile) {
          missingFiles.push(exdFile)
        }
      }
    }
  }

  return {
    success: missingFiles.length === 0,
    missingFiles,
  }
}

export async function verifyExdFiles(
  workspaceDir: string,
  languages: Language[],
) {
  const reader = await SqPackReader.open({
    prefix: join(workspaceDir, exdSqPackFile),
  })

  try {
    const result = await verifyExdFilesFromReader(reader, languages)
    if (!result.success) {
      throw new Error(`Missing EXD files: ${result.missingFiles.join(', ')}`)
    }
    console.log(`✅ All EXD files verified`)
  } finally {
    await reader.close()
  }
}

export async function verifyExdFilesFromStorage(
  storageManager: StorageManager,
  server: string,
  version: string,
): Promise<{ success: boolean; missingFiles: string[] }> {
  const tempDir = await getTempDir()
  try {
    await storageManager.downloadVersion(server, version, tempDir)

    const sqPackPrefix = join(tempDir, exdSqPackFile)
    const reader = await SqPackReader.open({ prefix: sqPackPrefix })
    const languages = getServerLanguages(server)

    try {
      return await verifyExdFilesFromReader(reader, languages)
    } finally {
      await reader.close()
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}
