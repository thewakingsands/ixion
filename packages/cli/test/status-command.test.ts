import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { servers } from '@ffcafe/ixion-server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { parseStatus, regions } from '../src/actions/status'
import { runStatus } from '../src/status'

let directory: string
const version = '2026.01.01.0000.0000'
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ixion-status-'))
  await writeFile(
    join(directory, 'baselines.json'),
    JSON.stringify(Object.fromEntries(regions.map((r) => [r.server, version]))),
  )
  vi.spyOn(console, 'log').mockImplementation(() => {})
  for (const r of regions)
    vi.spyOn(servers[r.server], 'latestVersion').mockResolvedValue(version)
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(directory, { recursive: true, force: true })
})
const args = () => [
  '--baselines',
  join(directory, 'baselines.json'),
  '--output',
  join(directory, 'status.json'),
]

it('runs the standalone command, refreshes previous data, and leaves no temporary files', async () => {
  await runStatus(args())
  const first = parseStatus(
    await readFile(join(directory, 'status.json'), 'utf8'),
  )
  vi.mocked(servers.sdo.latestVersion).mockRejectedValue(
    new Error('private upstream detail'),
  )
  await runStatus([...args(), '--previous', join(directory, 'status.json')])
  const second = parseStatus(
    await readFile(join(directory, 'status.json'), 'utf8'),
  )
  expect(second.regions[0].observedAt).toBe(first.regions[0].observedAt)
  expect(second.regions[0].error).toBe('upstream')
  expect(JSON.stringify(second)).not.toContain('private')
  expect(await readdir(directory)).toEqual(['baselines.json', 'status.json'])
})
it('rejects missing or corrupt previous files without overwriting output', async () => {
  await writeFile(join(directory, 'status.json'), 'original')
  await expect(
    runStatus([...args(), '--previous', join(directory, 'missing')]),
  ).rejects.toThrow()
  await writeFile(join(directory, 'previous.json'), '{}')
  await expect(
    runStatus([...args(), '--previous', join(directory, 'previous.json')]),
  ).rejects.toThrow()
  expect(await readFile(join(directory, 'status.json'), 'utf8')).toBe(
    'original',
  )
  expect(servers.sdo.latestVersion).not.toHaveBeenCalled()
})
it('rejects incompatible arguments before querying', async () => {
  await expect(runStatus([...args(), '--publish'])).rejects.toThrow('Choose')
  await expect(runStatus([])).rejects.toThrow('Choose')
  await runStatus(['--help'])
  expect(servers.sdo.latestVersion).not.toHaveBeenCalled()
})
it('uses providers even when an old patch cache exists', async () => {
  await mkdir(join(directory, 'versions/.cache'), { recursive: true })
  await writeFile(join(directory, `versions/.cache/sdo-${version}.json`), '[]')
  vi.spyOn(process, 'cwd').mockReturnValue(directory)
  await runStatus(args())
  expect(servers.sdo.latestVersion).toHaveBeenCalledOnce()
})
it('validates the documented example', async () => {
  expect(
    parseStatus(
      await readFile(
        new URL('../../../docs/status.example.json', import.meta.url),
        'utf8',
      ),
    ).regions,
  ).toHaveLength(4)
})
it('fails explicitly supplied missing baseline files before querying', async () => {
  await expect(
    runStatus([
      '--baselines',
      join(directory, 'missing.json'),
      '--output',
      join(directory, 'status.json'),
    ]),
  ).rejects.toThrow()
  expect(servers.squareEnix.latestVersion).not.toHaveBeenCalled()
})
