import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { ciVersionsPath, serversToCheck } from './actions/ci/constants'
import { commitAndPush, writeGithubOutput } from './actions/ci/github'
import {
  maxStatusBytes,
  type Observation,
  observeStatus,
  parseBaselines,
  parseStatus,
} from './actions/status'

async function readBounded(path: string): Promise<string> {
  if ((await stat(path)).size > maxStatusBytes)
    throw new Error('Input exceeds 1 MiB')
  const data = await readFile(path)
  if (data.length > maxStatusBytes) throw new Error('Input exceeds 1 MiB')
  return new TextDecoder('utf-8', { fatal: true }).decode(data)
}
const missing = (error: NodeJS.ErrnoException) => {
  if (error.code === 'ENOENT') return '{}'
  throw error
}
const observedPath = '.ci/versions-observed.json'

export async function runStatus(
  args: string[],
  env = process.env,
  cwd = process.cwd(),
): Promise<Observation | undefined> {
  const { values, tokens } = parseArgs({
    tokens: true,
    args,
    options: {
      baselines: { type: 'string', default: ciVersionsPath },
      output: { type: 'string', default: observedPath },
      commit: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
  })
  if (values.help) {
    console.log(
      'Usage: pnpm status [--baselines .ci/versions.json] [--output .ci/versions-observed.json]\n       pnpm status --commit  (commit and push observations; emit GitHub outputs)',
    )
    return
  }
  if (values.commit && values.output !== observedPath)
    throw new Error('--commit only publishes .ci/versions-observed.json')
  const baselineText = await readBounded(resolve(cwd, values.baselines)).catch(
    (error) => {
      if (tokens.some((t) => t.kind === 'option' && t.name === 'baselines'))
        throw error
      return missing(error)
    },
  )
  const baselines = parseBaselines(baselineText)
  const output = resolve(cwd, values.output)
  const previous = parseStatus(await readBounded(output).catch(missing))
  const result = await observeStatus({ baselines, previous })
  const versions = parseStatus(JSON.stringify(result.versions))
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
  if (values.commit) {
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

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  runStatus(process.argv.slice(2)).catch(() => {
    console.error(
      'Version observation failed. Check input files and Git publication; downstream update must not run.',
    )
    process.exitCode = 1
  })
}
