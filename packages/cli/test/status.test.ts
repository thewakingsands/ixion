import { type GameVersions, ObservationError } from '@ffcafe/ixion-server'
import { describe, expect, it, type Mock, vi } from 'vitest'
import {
  observeStatus,
  parseBaselines,
  parseStatus,
  regions,
  type ServerName,
} from '../src/actions/status'

const version = '2026.01.01.0000.0000'
const baselines = Object.fromEntries(regions.map((r) => [r.server, version]))
const now = () => new Date('2026-01-01T01:00:00.000Z')
const providers = () =>
  Object.fromEntries(
    regions.map((r) => [
      r.server,
      { latestVersion: vi.fn(async () => version) },
    ]),
  ) as Record<
    ServerName,
    {
      latestVersion: Mock<
        (versions?: GameVersions, signal?: AbortSignal) => Promise<string>
      >
    }
  >
const previous = () => ({
  schemaVersion: 1 as const,
  regions: regions.map((r) => ({
    ...r,
    version,
    observedAt: '2026-01-01T00:00:00.000Z',
    attemptedAt: '2026-01-01T00:00:00.000Z',
    error: null,
  })),
})

describe('status generation', () => {
  it('keeps failed regions intact and clears previous errors after success', async () => {
    const p = providers(),
      old = previous()
    p.sdo.latestVersion.mockRejectedValue(
      new ObservationError('invalid_response'),
    )
    const result = await observeStatus({
      baselines,
      providers: p,
      now,
      previous: old,
    })
    expect(result.regions[0]).toEqual({
      ...old.regions[0],
      attemptedAt: now().toISOString(),
      error: 'invalid_response',
    })
    expect(result.regions[1].observedAt).toBe(now().toISOString())
    expect(parseStatus(JSON.stringify(result))).toEqual(result)
    const recovered = await observeStatus({
      baselines,
      providers: providers(),
      previous: result,
      now,
    })
    expect(recovered.regions[0].error).toBeNull()
    expect(recovered.regions[0].observedAt).toBe(now().toISOString())
  })
  it('publishes first-time failures without inventing successful observations', async () => {
    const p = providers()
    for (const provider of Object.values(p))
      provider.latestVersion.mockRejectedValue(new ObservationError('upstream'))
    const result = await observeStatus({ baselines, providers: p, now })
    expect(
      result.regions.every(
        (r) =>
          r.version === null && r.observedAt === null && r.error === 'upstream',
      ),
    ).toBe(true)
  })
  it('requires real baselines only for direct patch providers', async () => {
    const p = providers()
    const result = await observeStatus({
      baselines: { sdo: '2012.01.01.0000.0000', actoz: 'bad' },
      providers: p,
      now,
    })
    expect(result.regions.map((r) => r.error)).toEqual([
      'baseline_unavailable',
      null,
      'baseline_unavailable',
      'baseline_unavailable',
    ])
    expect(p.sdo.latestVersion).not.toHaveBeenCalled()
    expect(p.squareEnix.latestVersion).toHaveBeenCalledOnce()
  })
  it('retries transient network errors once and never retries invalid responses', async () => {
    const p = providers(),
      sleep = vi.fn(async () => {})
    p.sdo.latestVersion
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValue(version)
    p.actoz.latestVersion.mockRejectedValue(
      new ObservationError('invalid_response'),
    )
    const result = await observeStatus({ baselines, providers: p, now, sleep })
    expect(p.sdo.latestVersion).toHaveBeenCalledTimes(2)
    expect(p.actoz.latestVersion).toHaveBeenCalledOnce()
    expect(sleep).toHaveBeenCalledWith(1000)
    expect(result.regions[0].error).toBeNull()
  })
  it('aborts timed-out requests and preserves other regions', async () => {
    const p = providers()
    p.sdo.latestVersion.mockImplementation(
      (_base, signal) =>
        new Promise((_resolve, reject) => {
          if (!signal) throw new Error('Missing abort signal')
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          })
        }),
    )
    const result = await observeStatus({
      baselines,
      providers: p,
      now,
      timeoutMs: 5,
      sleep: async () => {},
    })
    expect(result.regions[0].error).toBe('timeout')
    expect(p.sdo.latestVersion).toHaveBeenCalledTimes(2)
    expect(result.regions.slice(1).every((r) => r.error === null)).toBe(true)
  })
})

describe('input validation', () => {
  it('rejects damaged schemas, duplicates, missing regions and mismatched values', () => {
    const valid = previous()
    for (const value of [
      { ...valid, schemaVersion: 2 },
      { ...valid, regions: valid.regions.slice(1) },
      { ...valid, regions: [valid.regions[0], ...valid.regions.slice(0, 3)] },
      {
        ...valid,
        regions: valid.regions.map((r) => ({ ...r, source: 'secret-url' })),
      },
      {
        ...valid,
        regions: valid.regions.map((r) => ({ ...r, observedAt: null })),
      },
      {
        ...valid,
        regions: valid.regions.map((r) => ({
          ...r,
          error: 'raw-secret-message',
        })),
      },
    ]) {
      expect(() => parseStatus(JSON.stringify(value))).toThrow()
    }
    expect(() => parseStatus('x'.repeat(1024 * 1024 + 1))).toThrow('1 MiB')
    expect(() => parseBaselines('{')).toThrow()
    expect(() => parseBaselines('[]')).toThrow()
  })
})
