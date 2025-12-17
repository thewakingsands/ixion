import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { createActionAuth } from '@octokit/auth-action'
import { Octokit } from '@octokit/rest'
import { $ } from 'execa'
import { kebabCase } from '../../utils/case'
import { calculateHashForFile } from '../../utils/hash'
import {
  ciGitUserEmail,
  ciGitUserName,
  ciVersionMessage,
  ciVersionsPath,
  mergedVersionServer,
} from './constants'
import type { Archive } from './interface'
import { writeReleasedVersions } from './version'

/**
 * Check if running in GitHub Actions
 */
export function isGitHubActions(): boolean {
  return process.env.GITHUB_ACTIONS === 'true'
}

async function configGit(): Promise<void> {
  await $`git config --global user.name ${ciGitUserName}`
  await $`git config --global user.email ${ciGitUserEmail}`
}

export async function commitAndPush(
  path: string,
  message: string,
): Promise<string> {
  await configGit()

  await $`git pull`
  await $`git add ${path}`
  await $`git commit -m ${message}`
  await $`git push`

  const hash = await $`git rev-parse HEAD`
  return hash.stdout.trim()
}

/**
 * Create GitHub release
 */
export async function createGitHubRelease(
  versions: Record<string, string>,
  archives: Archive[],
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

  const hash = await commitAndPush(ciVersionsPath, ciVersionMessage)
  const date = new Date().toISOString().replace(/[-:]/g, '').split('T')[0]
  const name = `${date}-${hash.slice(0, 7)}`

  // calc sha256sum of merged archive
  const mergedArchive = archives.find(
    ({ server }) => server === mergedVersionServer,
  )
  const sha256sum = mergedArchive
    ? calculateHashForFile(mergedArchive.path, 'sha256') || ''
    : ''

  // Create release
  const release = await octokit.repos.createRelease({
    owner,
    repo,
    tag_name: `publish/${name}`,
    name,
    body: [
      '| Server | Version | exeHash | 0aHash |',
      '| ------ | ------- | ------- | ------ |',
      ...archives.map(
        ({ server, version, hash }) =>
          `| ${kebabCase(server)} | ${version} | ${hash?.exe || '-'} | ${hash?.excel || '-'} |`,
      ),
      `\nsha256sum of merged archive:\n\`\`\`\n${sha256sum}\n\`\`\``,
    ].join('\n'),
    draft: false,
    prerelease: false,
  })

  console.log(`✅ Created GitHub release: ${name}`)

  // Upload assets
  for (const { path } of archives) {
    const archiveName = basename(path)
    const fileData = readFileSync(path)
    await octokit.repos.uploadReleaseAsset({
      owner,
      repo,
      release_id: release.data.id,
      name: archiveName,
      data: fileData as unknown as string,
    })

    console.log(`✅ Uploaded ${archiveName} to release`)
  }
}

export function writeGithubOutput(key: string, value: string) {
  const file = process.env.GITHUB_OUTPUT
  if (!file) {
    throw new Error('GITHUB_OUTPUT environment variable is required')
  }
  writeFileSync(file, `${key}=${value}\n`, { flag: 'a' })
}
