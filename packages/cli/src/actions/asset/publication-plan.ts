import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { type AssetCatalog, atomicWrite } from './catalog'

export const publicationPlanFileName = 'publication-plan.json'
export interface PublicationPlan {
  id: string
  base: string | null
  version: string
  current: string
  indexDigest: string
  catalogDigest: string
  destination: string
}

/** Local recovery state only; never part of an uploaded catalog snapshot. */
export class PublicationPlanFile {
  readonly path: string
  constructor(root: string) {
    this.path = join(root, publicationPlanFileName)
  }
  exists() {
    return existsSync(this.path)
  }
  read(): PublicationPlan | null {
    let bytes: string
    try {
      bytes = readFileSync(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    const value = JSON.parse(bytes) as PublicationPlan
    if (
      !value ||
      typeof value !== 'object' ||
      ![
        'id',
        'version',
        'current',
        'indexDigest',
        'catalogDigest',
        'destination',
      ].every(
        (key) => typeof value[key as keyof PublicationPlan] === 'string',
      ) ||
      (value.base !== null && typeof value.base !== 'string')
    )
      throw new Error(`Invalid publication plan: ${this.path}`)
    return value
  }
  write(plan: PublicationPlan) {
    atomicWrite(this.path, `${JSON.stringify(plan, null, 2)}\n`)
  }
  clear() {
    rmSync(this.path, { force: true })
  }
  migrateLegacy(db: AssetCatalog) {
    const legacy = db.get('pending')
    if (legacy === undefined) return
    const value = JSON.parse(legacy) as PublicationPlan
    const existing = this.read()
    if (existing !== null && !isDeepStrictEqual(existing, value))
      throw new Error(
        `Conflicting legacy and JSON publication plans; inspect ${this.path}`,
      )
    // Persist the file before deleting the DB entry. A crash between these steps
    // leaves matching copies and migration can be retried without losing a plan.
    if (existing === null) this.write(value)
    db.db.prepare("DELETE FROM meta WHERE key='pending'").run()
  }
}
