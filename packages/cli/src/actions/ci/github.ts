import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
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
): Promise<string> {
  const git = $({ cwd })
  const status = await git`git status --porcelain -- ${path}`
  if (status.stdout.trim()) {
    await git`git config user.name ${ciGitUserName}`
    await git`git config user.email ${ciGitUserEmail}`
    await git`git pull --ff-only`
    await git`git add -- ${path}`
    // Other staged work must not enter automated version commits.
    await git`git commit --only -m ${message} -- ${path}`
    await git`git push`
  }
  const hash = await git`git rev-parse HEAD`
  return hash.stdout.trim()
}

/**
 * Create GitHub release
 */
export async function createGitHubRelease(
  versions: Record<string, string>,
  archives: Archive[],
  extraAssets: string[] = [],
): Promise<void> {
  const octokit = new Octokit({
    authStrategy: createActionAuth,
  })

  const [owner, repo] = (process.env.GITHUB_REPOSITORY || '').split('/')
  if (!owner || !repo) {
    throw new Error('GITHUB_REPOSITORY environment variable is required')
  }

  // Write versions to file and commit
  writeReleasedVersions(versions)

  const commitHash = await commitAndPush(ciVersionsPath, ciVersionMessage)
  const date = new Date().toISOString().replace(/[-:]/g, '').split('T')[0]
  const name = `${date}-${commitHash.slice(0, 7)}`

  // Create release
  const assets = [...archives.map(({ path }) => path), ...extraAssets].map(
    (path) => ({
      name: basename(path),
      path,
    }),
  )

  const release = await octokit.repos.createRelease({
    owner,
    repo,
    tag_name: `publish/${name}`,
    name,
    body: [
      '| Server | Version | Trunk | exeHash | 0aHash |',
      '| ------ | ------- | ----- | ------- | ------ |',
      ...archives.map(
        ({ server, version, trunk, hash }) =>
          `| ${kebabCase(server)} | ${version} | ${trunk || '-'} | ${hash?.exe?.slice(0, 8) || '-'} | ${hash?.excel?.slice(0, 8) || '-'} |`,
      ),
    ].join('\n'),
    draft: false,
    prerelease: false,
  })

  console.log(`✅ Created GitHub release: ${name}`)

  // Upload assets
  for (const { name, path } of assets) {
    const fileData = readFileSync(path)
    await octokit.repos.uploadReleaseAsset({
      owner,
      repo,
      release_id: release.data.id,
      name,
      data: fileData as unknown as string,
    })

    console.log(`✅ Uploaded ${name} to release`)
  }
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
