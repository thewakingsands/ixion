import { existsSync, mkdirSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AbstractStorage, LocalStorage } from '@ffcafe/ixion-storage'
import { SingleBar } from 'cli-progress'
import { baseGameVersion, uiSqPackFile } from '../../config'
import { PatchFileSystem } from '../../utils/patch-fs'
import { getStorageManager } from '../../utils/storage'
import type { CurrentReference, EncodedAssetFormat, IconEntry } from './types'

const { formatTex } = await import('@ffcafe/ixion-tex')

const allowList = [`${uiSqPackFile}.*`]
const uiStoragePathKey = 'ui'
const assetFileListPath = 'asset-files.json'
const syncConcurrency = 128
const pathSegment = {
  patches: 'patches',
  assets: 'assets',
  diff: '.diff',
  currentRef: 'current.json',
} as const

export interface AssetStorageOptions {
  server: string
  storage?: string
}

export class AssetStorage {
  readonly server: string
  readonly outputRoot: string
  readonly patchRoot: string
  readonly assetRoot: string
  readonly diffRoot: string
  readonly currentRefPath: string
  readonly fs: PatchFileSystem

  private readonly localStorage: LocalStorage
  private readonly remoteStorage: AbstractStorage | null
  private readonly remoteStorageName?: string
  private existingAssets = new Map<string, EncodedAssetFormat>()

  constructor(options: AssetStorageOptions) {
    this.server = options.server

    const storageManager = getStorageManager()
    const localStorage = storageManager.findLocalStorage()
    if (!localStorage) {
      throw new Error('Required at least one valid local storage')
    }

    this.localStorage = localStorage
    this.outputRoot = localStorage.getRootPath(uiStoragePathKey, this.server)
    this.patchRoot = join(this.outputRoot, pathSegment.patches)
    this.assetRoot = join(this.outputRoot, pathSegment.assets)
    this.diffRoot = join(this.outputRoot, pathSegment.diff)
    this.currentRefPath = join(this.outputRoot, pathSegment.currentRef)

    mkdirSync(this.outputRoot, { recursive: true })
    mkdirSync(this.patchRoot, { recursive: true })
    mkdirSync(this.assetRoot, { recursive: true })
    mkdirSync(this.diffRoot, { recursive: true })

    this.remoteStorageName = 'storage' in options ? options.storage : undefined
    if (this.remoteStorageName) {
      const remoteStorage = storageManager.getStorage(this.remoteStorageName)
      if (!remoteStorage) {
        throw new Error(
          `Storage '${this.remoteStorageName}' not found. Available storages: ${storageManager
            .getStorageNames()
            .join(', ')}`,
        )
      }
      this.remoteStorage = remoteStorage
    } else {
      this.remoteStorage = null
    }

    this.fs = new PatchFileSystem(this.diffRoot, allowList)
  }

  hasRemoteStorage(): boolean {
    return this.remoteStorage !== null
  }

  getRemoteStorageName(): string {
    if (!this.remoteStorageName) {
      throw new Error('Remote storage is not configured')
    }

    return this.remoteStorageName
  }

  async loadCurrentReference(): Promise<Required<CurrentReference>> {
    const current = await this.readJson<CurrentReference>(
      pathSegment.currentRef,
    )
    const ffxiv = current?.ffxiv || baseGameVersion
    return {
      ffxiv,
      lastValidIndex: current?.lastValidIndex || ffxiv,
    }
  }

  async loadLocalCurrentReference(): Promise<Required<CurrentReference>> {
    const current = await this.readLocalJson<CurrentReference>(
      pathSegment.currentRef,
    )
    const ffxiv = current?.ffxiv || baseGameVersion
    return {
      ffxiv,
      lastValidIndex: current?.lastValidIndex || ffxiv,
    }
  }

  async loadExistingAssets(
    version: string,
  ): Promise<Map<string, EncodedAssetFormat>> {
    this.existingAssets = this.remoteStorage
      ? await this.loadRemoteExistingAssets(version)
      : await this.scanLocalExistingAssets()
    return this.existingAssets
  }

  getAssetFileList(): string[] {
    return createAssetFileList(this.existingAssets)
  }

  async loadIconState(version: string): Promise<Map<string, IconEntry>> {
    const remoteContent = await this.readRemoteJson<
      Array<Omit<IconEntry, 'path'>>
    >(`${pathSegment.patches}/${version}/icons.json`)
    if (remoteContent) {
      return createIconStateMap(remoteContent)
    }

    const localContent = await this.readLocalJson<
      Array<Omit<IconEntry, 'path'>>
    >(`${pathSegment.patches}/${version}/icons.json`)
    if (!localContent) {
      return new Map<string, IconEntry>()
    }

    return createIconStateMap(localContent)
  }

  async writePatchJson(
    version: string,
    fileName: string,
    value: unknown,
  ): Promise<void> {
    await this.writeJson(`${pathSegment.patches}/${version}/${fileName}`, value)
  }

  async writeCurrentReference(current: CurrentReference): Promise<void> {
    const ffxiv = current.ffxiv || baseGameVersion
    await this.writeJson<CurrentReference>(pathSegment.currentRef, {
      ffxiv,
      lastValidIndex: current.lastValidIndex || ffxiv,
    })
  }

  async ensureEncodedAsset(
    sha256: string,
    nextData: Buffer,
  ): Promise<{
    format: EncodedAssetFormat
    persisted: boolean
  }> {
    const existingFormat = this.existingAssets.get(sha256)
    if (existingFormat) {
      return {
        format: existingFormat,
        persisted: false,
      }
    }

    const encoded = await formatTex(nextData, {
      format: 'auto',
    })
    const format = encoded.format as EncodedAssetFormat

    const assetPath = getAssetPath(sha256, format)
    await this.localStorage.writeFile(
      this.server,
      uiStoragePathKey,
      assetPath,
      encoded.data,
    )
    await this.remoteStorage?.writeFile(
      this.server,
      uiStoragePathKey,
      assetPath,
      encoded.data,
      getAssetContentType(format),
    )

    this.existingAssets.set(sha256, format)
    return { format, persisted: true }
  }

  async syncToRemote(version?: string): Promise<void> {
    const { remoteStorage } = this
    if (!remoteStorage) {
      throw new Error('Remote storage is required')
    }

    if (!existsSync(this.outputRoot)) {
      throw new Error(`Local UI output not found: ${this.outputRoot}`)
    }

    const currentVersion = await this.loadLocalCurrentReference()
    const manifestVersion = version ?? currentVersion.lastValidIndex
    const remoteAssets = await this.loadRemoteExistingAssets(
      currentVersion.lastValidIndex,
    )
    const localAssets = await this.scanLocalExistingAssets()
    const localAssetFileList = createAssetFileList(localAssets)
    const assetUploads = [...localAssets].filter(
      ([sha256, format]) => remoteAssets.get(sha256) !== format,
    )
    const patchFiles = version
      ? await this.listLocalFiles(this.patchRoot, version)
      : await this.listLocalFiles(this.patchRoot)
    const progressBar = new SingleBar({
      format: '{phase} [{bar}] {value}/{total}',
      hideCursor: true,
    })

    console.log(
      `Syncing UI assets for ${this.server} to storage '${this.getRemoteStorageName()}'${version ? ` for patch ${version}` : ''}.`,
    )
    console.log(
      `Local assets: ${localAssets.size}, remote assets: ${remoteAssets.size}, pending uploads: ${assetUploads.length}.`,
    )
    console.log(
      `Patch metadata files queued: ${patchFiles.length}. Manifest version: ${manifestVersion}.`,
    )
    console.log(`Upload concurrency: ${syncConcurrency}.`)

    let uploadedAssets = 0
    if (assetUploads.length > 0) {
      console.log(`Uploading ${assetUploads.length} asset file(s)...`)
      progressBar.start(assetUploads.length, 0, { phase: 'Assets  ' })
    } else {
      console.log(`No asset files need uploading.`)
    }
    await processWithConcurrency(
      assetUploads,
      syncConcurrency,
      async ([sha256, format]) => {
        const assetPath = getAssetPath(sha256, format)
        const content = await readFile(join(this.outputRoot, assetPath))
        await remoteStorage.writeFile(
          this.server,
          uiStoragePathKey,
          assetPath,
          content,
          getAssetContentType(format),
        )
        remoteAssets.set(sha256, format)
        uploadedAssets += 1
        progressBar.increment()
      },
    )
    if (assetUploads.length > 0) {
      progressBar.stop()
    }

    let syncedPatchFiles = 0
    if (patchFiles.length > 0) {
      console.log(`Uploading ${patchFiles.length} patch metadata file(s)...`)
      progressBar.start(patchFiles.length, 0, { phase: 'Patches ' })
    } else {
      console.log(`No patch metadata files need uploading.`)
    }
    await processWithConcurrency(
      patchFiles,
      syncConcurrency,
      async (relativePath) => {
        const content = await readFile(join(this.patchRoot, relativePath))
        await remoteStorage.writeFile(
          this.server,
          uiStoragePathKey,
          `${pathSegment.patches}/${relativePath}`,
          content,
          getContentTypeForPath(relativePath),
        )
        syncedPatchFiles += 1
        progressBar.increment()
      },
    )
    if (patchFiles.length > 0) {
      progressBar.stop()
    }

    console.log(`Uploading manifest files...`)
    progressBar.start(2, 0, { phase: 'Manifest ' })
    const currentContent = await readFile(this.currentRefPath)
    await remoteStorage.writeFile(
      this.server,
      uiStoragePathKey,
      pathSegment.currentRef,
      currentContent,
      'application/json',
    )
    progressBar.increment()
    await this.writeRemoteJson(
      `${pathSegment.patches}/${manifestVersion}/${assetFileListPath}`,
      localAssetFileList,
    )
    progressBar.increment()
    progressBar.stop()

    console.log(
      `Synced ${uploadedAssets} asset file(s), ${syncedPatchFiles} patch metadata file(s), and current.json to storage '${this.getRemoteStorageName()}'${version ? ` for ${version}` : ''}.`,
    )
  }

  private async readJson<T>(relativePath: string): Promise<T | null> {
    const remoteContent = await this.readRemoteJson<T>(relativePath)
    if (remoteContent) {
      return remoteContent
    }

    return this.readLocalJson<T>(relativePath)
  }

  private async readLocalJson<T>(relativePath: string): Promise<T | null> {
    const content = await this.localStorage.readFile(
      this.server,
      uiStoragePathKey,
      relativePath,
    )
    if (!content) {
      return null
    }

    return JSON.parse(content.toString('utf-8')) as T
  }

  private async readRemoteJson<T>(relativePath: string): Promise<T | null> {
    if (!this.remoteStorage) {
      return null
    }

    const content = await this.remoteStorage.readFile(
      this.server,
      uiStoragePathKey,
      relativePath,
    )
    if (!content) {
      return null
    }

    return JSON.parse(content.toString('utf-8')) as T
  }

  private async writeJson<T = unknown>(
    relativePath: string,
    value: T,
  ): Promise<void> {
    const content = `${JSON.stringify(value, null, 2)}\n`
    await this.localStorage.writeFile(
      this.server,
      uiStoragePathKey,
      relativePath,
      content,
    )
    if (this.remoteStorage) {
      await this.writeRemoteJson(relativePath, value)
    }
  }

  private async writeRemoteJson(
    relativePath: string,
    value: unknown,
  ): Promise<void> {
    if (!this.remoteStorage) {
      return
    }

    await this.remoteStorage.writeFile(
      this.server,
      uiStoragePathKey,
      relativePath,
      `${JSON.stringify(value, null, 2)}\n`,
      'application/json',
    )
  }

  private async scanLocalExistingAssets(): Promise<
    Map<string, EncodedAssetFormat>
  > {
    const existingAssets = new Map<string, EncodedAssetFormat>()
    const directories = await readdir(this.assetRoot, {
      withFileTypes: true,
    }).catch(() => [])

    for (const entry of directories) {
      if (!entry.isDirectory()) {
        continue
      }

      const files = await readdir(join(this.assetRoot, entry.name), {
        withFileTypes: true,
      }).catch(() => [])
      for (const file of files) {
        if (!file.isFile()) {
          continue
        }

        const parsed = parseAssetRelativePath(`${entry.name}/${file.name}`)
        if (!parsed) {
          continue
        }

        existingAssets.set(parsed.sha256, parsed.format)
      }
    }

    return existingAssets
  }

  private async loadRemoteExistingAssets(
    version: string,
  ): Promise<Map<string, EncodedAssetFormat>> {
    const remoteAssets = new Map<string, EncodedAssetFormat>()
    if (!this.remoteStorage) {
      return remoteAssets
    }

    const fileList = await this.readRemoteJson<string[]>(
      `${pathSegment.patches}/${version}/${assetFileListPath}`,
    )
    if (fileList) {
      for (const filePath of fileList) {
        const parsed = parseAssetRelativePath(filePath)
        if (parsed) {
          remoteAssets.set(parsed.sha256, parsed.format)
        }
      }

      return remoteAssets
    }

    console.log('Fallback to listing remote files')
    const remoteFiles = await this.remoteStorage.listFiles(
      this.server,
      uiStoragePathKey,
      pathSegment.assets,
    )
    for (const filePath of remoteFiles) {
      const parsed = parseAssetRelativePath(filePath)
      if (parsed) {
        remoteAssets.set(parsed.sha256, parsed.format)
      }
    }

    return remoteAssets
  }

  private async listLocalFiles(
    rootPath: string,
    prefix = '',
  ): Promise<string[]> {
    const targetPath = prefix ? join(rootPath, prefix) : rootPath
    const entries = await readdir(targetPath, { withFileTypes: true }).catch(
      () => [],
    )
    const files: string[] = []

    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        files.push(...(await this.listLocalFiles(rootPath, relativePath)))
      } else {
        files.push(relativePath.replaceAll('\\', '/'))
      }
    }

    return files.sort()
  }
}

function parseAssetRelativePath(relativePath: string): {
  sha256: string
  format: EncodedAssetFormat
} | null {
  const normalizedPath = relativePath.replaceAll('\\', '/')
  const match = normalizedPath.match(
    /^(?:assets\/)?[0-9a-f]{2}\/([0-9a-f]{64})\.(webp|avif)$/,
  )
  if (!match) {
    return null
  }

  return {
    sha256: match[1],
    format: match[2] as EncodedAssetFormat,
  }
}

function getAssetPath(sha256: string, format: EncodedAssetFormat): string {
  return `${pathSegment.assets}/${sha256.slice(0, 2)}/${sha256}.${format}`
}

function getAssetContentType(format: EncodedAssetFormat): string {
  return format === 'avif' ? 'image/avif' : 'image/webp'
}

function getContentTypeForPath(relativePath: string): string | undefined {
  if (relativePath.endsWith('.json')) {
    return 'application/json'
  }

  return undefined
}

function createAssetFileList(existingAssets: Map<string, EncodedAssetFormat>) {
  return [...existingAssets.entries()]
    .sort(([leftSha], [rightSha]) => leftSha.localeCompare(rightSha))
    .map(([sha256, format]) => getAssetPath(sha256, format))
}

function createIconStateMap(entries: Array<Omit<IconEntry, 'path'>>) {
  return new Map(
    entries.map((entry) => [
      toIconPath(entry.id, entry.version, entry.hr),
      {
        ...entry,
        path: toIconPath(entry.id, entry.version, entry.hr),
      },
    ]),
  )
}

function toIconPath(id: number, version: string, hr: boolean) {
  const paddedId = id.toString().padStart(6, '0')
  return `ui/icon/${paddedId.slice(0, 3)}000${version}/${paddedId}${hr ? '_hr1' : ''}.tex`
}

async function processWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return
  }

  let nextIndex = 0
  const workerCount = Math.min(concurrency, items.length)

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex]
        nextIndex += 1
        await worker(item)
      }
    }),
  )
}
