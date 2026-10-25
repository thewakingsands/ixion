import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { servers } from '@ffcafe/ixion-server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { serversToCheck } from '../src/actions/ci/constants'
import { commitAndPush } from '../src/actions/ci/github'
import { runStatus } from '../src/status'

let root: string, repo: string, remote: string, outputs: string
const version = '2026.01.01.0000.0000'
const next = '2026.01.02.0000.0000'
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ixion-observe-git-'))
  remote = join(root, 'remote.git')
  repo = join(root, 'work')
  outputs = join(root, 'outputs')
  git(root, 'init', '--bare', '--initial-branch=main', remote)
  git(root, 'clone', remote, repo)
  git(repo, 'config', 'user.name', 'Test')
  git(repo, 'config', 'user.email', 'test@example.invalid')
  await mkdir(join(repo, '.ci'))
  await writeFile(
    join(repo, '.ci/versions.json'),
    JSON.stringify(Object.fromEntries(serversToCheck.map((s) => [s, version]))),
  )
  await writeFile(join(repo, 'other.txt'), 'initial')
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', 'initial')
  git(repo, 'push', '-u', 'origin', 'main')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  for (const s of serversToCheck)
    vi.spyOn(servers[s], 'latestVersion').mockResolvedValue(version)
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})
const run = () => runStatus(['--commit'], { GITHUB_OUTPUT: outputs }, repo)

it('pushes only observed versions, skips unchanged commits and retains observations in later release commits', async () => {
  await writeFile(join(repo, 'other.txt'), 'unrelated staged work')
  git(repo, 'add', 'other.txt')
  await run()
  const observationSha = git(repo, 'rev-parse', 'HEAD')
  expect(git(remote, 'rev-parse', 'main')).toBe(observationSha)
  expect(
    git(repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'),
  ).toBe('.ci/versions-observed.json')
  expect(git(repo, 'diff', '--cached', '--name-only')).toBe('other.txt')
  expect(await readFile(outputs, 'utf8')).toBe(
    `sha=${observationSha}\nupdate_required=false\n`,
  )
  await run()
  expect(git(repo, 'rev-parse', 'HEAD')).toBe(observationSha)
  const observed = git(repo, 'show', 'HEAD:.ci/versions-observed.json')
  await writeFile(
    join(repo, '.ci/versions.json'),
    JSON.stringify({ sdo: next }),
  )
  const releaseSha = await commitAndPush(
    '.ci/versions.json',
    'ci: update released versions',
    repo,
  )
  expect(git(repo, 'show', `${releaseSha}:.ci/versions-observed.json`)).toBe(
    observed,
  )
  expect(
    git(repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', releaseSha),
  ).toBe('.ci/versions.json')
})
it('an unchanged observation still requests update after download failed', async () => {
  vi.mocked(servers.sdo.latestVersion).mockResolvedValue(next)
  await run()
  const sha = git(repo, 'rev-parse', 'HEAD')
  await writeFile(outputs, '')
  await run()
  expect(git(repo, 'rev-parse', 'HEAD')).toBe(sha)
  expect(await readFile(outputs, 'utf8')).toBe(
    `sha=${sha}\nupdate_required=true\n`,
  )
})
it('failed Git push produces no downstream SHA or update outputs', async () => {
  await writeFile(join(remote, 'hooks/pre-receive'), '#!/bin/sh\nexit 1\n', {
    mode: 0o755,
  })
  const old = git(remote, 'rev-parse', 'main')
  await expect(run()).rejects.toThrow()
  expect(git(remote, 'rev-parse', 'main')).toBe(old)
  await expect(readFile(outputs)).rejects.toMatchObject({ code: 'ENOENT' })
})
it('bad input produces neither an observation commit nor downstream outputs', async () => {
  const sha = git(repo, 'rev-parse', 'HEAD')
  await writeFile(join(repo, '.ci/versions-observed.json'), '{broken')
  await expect(run()).rejects.toThrow()
  expect(git(remote, 'rev-parse', 'main')).toBe(sha)
  expect(servers.sdo.latestVersion).not.toHaveBeenCalled()
  await expect(readFile(outputs)).rejects.toMatchObject({ code: 'ENOENT' })
})
