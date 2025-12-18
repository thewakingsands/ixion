import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { SqPackReader } from '@ffcafe/ixion-sqpack'
import type { Language } from '@ffcafe/ixion-utils'
import { exdSqPackFile } from '../config'
import { getTempDir } from '../utils/root'
import { getServerLanguages } from '../utils/server'
import { getStorageManager } from '../utils/storage'

export interface ServerVersion {
  server: string
  version?: string
  sqpackPrefix?: string
}

export interface ServerReader {
  server: string
  version: string
  languages: Language[]
  reader: SqPackReader
}

export function parseServerVersions(mappings?: string[]): ServerVersion[] {
  if (!mappings) {
    console.error('❌ mapping is required')
    console.log('Example: -m sdo -m actoz:2024.01.02.0000.0000')
    process.exit(1)
  }

  // Parse server:version mappings
  const serverVersions: ServerVersion[] = []

  for (const mapping of mappings) {
    const [server, version] = mapping.split(':')
    serverVersions.push({
      server: server.trim(),
      version: version?.trim(),
    })
  }

  if (serverVersions.length === 0) {
    console.error('❌ No valid server:version mappings provided')
    process.exit(1)
  }

  return serverVersions
}

export class ExdBase {
  readers: Array<ServerReader> = []
  tempDirs: string[] = []
  languages: Language[] = []

  constructor(private readonly serverVersions: ServerVersion[]) {
    const languages = new Set<Language>()
    for (const { server } of serverVersions) {
      for (const language of getServerLanguages(server)) {
        languages.add(language)
      }
    }

    this.languages = Array.from(languages)
  }

  get firstReader() {
    return this.readers[0].reader
  }

  async prepareReaders() {
    const storageManager = getStorageManager()
    // Download all versions to temporary directories
    for (const { server, version: inputVersion, sqpackPrefix } of this
      .serverVersions) {
      let version = inputVersion || null
      if (!version) {
        version = await storageManager.getLatestVersion(server)
        if (!version) {
          throw new Error(`❌ No versions found for server ${server}`)
        }
      }

      let prefix = sqpackPrefix
      if (!prefix) {
        const tempDir = await getTempDir()
        this.tempDirs.push(tempDir)

        await storageManager.downloadVersion(server, version, tempDir)
        console.log(`✅ Downloaded EXD files for ${server} ${version}`)
        prefix = join(tempDir, exdSqPackFile)
      }

      const reader = await SqPackReader.open({ prefix })
      this.readers.push({
        reader,
        server,
        version,
        languages: getServerLanguages(server),
      })
    }
  }

  async close() {
    // Clean up readers
    for (const { reader } of this.readers) {
      await reader.close()
    }

    // Clean up temporary directories
    for (const tempDir of this.tempDirs) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  }
}
