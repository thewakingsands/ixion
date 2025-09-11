import { createWriteStream, existsSync, statSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { PatchEntry } from '@ffcafe/ixion-server'
import { verifyPatchHash } from './hash'

interface DownloadProgress {
  downloaded: number
  total: number
  speed: number
  percentage: number
}

export const getPatchFileName = (patch: PatchEntry): string => {
  const urlFileName = basename(patch.url)
  const urlExt = extname(urlFileName)
  return urlExt === '.patch' ? urlFileName : `${patch.version}.patch`
}

export const downloadPatch = async (
  patch: PatchEntry,
  cwd: string = process.cwd(),
): Promise<string> => {
  const patchesDir = join(cwd, 'patches', patch.repository)

  // Determine filename: use URL filename if it has correct extension, otherwise use version
  const fileName = getPatchFileName(patch)
  const filePath = join(patchesDir, fileName)

  // Ensure patches directory exists
  await mkdir(patchesDir, { recursive: true })

  // Check if file already exists and verify its size
  if (existsSync(filePath)) {
    const fileStats = statSync(filePath)
    const fileSize = fileStats.size

    if (fileSize === patch.patchSize) {
      console.log(
        `✓ Patch ${patch.version} already exists with correct size, skipping download`,
      )
      await verifyPatchHash(filePath, patch)
      return filePath
    } else {
      console.log(
        `⚠ Patch ${patch.version} exists but size mismatch (${formatBytes(fileSize)} vs ${formatBytes(patch.patchSize)}), re-downloading`,
      )
    }
  }

  console.log(`📥 Downloading patch ${patch.version}...`)
  console.log(`   URL: ${patch.url}`)
  console.log(`   Size: ${formatBytes(patch.patchSize)}`)

  const response = await fetch(patch.url)
  if (!response.ok) {
    throw new Error(
      `Failed to download patch: ${response.status} ${response.statusText}`,
    )
  }

  const contentLength = parseInt(
    response.headers.get('content-length') || '0',
    10,
  )
  const total = contentLength || patch.patchSize

  if (!response.body) {
    throw new Error('No response body available')
  }

  const writer = createWriteStream(filePath)
  const reader = response.body.getReader()

  let downloaded = 0
  let lastTime = Date.now()
  let lastDownloaded = 0

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) break

      writer.write(value)
      downloaded += value.length

      // Update progress every 100ms or when download completes
      const now = Date.now()
      if (now - lastTime >= 100 || downloaded === total) {
        const timeDiff = (now - lastTime) / 1000
        const speed = (downloaded - lastDownloaded) / timeDiff
        const percentage = (downloaded / total) * 100

        updateProgress({
          downloaded,
          total,
          speed,
          percentage,
        })

        lastTime = now
        lastDownloaded = downloaded
      }
    }

    writer.end()
    console.log() // New line after progress

    // Verify hash after download
    await verifyPatchHash(filePath, patch)
    console.log(
      `✅ Successfully downloaded and verified patch ${patch.version}`,
    )

    return filePath
  } catch (error) {
    writer.destroy()
    throw error
  }
}

const updateProgress = (progress: DownloadProgress) => {
  const { downloaded, total, speed, percentage } = progress

  const downloadedStr = formatBytes(downloaded)
  const totalStr = formatBytes(total)
  const speedStr = `${formatBytes(speed)}/s`
  const percentageStr = percentage.toFixed(1).padStart(5, ' ')

  // Create progress bar (50 characters wide)
  const barWidth = 50
  const filled = Math.floor((percentage / 100) * barWidth)
  const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled)

  process.stdout.write(
    `\r${percentageStr}% [${bar}] ${downloadedStr}/${totalStr} ${speedStr}`,
  )
}

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B'

  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`
}
