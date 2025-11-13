import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const library = process.argv[2]
if (!library) {
  console.error('Usage: node scripts/saint-headers.mjs <path-to-csv-files>')
  process.exit(1)
}

const definitions = readdirSync(
  fileURLToPath(
    new URL('../lib/SaintCoinach/SaintCoinach/Definitions', import.meta.url),
  ),
)

const output = {}
for (const file of readdirSync(library)) {
  if (!file.endsWith('.csv')) continue
  const sheet = file.replace('.csv', '')
  if (!definitions.includes(`${sheet}.json`)) continue

  const [_, header, type] = readFileSync(join(library, file), 'utf-8').split(
    '\n',
  )

  output[sheet] = {
    header: header
      .split(',')
      .map((a) => a.trim())
      .slice(1)
      .join(','),
    type: type
      .split(',')
      .map((a) => a.trim())
      .slice(1)
      .join(','),
  }
}

writeFileSync(
  fileURLToPath(
    new URL(
      '../packages/exd/test/__fixtures__/saintcoinach.json',
      import.meta.url,
    ),
  ),
  JSON.stringify(output, null, 2),
)
