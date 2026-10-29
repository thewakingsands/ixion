import assert from 'node:assert/strict'
import { test } from 'node:test'
import { artifactName, findArtifact } from './cli-artifact.mjs'

const entry = (path, hash = 'abc', mode = '100644') => `${mode} blob ${hash}\t${path}\0`
const source = entry('packages/cli/src/index.ts')

test('runtime versions, schemas and configuration do not invalidate the CLI', () => {
  const runtime = ['.ci/versions.json', '.ci/versions-observed.json',
    'lib/EXDSchema', 'lib/SaintCoinach', '.ixion-config.ci.json']
  assert.equal(artifactName(source + runtime.map(p => entry(p)).join('')),
    artifactName(source + runtime.map(p => entry(p, 'new')).join('')))
})

test('code, dependencies, packaging and native build inputs invalidate the CLI', () => {
  for (const path of ['packages/cli/src/index.ts', 'pnpm-lock.yaml',
    'pnpm-workspace.yaml', 'package.json', '.npmrc', '.cargo/config.toml',
    'config/tsdown.config.mjs', 'patches/dependency.patch',
    '.github/workflows/build.yml', 'scripts/check-cli-artifact.mjs']) {
    assert.notEqual(artifactName(entry(path)), artifactName(entry(path, 'new')), path)
  }
  assert.notEqual(artifactName(source), artifactName(source + entry('packages/new.ts')))
})

const repo = { owner: 'owner', repo: 'repo' }
const artifact = (id, overrides = {}) => ({
  name: 'expected', expired: false,
  workflow_run: { id, head_branch: 'main', head_repository_id: 1, repository_id: 1 },
  ...overrides,
})
const success = { conclusion: 'success', head_branch: 'main', event: 'push', path: '.github/workflows/build.yml' }
function api(pages, runs) {
  const calls = []
  return {
    calls,
    rest: { actions: {
      listArtifactsForRepo: 'list',
      getWorkflowRun: async ({ run_id }) => { calls.push(run_id); return { data: runs[run_id] } },
    } },
    paginate: { iterator: async function* (route, options) {
      assert.equal(route, 'list')
      assert.equal(options.name, 'expected')
      for (const data of pages) yield { data }
    } },
  }
}

test('finds a successful matching build across pages', async () => {
  const github = api([[artifact(1, { expired: true })], [artifact(2)]], { 2: success })
  assert.equal(await findArtifact(github, repo, 'expected'), '2')
  assert.deepEqual(github.calls, [2])
})

test('rejects expired, foreign, PR, failed, running and unrelated workflow artifacts', async () => {
  const github = api([[
    artifact(1, { name: 'other' }), artifact(2, { expired: true }),
    artifact(3, { workflow_run: { id: 3, head_branch: 'feature' } }),
    artifact(4, { workflow_run: { id: 4, head_branch: 'main', head_repository_id: 2, repository_id: 1 } }),
    ...[5, 6, 7, 8].map(id => artifact(id)),
  ]], {
    5: { ...success, event: 'pull_request' },
    6: { ...success, conclusion: 'failure' },
    7: { ...success, conclusion: null },
    8: { ...success, path: '.github/workflows/other.yml' },
  })
  assert.equal(await findArtifact(github, repo, 'expected'), '')
  assert.deepEqual(github.calls, [5, 6, 7, 8])
})

test('can reuse a successful fallback build from an earlier update run', async () => {
  const github = api([[artifact(1)]], {
    1: { ...success, event: 'schedule', path: '.github/workflows/ci.yml' },
  })
  assert.equal(await findArtifact(github, repo, 'expected'), '1')
})

test('no available artifact requests a fresh build', async () => {
  assert.equal(await findArtifact(api([[]], {}), repo, 'expected'), '')
})

test('API errors are surfaced rather than silently treated as cache misses', async () => {
  const github = api([[artifact(1)]], {})
  github.rest.actions.getWorkflowRun = async () => { throw new Error('API unavailable') }
  await assert.rejects(findArtifact(github, repo, 'expected'), /API unavailable/)
})
