import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { servers } from '@ffcafe/ixion-server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { serversToCheck } from '../src/actions/ci/constants'
import { parseStatus } from '../src/actions/status'
import { runStatus } from '../src/status'

let directory: string
const version = '2026.01.01.0000.0000'
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ixion-status-'))
  await mkdir(join(directory, '.ci'))
  await writeFile(
    join(directory, '.ci/versions.json'),
    JSON.stringify(Object.fromEntries(serversToCheck.map((s) => [s, version]))),
  )
  vi.spyOn(console, 'log').mockImplementation(() => {})
  for (const s of serversToCheck)
    vi.spyOn(servers[s], 'latestVersion').mockResolvedValue(version)
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(directory, { recursive: true, force: true })
})
const run = (args: string[] = []) => runStatus(args, {}, directory)
const output = () => join(directory, '.ci/versions-observed.json')

it('writes defaults, preserves failed regions, and leaves no temporary files', async () => {
  await run()
  const first = parseStatus(await readFile(output(), 'utf8'))
  vi.mocked(servers.sdo.latestVersion).mockRejectedValue(
    new Error('private upstream detail'),
  )
  const result = await run()
  expect(parseStatus(await readFile(output(), 'utf8'))).toEqual(first)
  expect(result?.errors).toEqual({ sdo: 'upstream' })
  expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain(
    'private',
  )
  expect(await readdir(join(directory, '.ci'))).toEqual([
    'versions-observed.json',
    'versions.json',
  ])
})
it('does not rewrite an unchanged version map', async () => {
  await run()
  const before = await stat(output())
  await run()
  expect((await stat(output())).mtimeMs).toBe(before.mtimeMs)
})
it('all failures leave the old file byte-for-byte unchanged, and create no first file', async () => {
  for (const s of serversToCheck)
    vi.mocked(servers[s].latestVersion).mockRejectedValue(
      new Error('unavailable'),
    )
  expect((await run())?.updateRequired).toBe(false)
  await expect(stat(output())).rejects.toMatchObject({ code: 'ENOENT' })
  const old = '{ "sdo" : "2026.01.01.0000.0000" }'
  await writeFile(output(), old)
  await run()
  expect(await readFile(output(), 'utf8')).toBe(old)
})
it.each(['{broken', '{"sdo":"bad"}', '{"schemaVersion":1}', '[]'])(
  'rejects corrupt observed file %s before querying or overwriting',
  async (text) => {
    await writeFile(output(), text)
    await expect(run()).rejects.toThrow()
    expect(await readFile(output(), 'utf8')).toBe(text)
    expect(servers.sdo.latestVersion).not.toHaveBeenCalled()
  },
)
it('rejects corrupt baseline JSON and oversize input before querying', async () => {
  await writeFile(join(directory, '.ci/versions.json'), '{broken')
  await expect(run()).rejects.toThrow()
  await writeFile(
    join(directory, '.ci/versions.json'),
    ' '.repeat(1024 * 1024 + 1),
  )
  await expect(run()).rejects.toThrow('1 MiB')
  expect(servers.squareEnix.latestVersion).not.toHaveBeenCalled()
})
it('rejects old publication flags and custom Git output paths', async () => {
  await expect(run(['--publish'])).rejects.toThrow()
  await expect(run(['--previous', 'old.json'])).rejects.toThrow()
  await expect(run(['--commit', '--output', '../other.json'])).rejects.toThrow()
  await run(['--help'])
  expect(servers.sdo.latestVersion).not.toHaveBeenCalled()
})
it('uses providers even when an old patch cache exists', async () => {
  await mkdir(join(directory, 'versions/.cache'), { recursive: true })
  await writeFile(join(directory, `versions/.cache/sdo-${version}.json`), '[]')
  await run()
  expect(servers.sdo.latestVersion).toHaveBeenCalledOnce()
})
it('validates the flat documented example', async () => {
  expect(
    Object.keys(
      parseStatus(
        await readFile(
          new URL('../../../docs/status.example.json', import.meta.url),
          'utf8',
        ),
      ),
    ),
  ).toEqual([...serversToCheck])
})
it('allows an absent default baseline but rejects an explicitly missing baseline', async () => {
  await expect(run(['--baselines', 'missing.json'])).rejects.toThrow()
  expect(servers.squareEnix.latestVersion).not.toHaveBeenCalled()
  await rm(join(directory, '.ci/versions.json'))
  const result = await run()
  expect(result?.versions).toEqual({ squareEnix: version })
  expect(result?.updateRequired).toBe(true)
})
