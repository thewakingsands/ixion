import type { ServerVersion } from '../exd-build'

export interface Archive extends ServerVersion {
  path: string
  hash?: Record<string, string | undefined>
}
