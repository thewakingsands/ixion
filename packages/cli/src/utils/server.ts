import { servers } from '@ffcafe/ixion-server'
import type { Language } from '@ffcafe/ixion-utils'

export function getServerLanguages(server: string): Language[] {
  return servers[server as keyof typeof servers].languages
}
