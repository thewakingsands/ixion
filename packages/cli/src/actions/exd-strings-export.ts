import { mkdir } from 'node:fs/promises'
import { StringsExporter } from '@ffcafe/ixion-exd'
import { ExdBase, type ServerVersion } from './exd-base'

export async function exportExdStrings({
  serverVersions,
  outputDir,
  filter,
}: {
  serverVersions: ServerVersion[]
  outputDir: string
  filter?: (path: string) => boolean
}) {
  const exdBase = new ExdBase(serverVersions)
  try {
    const stringsExporter = new StringsExporter({
      outputDir,
    })

    console.log(`🔍 Downloading EXD files...`)
    await exdBase.prepareReaders()

    // Ensure output directory exists
    await mkdir(outputDir, { recursive: true })

    console.log(`🔍 Exporting strings...`)
    await stringsExporter.export(exdBase.readers, filter)

    console.log(`✅ String export completed`)
  } finally {
    await exdBase.close()
  }
}
