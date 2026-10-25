import { fullVersionRegex, Language } from '@ffcafe/ixion-utils'
import $debug from 'debug'
import type { GameVersions, PatchEntry } from '../interface'
import { checkHttp, isGameVersion, ObservationError } from '../observation'
import { parsePatchList } from '../utils/parser'
import { AbstractPatchProvider } from './abstract'

const debug = $debug('ixion:providers:ffxiv-patch')

/**
 * SDO provider
 */
export class FFXIVPatchProvider extends AbstractPatchProvider {
  name = 'ffxiv-patch'
  displayName = 'FFXIV Patch'
  languages: Language[] = []

  constructor(
    private endpoint: string,
    private host: string,
  ) {
    super()
  }

  private async response(versions: GameVersions, signal?: AbortSignal) {
    const versionReport = [versions.boot]
    const { ffxiv, expansions } = versions
    for (const [key, value] of Object.entries(expansions)) {
      if (key.startsWith('ex') && value) {
        versionReport.push(`${key}\t${value}`)
      }
    }

    const url = `${this.endpoint}${ffxiv}`
    const requestBody = versionReport.join('\n')

    debug('request %s, %j', url, requestBody)

    return fetch(url, {
      signal,
      method: 'POST',
      headers: {
        Host: this.host,
        'X-Hash-Check': 'enabled',
        'User-Agent': 'FFXIV_Patch',
      },
      body: requestBody,
    })
  }

  async request(
    versions: GameVersions,
    signal?: AbortSignal,
  ): Promise<PatchEntry[]> {
    const res = await this.response(versions, signal)
    if (res.status === 204) {
      return []
    }

    if (res.status === 200) {
      const body = await res.text()
      return parsePatchList(body, 'c38effbc')
    }

    throw new Error(
      `Failed to request patch server: ${res.status}, ${await res.text()}`,
    )
  }
  async latestVersion(
    versions?: GameVersions,
    signal?: AbortSignal,
  ): Promise<string> {
    if (!versions || !isGameVersion(versions.ffxiv))
      throw new ObservationError('invalid_response')
    const res = await this.response(versions, signal)
    checkHttp(res)
    if (res.status === 204) return versions.ffxiv
    if (res.status !== 200) throw new ObservationError('invalid_response')
    const body = (await res.text()).trim()
    // The permissive download parser alone would mistake an HTML error page for an empty patch list.
    const lines = body.split(/\r?\n/)
    const boundary = lines[0]
    if (
      !/^--[\w-]+$/.test(boundary) ||
      lines.at(-1) !== `${boundary}--` ||
      !/^Content-Type: application\/octet-stream\s*$/im.test(body) ||
      !/^Content-Location: ffxivpatch\//im.test(body)
    ) {
      throw new ObservationError('invalid_response')
    }
    const patches = parsePatchList(body, 'c38effbc')
    const dataLines = lines.filter((line) => line.includes('\t'))
    if (
      dataLines.length !== patches.length ||
      patches.some(
        (p) =>
          !fullVersionRegex.test(p.version) ||
          !Number.isFinite(p.patchSize) ||
          p.patchSize < 0 ||
          !/^https?:\/\/.+\.patch$/.test(p.url),
      )
    ) {
      throw new ObservationError('invalid_response')
    }
    // Non-header text is not a valid empty patch response.
    if (
      lines.some(
        (line) =>
          line.trim() &&
          line !== boundary &&
          line !== `${boundary}--` &&
          !/^[\w-]+:/.test(line) &&
          !line.includes('\t'),
      )
    )
      throw new ObservationError('invalid_response')
    return [
      versions.ffxiv,
      ...patches
        .filter((p) => p.expansion === 'ffxiv')
        .map((p) => fullVersionRegex.exec(p.version)?.[2] as string),
    ]
      .sort()
      .at(-1) as string
  }
  async healthCheck(): Promise<boolean> {
    return true
  }
}

export class ActozProvider extends FFXIVPatchProvider {
  name = 'actoz'
  displayName = 'Actoz'
  languages = [Language.Korean]

  constructor() {
    const host = 'ngamever-live.ff14.co.kr'
    const server = process.env.ACTOZ_PATCH_SERVER || host
    super(`http://${server}/http/win32/actoz_release_ko_game/`, host)
  }
}

export class SDOProvider extends FFXIVPatchProvider {
  name = 'sdo'
  displayName = 'SDO'
  languages = [Language.ChineseSimplified]

  constructor() {
    const host = 'ffxivpatch01.ff14.sdo.com'
    const server = process.env.SDO_PATCH_SERVER || host
    super(`http://${server}/http/win32/shanda_release_chs_game/`, host)
  }
}

export class UserjoyProvider extends FFXIVPatchProvider {
  name = 'userjoy'
  displayName = 'Userjoy'
  languages = [Language.ChineseTraditional2]

  constructor() {
    const host = 'patch-gamever.ffxiv.com.tw'
    const server = process.env.USERJOY_PATCH_SERVER || host
    super(`http://${server}/http/win32/ffxivtc_release_tc_game/`, host)
  }
}
