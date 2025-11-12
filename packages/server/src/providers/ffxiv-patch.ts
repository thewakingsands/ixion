import { Language } from '@ffcafe/ixion-utils'
import $debug from 'debug'
import type { GameVersions, PatchEntry } from '../interface'
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

  async request(versions: GameVersions): Promise<PatchEntry[]> {
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

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Host: this.host,
        'X-Hash-Check': 'enabled',
        'User-Agent': 'FFXIV_Patch',
      },
      body: requestBody,
    })

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
