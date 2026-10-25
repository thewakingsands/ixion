import {
  type GameVersions,
  ObservationError,
  servers,
} from '@ffcafe/ixion-server'
import { bootVersion } from '../config'
import { serversToCheck } from './ci/constants'

export type ServerName = (typeof serversToCheck)[number]
export type ObservedVersions = Partial<Record<ServerName, string>>
export type StatusError =
  | 'timeout'
  | 'upstream'
  | 'invalid_response'
  | 'baseline_unavailable'
export interface Observation {
  versions: ObservedVersions
  errors: Partial<Record<ServerName, StatusError>>
  updateRequired: boolean
}
interface Provider {
  latestVersion(versions?: GameVersions, signal?: AbortSignal): Promise<string>
}
interface Options {
  previous?: ObservedVersions
  baselines: ObservedVersions
  providers?: Record<ServerName, Provider>
  timeoutMs?: number
  sleep?: (ms: number) => Promise<void>
}

export async function observeStatus({
  previous = {},
  baselines,
  providers = servers,
  timeoutMs = 30_000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: Options): Promise<Observation> {
  const results = await Promise.all(
    serversToCheck.map(async (server) => {
      const failed = (error: StatusError) => ({
        server,
        error,
        version: previous[server],
      })
      const base = baselines[server]
      if (server !== 'squareEnix' && (!base || base === '2012.01.01.0000.0000'))
        return failed('baseline_unavailable')
      const versions = base
        ? { boot: bootVersion, ffxiv: base, expansions: {} }
        : undefined
      for (let attempt = 0; attempt < 2; attempt++) {
        const signal = AbortSignal.timeout(timeoutMs)
        try {
          const version = await providers[server].latestVersion(
            versions,
            signal,
          )
          return { server, version, error: null }
        } catch (error) {
          const code = signal.aborted
            ? 'timeout'
            : error instanceof ObservationError
              ? error.code
              : 'upstream'
          const retryable =
            signal.aborted ||
            (error instanceof ObservationError
              ? error.retryable
              : error instanceof TypeError)
          if (!retryable || attempt === 1) return failed(code)
          await sleep(1000)
        }
      }
      return failed('upstream')
    }),
  )
  const versions: ObservedVersions = {}
  const errors: Observation['errors'] = {}
  for (const result of results) {
    if (result.version !== undefined) versions[result.server] = result.version
    if (result.error) errors[result.server] = result.error
  }
  return {
    versions,
    errors,
    // Compare successful observations with releases so a failed download can retry next run.
    updateRequired: results.some(
      (r) => !r.error && r.version !== baselines[r.server],
    ),
  }
}
