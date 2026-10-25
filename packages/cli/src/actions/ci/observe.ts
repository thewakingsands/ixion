import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  type Observation,
  type ObservedVersions,
  observeStatus,
} from '../status'
import { ciVersionsPath, serversToCheck } from './constants'
import { commitAndPush, writeGithubOutput } from './github'

const missing = (error: NodeJS.ErrnoException) => {
  if (error.code === 'ENOENT') return '{}'
  throw error
}
const observedPath = '.ci/versions-observed.json'

export async function ciObserveCommand(
  { commit = false }: { commit?: boolean } = {},
  env = process.env,
  cwd = process.cwd(),
): Promise<Observation> {
  const baselines: ObservedVersions = JSON.parse(
    await readFile(resolve(cwd, ciVersionsPath), 'utf8').catch(missing),
  )
  const output = resolve(cwd, observedPath)
  const previous: ObservedVersions = JSON.parse(
    await readFile(output, 'utf8').catch(missing),
  )
  const result = await observeStatus({ baselines, previous })
  const versions = result.versions
  for (const server of serversToCheck)
    console.log(`${server}: ${result.errors[server] ?? versions[server]}`)
  if (JSON.stringify(versions) !== JSON.stringify(previous)) {
    await mkdir(dirname(output), { recursive: true })
    const temporary = `${output}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify(versions, null, 2)}\n`, {
        flag: 'wx',
      })
      await rename(temporary, output)
    } finally {
      await rm(temporary, { force: true })
    }
  }
  if (commit) {
    const sha = await commitAndPush(
      observedPath,
      'ci: update observed versions',
      cwd,
    )
    if (env.GITHUB_OUTPUT) {
      writeGithubOutput('sha', sha, env.GITHUB_OUTPUT)
      writeGithubOutput(
        'update_required',
        String(result.updateRequired),
        env.GITHUB_OUTPUT,
      )
    }
  }
  console.log(`update_required=${result.updateRequired}`)
  return result
}
