import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { AssetCatalog } from '../../src/actions/asset/catalog'
import { PublicationPlanFile, type PublicationPlan } from '../../src/actions/asset/publication-plan'

const plan: PublicationPlan = {
  id: 'test-publication', base: 'null', version: '1', current: '{}',
  indexDigest: 'index', catalogDigest: 'catalog', destination: 'destination',
}

it('persists a readable, removable JSON plan independently of catalog metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ixion-plan-'))
  const db = new AssetCatalog(join(root, 'catalog.sqlite'), root)
  try {
    db.set('base', 'baseline')
    const file = new PublicationPlanFile(root)
    expect(file.read()).toBeNull()
    file.write(plan)
    expect(file.read()).toEqual(plan)
    expect(await readFile(file.path, 'utf8')).toContain('\n  "id":')
    expect(db.get('pending')).toBeUndefined()
    file.clear()
    file.clear()
    file.migrateLegacy(db)
    expect(file.exists()).toBe(false)
    expect(db.get('base')).toBe('baseline')
  } finally { db.close(); await rm(root, {recursive:true, force:true}) }
})

it('migrates old SQLite plans once and tolerates an interrupted matching migration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ixion-plan-'))
  const db = new AssetCatalog(join(root, 'catalog.sqlite'), root)
  try {
    const file = new PublicationPlanFile(root)
    db.set('pending', JSON.stringify(plan))
    file.migrateLegacy(db)
    expect(file.read()).toEqual(plan)
    expect(db.get('pending')).toBeUndefined()
    // Simulate a crash after writing JSON but before removing the old DB entry.
    db.set('pending', JSON.stringify(plan))
    file.migrateLegacy(db)
    expect(file.read()).toEqual(plan)
    expect(db.get('pending')).toBeUndefined()
    db.snapshot(join(root, 'snapshot.sqlite'))
    const snapshot = new AssetCatalog(join(root,'snapshot.sqlite'), root, undefined, true)
    try { expect(snapshot.get('pending')).toBeUndefined() } finally { snapshot.close() }
    // User deletion must not resurrect the already migrated plan.
    file.clear()
    file.migrateLegacy(db)
    expect(file.read()).toBeNull()
  } finally { db.close(); await rm(root, {recursive:true, force:true}) }
})

it('preserves both plans on conflict and never clears the DB entry if JSON is unreadable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ixion-plan-'))
  const db = new AssetCatalog(join(root, 'catalog.sqlite'), root)
  try {
    const file = new PublicationPlanFile(root)
    db.set('pending', JSON.stringify(plan))
    file.write({...plan, id:'another'})
    expect(() => file.migrateLegacy(db)).toThrow('Conflicting')
    expect(file.read()?.id).toBe('another')
    expect(db.get('pending')).toBe(JSON.stringify(plan))
    await writeFile(file.path, '{broken')
    expect(() => file.migrateLegacy(db)).toThrow()
    expect(db.get('pending')).toBe(JSON.stringify(plan))
    expect(await readFile(file.path,'utf8')).toBe('{broken')
  } finally { db.close(); await rm(root, {recursive:true, force:true}) }
})
