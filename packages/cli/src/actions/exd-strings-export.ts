import { mkdir } from 'node:fs/promises'
import { type DefinitionProvider, StringsExporter } from '@ffcafe/ixion-exd'
import { ExdBase, type ServerVersion } from './exd-base'

export async function exportExdStrings({
  serverVersions,
  outputDir,
  definitions,
  filter,
}: {
  serverVersions: ServerVersion[]
  outputDir: string
  definitions: DefinitionProvider
  filter?: (path: string) => boolean
}) {
  const exdBase = new ExdBase(serverVersions)
  try {
    const stringsExporter = new StringsExporter({
      definitions,
    })

    console.log(`🔍 Downloading EXD files...`)
    await exdBase.prepareReaders()

    // Ensure output directory exists
    await mkdir(outputDir, { recursive: true })

    console.log(`🔍 Exporting strings...`)
    await stringsExporter.export(exdBase.readers, outputDir, filter)

    console.log(`✅ String export completed`)
  } finally {
    await exdBase.close()
  }
}
