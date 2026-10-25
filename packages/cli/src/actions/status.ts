import {
  type GameVersions,
  isGameVersion,
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
export const maxStatusBytes = 1024 * 1024
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

export function parseBaselines(text: string): Record<string, unknown> {
  if (Buffer.byteLength(text) > maxStatusBytes)
    throw new Error('Input exceeds 1 MiB')
  const value: unknown = JSON.parse(text)
  if (!object(value)) throw new Error('Invalid versions file')
  return value
}

export function parseStatus(text: string): ObservedVersions {
  const value = parseBaselines(text)
  if (
    Object.entries(value).some(
      ([key, version]) =>
        !serversToCheck.includes(key as ServerName) || !isGameVersion(version),
    )
  )
    throw new Error('Invalid observed versions file')
  return Object.fromEntries(
    serversToCheck
      .filter((key) => key in value)
      .map((key) => [key, value[key]]),
  )
}

interface Provider {
  latestVersion(versions?: GameVersions, signal?: AbortSignal): Promise<string>
}
interface Options {
  previous?: ObservedVersions
  baselines: Record<string, unknown>
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
      if (
        server !== 'squareEnix' &&
        (!isGameVersion(base) || base === '2012.01.01.0000.0000')
      )
        return failed('baseline_unavailable')
      const versions = isGameVersion(base)
        ? { boot: bootVersion, ffxiv: base, expansions: {} }
        : undefined
      for (let attempt = 0; attempt < 2; attempt++) {
        const signal = AbortSignal.timeout(timeoutMs)
        try {
          const version = await providers[server].latestVersion(
            versions,
            signal,
          )
          if (!isGameVersion(version))
            throw new ObservationError('invalid_response')
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
