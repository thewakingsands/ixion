import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FFXIVPatchProvider } from '../src/providers/ffxiv-patch'
import { ThaliakProvider } from '../src/providers/thaliak'

const base = { boot: 'boot', ffxiv: '2025.03.03.0000.0000', expansions: {} }
const patch = new FFXIVPatchProvider('https://patch.example/', 'patch.example')
const thaliak = new ThaliakProvider('4e9a232b', [])
const fixture = await readFile(
  new URL('./__fixtures__/sdo.txt', import.meta.url),
  'utf8',
)
afterEach(() => vi.unstubAllGlobals())
const fetches = (body: string | null, status = 200) => {
  const fetch = vi.fn(
    async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(body, { status }),
  )
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('direct patch observation', () => {
  it('shares the request protocol and returns the newest base-game patch', async () => {
    const fetch = fetches(fixture)
    const signal = new AbortController().signal
    expect(await patch.latestVersion(base, signal)).toBe('2025.04.11.0000.0001')
    expect(fetch.mock.calls[0]).toEqual([
      'https://patch.example/2025.03.03.0000.0000',
      expect.objectContaining({ signal, method: 'POST', body: 'boot' }),
    ])
    expect(await patch.request(base)).toHaveLength(3)
  })
  it('accepts split-patch versions and normalizes the base-game target', async () => {
    fetches(
      fixture
        .replaceAll('2025.04.11.0000.0001', 'H2025.04.11.0000.0001a')
        .replace('2024.10.30.0000.0000\t', 'H2024.10.30.0000.0000b\t'),
    )
    expect(await patch.latestVersion(base)).toBe('2025.04.11.0000.0001')
  })
  it('accepts 204 and a well-formed empty list', async () => {
    fetches(null, 204)
    expect(await patch.latestVersion(base)).toBe(base.ffxiv)
    fetches(
      fixture
        .split('\n')
        .filter((line) => !line.includes('\t'))
        .join('\n'),
    )
    expect(await patch.latestVersion(base)).toBe(base.ffxiv)
  })
  it('does not confuse expansion updates with the base game', async () => {
    fetches(
      fixture
        .split('\n')
        .filter((line) => !line.includes('\t') || line.includes('/ex1/'))
        .join('\n'),
    )
    expect(await patch.latestVersion(base)).toBe(base.ffxiv)
  })
  it.each([
    '<html>maintenance</html>',
    '',
    fixture.replace('2025.03.18.0000.0000\t', 'invalid\t'),
    fixture.slice(0, -60),
  ])('rejects malformed responses', async (body) => {
    fetches(body)
    await expect(patch.latestVersion(base)).rejects.toMatchObject({
      code: 'invalid_response',
      retryable: false,
    })
  })
  it.each([429, 500, 503])(
    'marks temporary HTTP %s retryable',
    async (status) => {
      fetches('error', status)
      await expect(patch.latestVersion(base)).rejects.toMatchObject({
        code: 'upstream',
        retryable: true,
      })
    },
  )
  it('does not retry authorization failures', async () => {
    fetches('error', 403)
    await expect(patch.latestVersion(base)).rejects.toMatchObject({
      code: 'upstream',
      retryable: false,
    })
  })
})

describe('Thaliak observation', () => {
  it('reads latestVersion even when versions and patches are absent', async () => {
    const fetch = fetches(
      JSON.stringify({
        data: { repository: { latestVersion: { versionString: base.ffxiv } } },
      }),
    )
    expect(await thaliak.latestVersion()).toBe(base.ffxiv)
    expect(
      JSON.parse(fetch.mock.calls[0][1]?.body as string).query,
    ).not.toContain('patches')
  })
  it.each([
    {},
    { data: { repository: null } },
    { errors: [{ message: 'error' }] },
    { data: { repository: { latestVersion: { versionString: 'bad' } } } },
  ])('rejects incomplete responses', async (value) => {
    fetches(JSON.stringify(value))
    await expect(thaliak.latestVersion()).rejects.toMatchObject({
      code: 'invalid_response',
    })
  })
  it('rejects invalid JSON', async () => {
    fetches('bad')
    await expect(thaliak.latestVersion()).rejects.toMatchObject({
      code: 'invalid_response',
    })
  })
})
