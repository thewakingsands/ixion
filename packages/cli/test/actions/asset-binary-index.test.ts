import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { crc32 } from '@ffcafe/elpis-sqpack'
import { BinaryAssetIndex, encodeAssetIndex, type AssetIndexSource } from '../../src/actions/asset/binary-index'
const entry:AssetIndexSource={path:'ui/icon/000000/000000.tex',chunk:'01010101-0101-0101-0101-010101010101',chunkSize:15,offset:2,size:11,format:'webp'}
const fixture=Buffer.from(readFileSync(new URL('../fixtures/ixas-v2.hex',import.meta.url),'utf8').trim(),'hex')
function fixCRC(b:Buffer){b.writeUInt32LE(~crc32(b.subarray(64))>>>0,28);return b}
it('matches the shared Rust fixture and resolves icon and map paths',()=>{
  expect(encodeAssetIndex([entry])).toEqual(fixture)
  const {path,...ref}=entry
  expect(new BinaryAssetIndex(fixture).lookup(path.toUpperCase())).toEqual(ref)
})
it('validates headers, CRCs, ranges and reserved fields',()=>{
  for(let i=0;i<fixture.length;i++){const b=Buffer.from(fixture);b[i]^=255;expect(()=>new BinaryAssetIndex(b)).toThrow()}
  for(let i=0;i<fixture.length;i++)expect(()=>new BinaryAssetIndex(fixture.subarray(0,i))).toThrow()
  for(const i of [84,96,100,104,106,107]){const b=Buffer.from(fixture);b[i]=255;expect(()=>new BinaryAssetIndex(fixCRC(b))).toThrow()}
  expect(()=>encodeAssetIndex([{...entry,offset:0xffffffff}])).toThrow()
  expect(()=>encodeAssetIndex([{...entry,size:0}])).toThrow()
  expect(()=>encodeAssetIndex([{...entry,chunk:'bad'}])).toThrow()
  expect(()=>encodeAssetIndex([entry,entry])).toThrow('collision')
  expect(()=>new BinaryAssetIndex(Buffer.from(fixture).fill(1,4,5))).toThrow()
})
it('uses snapshot-local chunk numbers, sorted UUIDs, and stable physical identities',()=>{
  const second={...entry,path:'ui/map/s1d1/00/s1d100_m.tex',chunk:'00000000-0000-0000-0000-000000000001'}
  const before=new BinaryAssetIndex(encodeAssetIndex([entry]))
  const after=new BinaryAssetIndex(encodeAssetIndex([entry,second]))
  expect(before.lookup(entry.path)).toEqual(after.lookup(entry.path))
  expect(after.chunks[0].id).toBe(second.chunk)
  expect(after.lookup('ui/icon/000000/000001.tex')).toBeUndefined()
  expect(()=>after.lookup('../bad')).toThrow()
  expect(new BinaryAssetIndex(encodeAssetIndex([])).count).toBe(0)
})
it('rejects actual SqPack hash collisions',()=>{
  const entries=['ui/icon/000000/15f019c1.tex','ui/icon/000000/2be409ef.tex'].map(path=>({...entry,path}))
  expect(()=>encodeAssetIndex(entries)).toThrow('collision')
})
it('supports all 65536 chunk slots, including 65535, and rejects overflow',()=>{
  const entries=Array.from({length:65536},(_,i)=>({...entry,
    path:`ui/test/${i.toString(16)}.tex`,chunk:`00000000-0000-0000-0000-${i.toString(16).padStart(12,'0')}`}))
  const bytes=encodeAssetIndex(entries),index=new BinaryAssetIndex(bytes)
  expect(index.chunks).toHaveLength(65536)
  expect(index.lookup(entries[65535].path)?.chunk).toBe(entries[65535].chunk)
  expect(()=>encodeAssetIndex([...entries,{...entry,path:'ui/extra.tex',chunk:'ffffffff-ffff-ffff-ffff-ffffffffffff'}])).toThrow('65536')
},20000)
