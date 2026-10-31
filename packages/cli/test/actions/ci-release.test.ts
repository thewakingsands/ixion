import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Octokit } from '@octokit/rest'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createGitHubRelease } from '../../src/actions/ci/github'
import { copyMergedAssets } from '../../src/actions/ci/steps/merged-assets'

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
type Asset = { id: number; name: string; state: string; bytes?: string }
type Release = { id: number; tag_name: string; draft: boolean; body?: string }
let root: string, repo: string, remote: string, archive: string, extra: string
let releases: Release[],
  assets: Asset[],
  calls: string[],
  api: ReturnType<typeof fakeApi>
let failure: string | undefined
const env = { GITHUB_REPOSITORY: 'test/ixion', GITHUB_RUN_ID: '123' }
const versions = { sdo: 'v2' }
const fail = (stage: string) => {
  if (failure === stage) {
    failure = undefined
    throw new Error(stage)
  }
}
function fakeApi() {
  const repos = {
    listReleases: vi.fn(),
    listReleaseAssets: vi.fn(),
    createRelease: vi.fn(async (input: Release) => {
      calls.push('create')
      fail('create')
      const release = { ...input, id: 10 + releases.length }
      releases.push(release)
      fail('create-lost')
      return { data: release }
    }),
    deleteReleaseAsset: vi.fn(async ({ asset_id }: { asset_id: number }) => {
      calls.push('delete')
      fail(`delete-${asset_id}`)
      assets = assets.filter((a) => a.id !== asset_id)
    }),
    uploadReleaseAsset: vi.fn(
      async ({ name, data }: { name: string; data: Buffer }) => {
        calls.push(`upload:${name}`)
        fail(`upload-${name}`)
        assets.push({
          id: assets.length + 1,
          name,
          state: 'uploaded',
          bytes: data.toString(),
        })
        fail('upload-lost')
      },
    ),
    updateRelease: vi.fn(
      async (input: { release_id: number; draft?: boolean; body?: string }) => {
        calls.push(input.draft === false ? 'publish' : 'body')
        fail(input.draft === false ? 'publish' : 'body')
        const release = releases.find((r) => r.id === input.release_id)
        if (!release) throw new Error('Release not found')
        Object.assign(release, input)
        if (input.draft === false) fail('publish-lost')
        return { data: release }
      },
    ),
  }
  const paginate = Object.assign(
    vi.fn(async () => [...assets]),
    {
      iterator: vi.fn(async function* () {
        // The target is deliberately outside the first page.
        yield { data: [{ id: 1, tag_name: 'other', draft: false }] }
        yield { data: releases }
      }),
    },
  )
  return { repos, paginate }
}
const run = (runEnv = env) =>
  createGitHubRelease(
    versions,
    [{ server: 'sdo', version: 'v2', path: archive }],
    [extra],
    { cwd: repo, env: runEnv, octokit: api as unknown as Octokit },
  )
const recorded = () => git(remote, 'show', 'main:.ci/versions.json')
const old = JSON.stringify({ sdo: 'v1' })
const publicRelease = () => {
  releases.push({ id: 10, tag_name: 'publish/123', draft: false })
  assets.push(
    { id: 1, name: 'sdo-v2.zip', state: 'uploaded' },
    { id: 2, name: 'strings.zip', state: 'uploaded' },
  )
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ixion-release-'))
  remote = join(root, 'remote.git')
  repo = join(root, 'work')
  git(root, 'init', '--bare', '--initial-branch=main', remote)
  git(root, 'clone', remote, repo)
  git(repo, 'config', 'user.name', 'Test')
  git(repo, 'config', 'user.email', 'test@example.invalid')
  await mkdir(join(repo, '.ci'))
  await writeFile(join(repo, '.ci/versions.json'), old)
  await writeFile(join(repo, 'other.txt'), 'initial')
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', 'initial')
  git(repo, 'push', '-u', 'origin', 'main')
  archive = join(root, 'sdo-v2.zip')
  extra = join(root, 'strings.zip')
  await writeFile(archive, 'new archive')
  await writeFile(extra, 'strings')
  releases = []
  assets = []
  calls = []
  failure = undefined
  api = fakeApi()
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})
it('publishes a complete draft before recording versions and excludes unrelated staged work', async () => {
  const source = git(repo, 'rev-parse', 'HEAD')
  await writeFile(join(repo, 'other.txt'), 'staged')
  git(repo, 'add', 'other.txt')
  api.repos.updateRelease.mockImplementationOnce(async (input) => {
    expect(recorded()).toBe(old)
    return { data: Object.assign(releases[0], input) }
  })
  await run()
  expect(api.repos.createRelease).toHaveBeenCalledWith(
    expect.objectContaining({
      tag_name: 'publish/123',
      target_commitish: source,
      draft: true,
    }),
  )
  expect(calls).toEqual([
    'create',
    'upload:sdo-v2.zip',
    'upload:strings.zip',
    'publish',
  ])
  expect(releases[0].draft).toBe(false)
  expect(JSON.parse(recorded())).toEqual(versions)
  expect(
    git(repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'),
  ).toBe('.ci/versions.json')
  expect(git(repo, 'diff', '--cached', '--name-only')).toBe('other.txt')
})
it('copies merged resources before cleanup and retries their complete publication', async () => {
  const game = join(root, 'game')
  await mkdir(join(game, 'sqpack/ffxiv'), { recursive: true })
  const inputs = [
    'ffxivgame.ver',
    'sqpack/ffxiv/0a0000.win32.dat0',
    'sqpack/ffxiv/0a0000.win32.index',
    'sqpack/ffxiv/0a0000.win32.index2',
  ]
  for (const [index, file] of inputs.entries())
    await writeFile(join(game, file), `merged bytes ${index}`)
  const merged = copyMergedAssets(game, root)
  await rm(game, { recursive: true })
  const publish = () =>
    createGitHubRelease(
      versions,
      [{ server: 'sdo', version: 'v2', path: archive }],
      [extra, ...merged],
      { cwd: repo, env, octokit: api as unknown as Octokit },
    )
  failure = 'upload-merged.0a0000.win32.index'
  await expect(publish()).rejects.toThrow(failure)
  expect(releases[0].draft).toBe(true)
  expect(recorded()).toBe(old)
  await publish()
  expect(releases[0].draft).toBe(false)
  for (const [index, file] of inputs.entries()) {
    const name = `merged.${file.split('/').at(-1)}`
    expect(assets.filter((asset) => asset.name === name)).toEqual([
      expect.objectContaining({ bytes: `merged bytes ${index}` }),
    ])
  }
  expect(await readFile(archive, 'utf8')).toBe('new archive')
  expect(JSON.parse(recorded())).toEqual(versions)
})
it.each([
  'create',
  'create-lost',
  'upload-strings.zip',
  'upload-lost',
  'publish',
  'publish-lost',
])(
  'recovers after %s without recording a failed publication',
  async (stage) => {
    failure = stage
    await expect(run()).rejects.toThrow(stage)
    expect(recorded()).toBe(old)
    expect(await readFile(join(repo, '.ci/versions.json'), 'utf8')).toBe(old)
    const wasPublic = releases[0]?.draft === false
    calls = []
    await run()
    expect(releases).toHaveLength(1)
    expect(releases[0].draft).toBe(false)
    expect(JSON.parse(recorded())).toEqual(versions)
    if (wasPublic) expect(calls).toEqual([])
  },
)
it('clears every old draft asset and refreshes the version table before uploading new bytes', async () => {
  releases.push({
    id: 10,
    tag_name: 'publish/123',
    draft: true,
    body: 'old versions',
  })
  assets = [
    { id: 1, name: 'sdo-v2.zip', state: 'uploaded', bytes: 'old bytes' },
    { id: 2, name: 'obsolete.zip', state: 'starter' },
  ]
  failure = 'delete-2'
  await expect(run()).rejects.toThrow('delete-2')
  expect(recorded()).toBe(old)
  expect(api.repos.uploadReleaseAsset).not.toHaveBeenCalled()
  await run()
  expect(assets.map((a) => a.name).sort()).toEqual([
    'sdo-v2.zip',
    'strings.zip',
  ])
  expect(assets[0].bytes).toBe('new archive')
  expect(releases[0].body).toContain('| sdo | v2 |')
  expect(api.paginate.iterator).toHaveBeenCalled()
})
it.each(['missing', 'extra', 'starter', 'changed-version'])(
  'rejects a public release with %s assets',
  async (kind) => {
    publicRelease()
    if (kind === 'missing') assets.pop()
    if (kind === 'extra')
      assets.push({ id: 3, name: 'extra.zip', state: 'uploaded' })
    if (kind === 'starter') assets[0].state = 'starter'
    if (kind === 'changed-version') assets[0].name = 'sdo-v1.zip'
    await expect(run()).rejects.toThrow('start a new workflow run')
    expect(calls).toEqual([])
    expect(recorded()).toBe(old)
  },
)
it('does not publish a draft whose uploaded file state is incomplete', async () => {
  api.paginate.mockImplementation(async () =>
    assets.map((a) => ({ ...a, state: 'starter' })),
  )
  await expect(run()).rejects.toThrow('assets do not match')
  expect(releases[0].draft).toBe(true)
  expect(calls).not.toContain('publish')
  expect(recorded()).toBe(old)
})
it('recovers a rejected Git push from a fresh checkout without mutating the public release', async () => {
  const hook = join(remote, 'hooks/pre-receive')
  await writeFile(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 })
  await expect(run()).rejects.toThrow()
  expect(releases[0].draft).toBe(false)
  expect(recorded()).toBe(old)
  await rm(hook)
  repo = join(root, 'retry')
  git(root, 'clone', remote, repo)
  calls = []
  await run()
  expect(calls).toEqual([])
  expect(JSON.parse(recorded())).toEqual(versions)
})
it('syncs upstream before writing versions and preserves its changes', async () => {
  const other = join(root, 'other')
  git(root, 'clone', remote, other)
  git(other, 'config', 'user.name', 'Other')
  git(other, 'config', 'user.email', 'other@example.invalid')
  await writeFile(
    join(other, '.ci/versions.json'),
    JSON.stringify({ sdo: 'earlier' }),
  )
  await writeFile(join(other, 'upstream.txt'), 'keep')
  git(other, 'add', '.')
  git(other, 'commit', '-m', 'upstream')
  git(other, 'push')
  await run()
  expect(JSON.parse(recorded())).toEqual(versions)
  expect(git(remote, 'show', 'main:upstream.txt')).toBe('keep')
})
it('propagates Git sync and commit failures after publication', async () => {
  publicRelease()
  git(repo, 'remote', 'set-url', 'origin', join(root, 'missing'))
  await expect(run()).rejects.toThrow()
  expect(await readFile(join(repo, '.ci/versions.json'), 'utf8')).toBe(old)
  git(repo, 'remote', 'set-url', 'origin', remote)
  await writeFile(join(repo, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 1\n', {
    mode: 0o755,
  })
  await expect(run()).rejects.toThrow()
  expect(recorded()).toBe(old)
  expect(calls).toEqual([])
})
it('reuses the run tag but creates a separate release for a new forced run', async () => {
  await run()
  calls = []
  await run()
  expect(calls).toEqual([])
  // Each release has its own assets on GitHub.
  assets = []
  await run({ ...env, GITHUB_RUN_ID: '124' })
  expect(releases.map((r) => r.tag_name)).toEqual([
    'publish/123',
    'publish/124',
  ])
})
it('requires a run ID before performing remote writes', async () => {
  await expect(run({ ...env, GITHUB_RUN_ID: '' })).rejects.toThrow(
    'GITHUB_RUN_ID',
  )
  expect(calls).toEqual([])
  expect(recorded()).toBe(old)
})
