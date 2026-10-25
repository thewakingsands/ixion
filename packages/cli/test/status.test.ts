import { type GameVersions, ObservationError } from '@ffcafe/ixion-server'
import { describe, expect, it, type Mock, vi } from 'vitest'
import { serversToCheck } from '../src/actions/ci/constants'
import {
  observeStatus,
  type ServerName,
} from '../src/actions/status'

const version = '2026.01.01.0000.0000'
const next = '2026.01.02.0000.0000'
const baselines = Object.fromEntries(serversToCheck.map((s) => [s, version]))
const providers = () =>
  Object.fromEntries(
    serversToCheck.map((s) => [
      s,
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

describe('version observation', () => {
  it('keeps failed regions and updates successful regions without persisting errors', async () => {
    const p = providers()
    p.sdo.latestVersion.mockRejectedValue(
      new ObservationError('invalid_response'),
    )
    p.actoz.latestVersion.mockResolvedValue(next)
    const result = await observeStatus({
      baselines,
      providers: p,
      previous: { sdo: version },
    })
    expect(result.versions).toEqual({ ...baselines, actoz: next })
    expect(result.errors).toEqual({ sdo: 'invalid_response' })
    expect(result.updateRequired).toBe(true)
  })
  it('omits first failures and does not invent observations from release records', async () => {
    const p = providers()
    for (const provider of Object.values(p))
      provider.latestVersion.mockRejectedValue(new ObservationError('upstream'))
    const first = await observeStatus({ baselines, providers: p })
    expect(first.versions).toEqual({})
    expect(first.updateRequired).toBe(false)
    const later = await observeStatus({
      baselines,
      providers: p,
      previous: { sdo: next },
    })
    expect(later.versions).toEqual({ sdo: next })
    expect(later.updateRequired).toBe(false)
  })
  it('retries an unchanged observed version after a failed download until released', async () => {
    const p = providers()
    p.sdo.latestVersion.mockResolvedValue(next)
    const first = await observeStatus({ baselines, providers: p })
    const retry = await observeStatus({
      baselines,
      providers: p,
      previous: first.versions,
    })
    expect(retry.versions).toEqual(first.versions)
    expect(first.updateRequired).toBe(true)
    expect(retry.updateRequired).toBe(true)
    const released = await observeStatus({
      baselines: { ...baselines, sdo: next },
      providers: p,
      previous: retry.versions,
    })
    expect(released.updateRequired).toBe(false)
  })
  it('triggers a successful global observation with no release record', async () => {
    const p = providers()
    const result = await observeStatus({ baselines: {}, providers: p })
    expect(result.versions).toEqual({ squareEnix: version })
    expect(result.updateRequired).toBe(true)
    expect(result.errors).toEqual({
      sdo: 'baseline_unavailable',
      actoz: 'baseline_unavailable',
      userjoy: 'baseline_unavailable',
    })
  })
  it('requires real baselines only for patch providers', async () => {
    const p = providers()
    await observeStatus({
      baselines: { sdo: '2012.01.01.0000.0000' },
      providers: p,
    })
    expect(p.sdo.latestVersion).not.toHaveBeenCalled()
    expect(p.actoz.latestVersion).not.toHaveBeenCalled()
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
    const result = await observeStatus({ baselines, providers: p, sleep })
    expect(p.sdo.latestVersion).toHaveBeenCalledTimes(2)
    expect(p.actoz.latestVersion).toHaveBeenCalledOnce()
    expect(sleep).toHaveBeenCalledWith(1000)
    expect(result.errors.sdo).toBeUndefined()
  })
  it('aborts timed-out requests and keeps successful regions', async () => {
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
      timeoutMs: 5,
      sleep: async () => {},
    })
    expect(result.errors).toEqual({ sdo: 'timeout' })
    expect(p.sdo.latestVersion).toHaveBeenCalledTimes(2)
    expect(Object.keys(result.versions)).toHaveLength(3)
  })
})
