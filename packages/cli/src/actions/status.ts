import {
  type GameVersions,
  isGameVersion,
  ObservationError,
  servers,
} from '@ffcafe/ixion-server'
import { bootVersion } from '../config'

export const regions = [
  { server: 'sdo', region: 'cn', source: 'sdo' },
  { server: 'squareEnix', region: 'global', source: 'thaliak' },
  { server: 'actoz', region: 'kr', source: 'actoz' },
  { server: 'userjoy', region: 'tw', source: 'userjoy' },
] as const
export type ServerName = (typeof regions)[number]['server']
export type StatusError =
  | 'timeout'
  | 'upstream'
  | 'invalid_response'
  | 'baseline_unavailable'
export interface RegionStatus {
  server: string
  region: string
  source: string
  version: string | null
  observedAt: string | null
  attemptedAt: string
  error: StatusError | null
}
export interface Status {
  schemaVersion: 1
  regions: RegionStatus[]
}
export const maxStatusBytes = 1024 * 1024
const errors = [
  'timeout',
  'upstream',
  'invalid_response',
  'baseline_unavailable',
]
const isTime = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

export function parseStatus(text: string): Status {
  if (Buffer.byteLength(text) > maxStatusBytes)
    throw new Error('Status file exceeds 1 MiB')
  const value: unknown = JSON.parse(text)
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.regions) ||
    value.regions.length !== regions.length
  )
    throw new Error('Invalid status file')
  const parsed = regions.map((identity) => {
    const matches = (value.regions as unknown[]).filter(
      (r) => object(r) && r.server === identity.server,
    )
    const r = matches[0]
    if (
      matches.length !== 1 ||
      !object(r) ||
      r.region !== identity.region ||
      r.source !== identity.source ||
      !isTime(r.attemptedAt) ||
      !(r.error === null || errors.includes(r.error as string)) ||
      !(
        (r.version === null && r.observedAt === null) ||
        (isGameVersion(r.version) && isTime(r.observedAt))
      ) ||
      (r.error === null &&
        (r.version === null || String(r.observedAt) < r.attemptedAt))
    ) {
      throw new Error('Invalid status region')
    }
    return {
      ...identity,
      version: r.version as string | null,
      observedAt: r.observedAt as string | null,
      attemptedAt: r.attemptedAt,
      error: r.error as StatusError | null,
    }
  })
  return { schemaVersion: 1, regions: parsed }
}

export function parseBaselines(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text)
  if (!object(value)) throw new Error('Invalid baselines file')
  return value
}

interface Provider {
  latestVersion(versions?: GameVersions, signal?: AbortSignal): Promise<string>
}
interface Options {
  previous?: Status | null
  baselines: Record<string, unknown>
  providers?: Record<ServerName, Provider>
  now?: () => Date
  timeoutMs?: number
  sleep?: (ms: number) => Promise<void>
}

export async function observeStatus({
  previous,
  baselines,
  providers = servers,
  now = () => new Date(),
  timeoutMs = 30_000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: Options): Promise<Status> {
  const results = await Promise.all(
    regions.map(async (identity): Promise<RegionStatus> => {
      const old = previous?.regions.find((r) => r.server === identity.server)
      const attemptedAt = now().toISOString()
      const failed = (error: StatusError): RegionStatus => ({
        ...identity,
        attemptedAt,
        error,
        version: old?.version ?? null,
        observedAt: old?.observedAt ?? null,
      })
      const base = baselines[identity.server]
      if (
        identity.server !== 'squareEnix' &&
        (!isGameVersion(base) || base === '2012.01.01.0000.0000')
      ) {
        return failed('baseline_unavailable')
      }
      const versions = isGameVersion(base)
        ? { boot: bootVersion, ffxiv: base, expansions: {} }
        : undefined
      for (let attempt = 0; attempt < 2; attempt++) {
        const signal = AbortSignal.timeout(timeoutMs)
        try {
          const version = await providers[identity.server].latestVersion(
            versions,
            signal,
          )
          if (!isGameVersion(version))
            throw new ObservationError('invalid_response')
          return {
            ...identity,
            version,
            attemptedAt,
            observedAt: now().toISOString(),
            error: null,
          }
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
  return { schemaVersion: 1, regions: results }
}
