import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StorageManager } from '@ffcafe/ixion-storage'
import { expect, it, vi } from 'vitest'
import { AssetStorage } from '../../src/actions/asset/storage'
import { createAssetStateEntry } from '../../src/actions/asset/patch'
import { digest } from '../../src/actions/asset/catalog'
import { PublicationLock, readPublicationLock, unlockPublication } from '../../src/actions/asset/publication'
import { getStorageManager } from '../../src/utils/storage'
vi.mock('../../src/utils/storage',()=>({getStorageManager:vi.fn()}))
vi.mock('../../src/actions/asset/texture',()=>({formatTex:vi.fn(async(data:Buffer)=>({format:'webp',data}))}))
const storageName = process.env.IXION_TEST_S3 || process.env.IXION_TEST_MINIO
it.skipIf(!storageName)('isolated S3 Range, publication failure and resume with the configured policy',async()=>{
  const config=JSON.parse(await readFile(new URL('../../../../.ixion-config.json',import.meta.url),'utf8'))
  const source=config.storages.find((s:{name:string})=>s.name===storageName)
  if(!source||!['minio','s3'].includes(source.type))throw new Error('Named S3 storage is required')
  const root=await mkdtemp(join(tmpdir(),'ixion-minio-chunks-')),testId=randomUUID()
  const prefix=[source.config.prefix,'chunk-tests',testId].filter(Boolean).join('/')
  const manager=new StorageManager([
    {name:'local',type:'local',config:{rootPath:root}},
    {...source,name:'isolated',config:{...source.config,prefix}},
  ])
  vi.mocked(getStorageManager).mockReturnValue(manager)
  const remote=manager.getStorage('isolated')!
  const creates=vi.spyOn(remote,'createFile'),writes=vi.spyOn(remote,'writeFile')
  const keys=new Set<string>()
  const server='test'
  const sync=async(resume=false)=>{
    const s=new AssetStorage({server,storage:'isolated'})
    try{await s.syncToRemote(undefined,{syncAssets:true,resume})}finally{s.close()}
  }
  try {
    await remote.writeFile(server,'ui','probe',Buffer.from('0123456789'))
    // Exercise the actual server's byte-range behavior using the adapter's SDK client.
    const client=Reflect.get(remote,'client')
    const stream=await client.getPartialObject(source.config.bucketName,remote.getRootPath('ui',server)+'/probe',2,4)
    const parts:Buffer[]=[];for await(const b of stream)parts.push(b)
    expect(Buffer.concat(parts).toString()).toBe('2345')
    if(process.env.IXION_TEST_MINIO_EXPECT_UNSUPPORTED) {
      await expect(remote.createFile(server,'ui','guarded',Buffer.from('x'))).rejects.toThrow('does not enforce')
      expect(await remote.readFileStrict(server,'ui','guarded')).toBeNull()
      console.log('Verified Range and fail-closed conditional-write guard in isolated prefix: '+prefix)
      return
    }
    if(remote.getPublicationPolicy().mode==='conditional')
      expect(await remote.createFile(server,'ui','probe',Buffer.from('BAD'))).toBe(false)
    expect((await remote.readFileStrict(server,'ui','probe'))?.toString()).toBe('0123456789')
    const held=await PublicationLock.acquire(remote,server,remote.getPublicationPolicy(),randomUUID(),false)
    const heldRecord=(await readPublicationLock(remote,server))!
    await expect(PublicationLock.acquire(remote,server,remote.getPublicationPolicy(),randomUUID(),false)).rejects.toThrow('locked')
    await expect(unlockPublication(remote,server,randomUUID(),true)).rejects.toThrow('does not match')
    await held.assertOwned()
    await unlockPublication(remote,server,heldRecord.owner,true)
    const storage=new AssetStorage({server})
    try {
      await storage.loadExistingAssets('1')
      const data=Buffer.from('real MinIO chunk fixture'),hash=digest(data),path='ui/icon/000000/000001.tex'
      await storage.ensureEncodedAsset(hash,data)
      await storage.writeAssetState('1',new Map([[path,createAssetStateEntry(path,hash,'webp')]]))
      await storage.writeCurrentReference({ffxiv:'1',lastValidIndex:'1'})
    }finally{storage.close()}
    const original=Object.getPrototypeOf(remote).writeFile.bind(remote)
    writes.mockImplementation(async(...args)=>{
      if(args[2]==='current.json')throw new Error('simulated pointer failure')
      return original(...args)
    })
    await expect(sync()).rejects.toThrow('simulated pointer failure')
    expect(await remote.readFileStrict(server,'ui','current.json')).toBeNull()
    writes.mockImplementation(original)
    await sync(true)
    const ref=JSON.parse((await remote.readFileStrict(server,'ui','current.json'))!.toString())
    expect(ref.ffxiv).toBe('1')
    expect(await remote.readFileStrict(server,'ui','publish.lock')).toBeNull()
    const reads=vi.spyOn(remote,'readFileStrict')
    const next=new AssetStorage({server,storage:'isolated'})
    try {
      await next.loadExistingAssets('1')
      const state=await next.loadAssetState('1')
      await next.writeAssetState('2',state)
      await next.writeCurrentReference({ffxiv:'2',lastValidIndex:'2'})
    } finally {next.close()}
    const writtenBefore=writes.mock.calls.length
    await sync()
    expect(reads.mock.calls.some(c=>c[2].startsWith('chunks/'))).toBe(false)
    expect(writes.mock.calls.slice(writtenBefore).some(c=>c[2].startsWith('chunks/'))).toBe(false)
    if(remote.getPublicationPolicy().mode==='cooperative')expect(creates).not.toHaveBeenCalled()
    console.log('Verified isolated S3 chunk publication and unchanged-chunk reuse: '+prefix)
  }finally{
    for(const call of [...creates.mock.calls,...writes.mock.calls])keys.add(call[2])
    // Only delete exact keys created by this test, never enumerate a bucket.
    for(const key of keys)await remote.deleteFile(server,'ui',key)
    await rm(root,{recursive:true,force:true})
  }
},120000)
