import { readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createActionAuth } from '@octokit/auth-action'
import { Octokit } from '@octokit/rest'
import { $ } from 'execa'
import { kebabCase } from '../../utils/case'
import {
  ciGitUserEmail,
  ciGitUserName,
  ciVersionMessage,
  ciVersionsPath,
} from './constants'
import type { Archive } from './interface'
import { writeReleasedVersions } from './version'

/**
 * Check if running in GitHub Actions
 */
export function isGitHubActions(): boolean {
  return process.env.GITHUB_ACTIONS === 'true'
}

export async function commitAndPush(
  path: string,
  message: string,
  cwd = process.cwd(),
  sync = true,
): Promise<string> {
  const git = $({ cwd })
  const status = await git`git status --porcelain -- ${path}`
  if (status.stdout.trim()) {
    await git`git config user.name ${ciGitUserName}`
    await git`git config user.email ${ciGitUserEmail}`
    if (sync) await git`git pull --ff-only`
    await git`git add -- ${path}`
    // Other staged work must not enter automated version commits.
    await git`git commit --only -m ${message} -- ${path}`
    await git`git push`
  }
  const hash = await git`git rev-parse HEAD`
  return hash.stdout.trim()
}

/** Publish complete assets before advancing the released-version record. */
export async function createGitHubRelease(
  versions: Record<string, string>,
  archives: Archive[],
  extraAssets: string[] = [],
  options: {
    octokit?: Octokit
    cwd?: string
    env?: NodeJS.ProcessEnv
  } = {},
): Promise<void> {
  const { cwd = process.cwd(), env = process.env } = options
  const [owner, repo] = (env.GITHUB_REPOSITORY || '').split('/')
  if (!owner || !repo) {
    throw new Error('GITHUB_REPOSITORY environment variable is required')
  }
  if (!env.GITHUB_RUN_ID) {
    throw new Error('GITHUB_RUN_ID environment variable is required')
  }
  const octokit =
    options.octokit ?? new Octokit({ authStrategy: createActionAuth })
  const git = $({ cwd })
  const { stdout: source } = await git`git rev-parse HEAD`
  const tag = `publish/${env.GITHUB_RUN_ID}`
  const assets = [...archives.map(({ path }) => path), ...extraAssets].map(
    (path) => ({ name: basename(path), path }),
  )
  const names = assets.map(({ name }) => name).sort()
  const body = [
    '| Server | Version | Trunk | exeHash | 0aHash |',
    '| ------ | ------- | ----- | ------- | ------ |',
    ...archives.map(
      ({ server, version, trunk, hash }) =>
        `| ${kebabCase(server)} | ${version} | ${trunk || '-'} | ${hash?.exe?.slice(0, 8) || '-'} | ${hash?.excel?.slice(0, 8) || '-'} |`,
    ),
  ].join('\n')
  let release:
    | Awaited<ReturnType<typeof octokit.repos.createRelease>>['data']
    | undefined
  for await (const { data } of octokit.paginate.iterator(
    octokit.repos.listReleases,
    { owner, repo, per_page: 100 },
  )) {
    release = data.find((item) => item.tag_name === tag)
    if (release) break
  }
  if (!release) {
    release = (
      await octokit.repos.createRelease({
        owner,
        repo,
        tag_name: tag,
        name: tag,
        body,
        target_commitish: source.trim(),
        draft: true,
        prerelease: false,
      })
    ).data
  }
  const releaseArgs = { owner, repo, release_id: release.id }
  const listAssets = () =>
    octokit.paginate(octokit.repos.listReleaseAssets, {
      ...releaseArgs,
      per_page: 100,
    })
  if (release.draft) {
    for (const asset of await listAssets()) {
      await octokit.repos.deleteReleaseAsset({
        owner,
        repo,
        asset_id: asset.id,
      })
    }
    await octokit.repos.updateRelease({ ...releaseArgs, body })
    for (const { name, path } of assets) {
      await octokit.repos.uploadReleaseAsset({
        ...releaseArgs,
        name,
        data: readFileSync(path) as unknown as string,
      })
      console.log(`✅ Uploaded ${name} to release`)
    }
  }
  const uploaded = await listAssets()
  if (
    uploaded.some((asset) => asset.state !== 'uploaded') ||
    JSON.stringify(uploaded.map(({ name }) => name).sort()) !==
      JSON.stringify(names)
  ) {
    throw new Error(
      `Release ${tag} assets do not match this run; start a new workflow run if already public`,
    )
  }
  if (release.draft) {
    await octokit.repos.updateRelease({ ...releaseArgs, draft: false })
  }
  console.log(`✅ Published GitHub release: ${tag}`)

  // Pull before modifying the version file; never include unrelated staged work.
  await git`git pull --ff-only`
  writeReleasedVersions(versions, join(cwd, ciVersionsPath))
  await commitAndPush(ciVersionsPath, ciVersionMessage, cwd, false)
}

export function writeGithubOutput(
  key: string,
  value: string,
  file = process.env.GITHUB_OUTPUT,
) {
  if (!file) {
    throw new Error('GITHUB_OUTPUT environment variable is required')
  }
  writeFileSync(file, `${key}=${value}\n`, { flag: 'a' })
}
