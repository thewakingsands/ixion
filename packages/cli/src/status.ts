import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import {
  maxStatusBytes,
  observeStatus,
  parseBaselines,
  parseStatus,
  type Status,
} from './actions/status'
import { publishStatus, statusTarget } from './actions/status-storage'

async function readBounded(path: string) {
  if ((await stat(path)).size > maxStatusBytes)
    throw new Error('Input exceeds 1 MiB')
  const data = await readFile(path)
  if (data.length > maxStatusBytes) throw new Error('Input exceeds 1 MiB')
  return new TextDecoder('utf-8', { fatal: true }).decode(data)
}

export async function runStatus(
  args: string[],
  env = process.env,
): Promise<Status | undefined> {
  const { values, tokens } = parseArgs({
    tokens: true,
    args,
    options: {
      baselines: { type: 'string', default: '.ci/versions.json' },
      previous: { type: 'string' },
      output: { type: 'string' },
      publish: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
  })
  if (values.help) {
    console.log(
      'Usage: pnpm status [--baselines .ci/versions.json] [--previous previous.json] --output status.json\n       pnpm status [--baselines .ci/versions.json] --publish',
    )
    return
  }
  if (
    values.publish
      ? values.previous !== undefined || values.output !== undefined
      : !values.output
  ) {
    throw new Error(
      'Choose --output or --publish; --previous is only supported with --output',
    )
  }
  const baselines = await readBounded(values.baselines)
    .then(parseBaselines)
    .catch((error) => {
      if (
        !tokens.some(
          (token) => token.kind === 'option' && token.name === 'baselines',
        ) &&
        error.code === 'ENOENT'
      )
        return {}
      throw error
    })
  let result: Status
  if (values.publish) {
    const target = statusTarget(env)
    try {
      result = await publishStatus(target, (previous) =>
        observeStatus({ baselines, previous }),
      )
    } finally {
      target.client.destroy()
    }
  } else {
    const previous = values.previous
      ? parseStatus(await readBounded(values.previous))
      : null
    result = parseStatus(
      JSON.stringify(await observeStatus({ baselines, previous })),
    )
    const output = resolve(values.output as string)
    const temporary = `${output}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`, {
        flag: 'wx',
      })
      await rename(temporary, output)
    } finally {
      await rm(temporary, { force: true })
    }
  }
  for (const r of result.regions)
    console.log(`${r.server}: ${r.error ?? 'ok'} (${r.attemptedAt})`)
  return result
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  runStatus(process.argv.slice(2)).catch(() => {
    // Upstream and SDK exceptions can include endpoints or credentials.
    console.error(
      'Status command failed. Check arguments, input files and S3 configuration; no further write was attempted after the failure.',
    )
    process.exitCode = 1
  })
}
