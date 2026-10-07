import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { StorageManager } from '@ffcafe/ixion-storage'
import { expect, it, vi } from 'vitest'
import { AssetCatalog, digest } from '../../src/actions/asset/catalog'
import { AssetStorage } from '../../src/actions/asset/storage'
import { createAssetStateEntry } from '../../src/actions/asset/patch'
import { BinaryAssetIndex } from '../../src/actions/asset/binary-index'
import { getStorageManager } from '../../src/utils/storage'
vi.mock('../../src/utils/storage',()=>({getStorageManager:vi.fn()}))
vi.mock('@ffcafe/ixion-tex',()=>({formatTex:vi.fn(async(data:Buffer)=>({format:'webp',data}))}))
const path='ui/icon/000000/000001.tex'
it('seals bounded immutable chunks, deduplicates, and never reopens a previous tail',async()=>{
  const root=await mkdtemp(join(tmpdir(),'ixion-chunks-'))
  const db=new AssetCatalog(join(root,'catalog.sqlite'),root,8)
  try{
    db.add('01'.repeat(32),'webp',Buffer.from('abcdef'))
    db.add('02'.repeat(32),'avif',Buffer.from('XYZ'))
    db.seal()
    const before=db.chunks()
    expect(before.map(c=>c.size).sort()).toEqual([3,6])
    expect(db.add('01'.repeat(32),'webp',Buffer.from('ignored'))).toBe(false)
    const original=await Promise.all(before.map(c=>readFile(join(root,'chunks',c.id+'.bin'))))
    db.add('03'.repeat(32),'webp',Buffer.from('0123456789'))
    db.seal()
    expect(db.chunks()).toHaveLength(3)
    for(let i=0;i<before.length;i++)expect(await readFile(join(root,'chunks',before[i].id+'.bin'))).toEqual(original[i])
    expect(()=>db.add('04'.repeat(32),'webp',Buffer.alloc(0))).toThrow()
    expect(()=>db.add('05'.repeat(32),'webp',Buffer.alloc(64*1024*1024+1))).toThrow()
    const entry=createAssetStateEntry(path,'01'.repeat(32),'webp')
    db.savePaths([entry],'1')
    const index=new BinaryAssetIndex(db.index([entry]))
    expect(index.chunks).toHaveLength(1)
    db.snapshot(join(root,'snapshot.sqlite'))
    const snapshot=new AssetCatalog(join(root,'snapshot.sqlite'),root,undefined,true)
    try{snapshot.validate();expect(snapshot.paths()).toHaveLength(1)}finally{snapshot.close()}
    db.savePaths([],'2')
    expect(new BinaryAssetIndex(db.index([])).count).toBe(0)
    expect(db.chunks()).toHaveLength(3)
  }finally{db.close();await rm(root,{recursive:true,force:true})}
})
it('publishes in order, resumes failures, rejects stale baselines and excludes simultaneous writers',async()=>{
  const root=await mkdtemp(join(tmpdir(),'ixion-publication-'))
  const manager=new StorageManager([
    {name:'local',type:'local',config:{rootPath:join(root,'local')}},
    {name:'remote',type:'local',config:{rootPath:join(root,'remote')}},
  ])
  vi.mocked(getStorageManager).mockReturnValue(manager)
  const remote=manager.getStorage('remote')!
  const listing=vi.spyOn(remote,'listFiles').mockRejectedValue(new Error('must not list'))
  const publish=async(data:string,version:string)=>{
    const storage=new AssetStorage({server:'test'})
    try{
      expect(()=>new AssetStorage({server:'test'})).toThrow('locked')
      await storage.loadExistingAssets(version)
      const hash=digest(Buffer.from(data))
      await storage.ensureEncodedAsset(hash,Buffer.from(data))
      await storage.writeAssetState(version,new Map([[path,createAssetStateEntry(path,hash,'webp')]]))
      await storage.writeCurrentReference({ffxiv:version,lastValidIndex:version})
    }finally{storage.close()}
  }
  const sync=async(resume=false)=>{
    const storage=new AssetStorage({server:'test',storage:'remote'})
    try{await storage.syncToRemote(undefined,{syncAssets:true,resume})}finally{storage.close()}
  }
  try{
    await publish('first','1')
    await sync()
    const before=await remote.readFileStrict('test','ui','current.json')
    const firstIndex=new BinaryAssetIndex((await remote.readFileStrict('test','ui','patches/1/assets.bin'))!)
    const firstChunk=await remote.readFileStrict('test','ui','chunks/'+firstIndex.chunks[0].id+'.bin')
    await publish('second','2')
    const original=remote.writeFile.bind(remote)
    const failure=vi.spyOn(remote,'writeFile').mockImplementation(async(...args)=>{
      if(args[2]==='current.json')throw new Error('pointer failed')
      return original(...args)
    })
    await expect(sync()).rejects.toThrow('pointer failed')
    expect(await remote.readFileStrict('test','ui','current.json')).toEqual(before)
    expect(await remote.readFileStrict('test','ui','publish.lock')).not.toBeNull()
    failure.mockRestore()
    await expect(sync()).rejects.toThrow('locked')
    await sync(true)
    const secondIndex=new BinaryAssetIndex((await remote.readFileStrict('test','ui','patches/2/assets.bin'))!)
    expect(secondIndex.chunks[0].id).not.toBe(firstIndex.chunks[0].id)
    expect(await remote.readFileStrict('test','ui','chunks/'+firstIndex.chunks[0].id+'.bin')).toEqual(firstChunk)
    expect(await remote.readFileStrict('test','ui','publish.lock')).toBeNull()
    const create=vi.spyOn(remote,'createFile')
    await sync()
    expect(create.mock.calls.filter(c=>c[2].startsWith('chunks/'))).toHaveLength(0)
    // A clean CI workspace needs only the remote catalog, not old chunk files.
    const freshManager=new StorageManager([
      {name:'local',type:'local',config:{rootPath:join(root,'fresh')}},
      {name:'remote',type:'local',config:{rootPath:join(root,'remote')}},
    ])
    vi.mocked(getStorageManager).mockReturnValue(freshManager)
    const fresh=new AssetStorage({server:'test',storage:'remote'})
    try{
      await fresh.loadExistingAssets('2')
      expect((await fresh.loadAssetState('2')).size).toBe(1)
      const hash=digest(Buffer.from('first'))
      expect(await fresh.ensureEncodedAsset(hash,Buffer.from('first'))).toEqual({format:'webp',persisted:false})
      await fresh.writeAssetState('3',new Map([[path,createAssetStateEntry(path,hash,'webp')]]))
      await fresh.writeCurrentReference({ffxiv:'3',lastValidIndex:'3'})
      await fresh.syncToRemote()
      const reused=new BinaryAssetIndex((await remote.readFileStrict('test','ui','patches/3/assets.bin'))!)
      expect(reused.lookup(path)?.chunk).toBe(firstIndex.lookup(path)?.chunk)
    }finally{fresh.close();vi.mocked(getStorageManager).mockReturnValue(manager)}
    await publish('third','3')
    const foreign=JSON.stringify({ffxiv:'2',lastValidIndex:'2',publication:'00000000-0000-0000-0000-000000000000'})
    await remote.writeFile('test','ui','current.json',foreign)
    await expect(sync()).rejects.toThrow('baseline changed')
    expect((await remote.readFileStrict('test','ui','current.json'))?.toString()).toBe(foreign)
    expect(listing).not.toHaveBeenCalled()
  }finally{await rm(root,{recursive:true,force:true})}
})
