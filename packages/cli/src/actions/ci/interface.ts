import type { ServerVersion } from '../exd-base'

export interface Archive extends ServerVersion {
  path: string
  hash?: Record<string, string | undefined>
}
