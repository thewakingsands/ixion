import $debug from 'debug'
import type { GameVersions, PatchEntry } from '../interface'
import { parsePatchList } from '../utils/parser'
import { AbstractPatchProvider } from './abstract'

const server = 'ffxivpatch01.ff14.sdo.com'
const debug = $debug('ixion:providers:sdo')

/**
 * SDO provider
 */
export class SDOProvider extends AbstractPatchProvider {
  name = 'sdo'
  displayName = 'SDO'

  async request(versions: GameVersions): Promise<PatchEntry[]> {
    const versionReport = [versions.boot]
    const { ffxiv, expansions } = versions
    for (const [key, value] of Object.entries(expansions)) {
      if (key.startsWith('ex') && value) {
        versionReport.push(`${key}\t${value}`)
      }
    }

    const url = `http://${server}/http/win32/shanda_release_chs_game/${ffxiv}`
    const requestBody = versionReport.join('\n')

    debug('request %s, %j', url, requestBody)

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Hash-Check': 'enabled',
        'User-Agent': 'FFXIV PATCH CLIENT',
      },
      body: requestBody,
    })

    if (res.status !== 200) {
      throw new Error(
        `Failed to request patch server: ${res.status}, ${await res.text()}`,
      )
    }

    const body = await res.text()
    return parsePatchList(body, 'c38effbc')
  }
  async healthCheck(): Promise<boolean> {
    return true
  }
}
