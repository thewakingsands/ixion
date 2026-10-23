import { Readable } from 'node:stream'
import { MinioStorage } from '@ffcafe/ixion-storage'
import { expect, it, vi } from 'vitest'
function fixture(enforce=true) {
  const storage=new MinioStorage({name:'test',type:'minio',config:{
    endPoint:'localhost',port:9000,useSSL:false,accessKey:'test',secretKey:'test-secret',bucketName:'test-bucket',
  }})
  const client=Reflect.get(storage,'client'),objects=new Map<string,Buffer>()
  vi.spyOn(client,'send').mockImplementation(async(command:any)=>{
    const input=command.input
    switch(command.constructor.name) {
      case 'PutObjectCommand':
        expect(input.IfNoneMatch).toBe('*')
        if(enforce&&objects.has(input.Key))throw Object.assign(new Error('exists'),{name:'PreconditionFailed'})
        objects.set(input.Key,Buffer.from(input.Body))
        return {}
      case 'GetObjectCommand': {
        const value=objects.get(input.Key)
        if(!value)throw Object.assign(new Error('missing'),{name:'NoSuchKey'})
        return {Body:Readable.from([value])}
      }
      case 'DeleteObjectCommand': objects.delete(input.Key); return {}
      default: throw new Error('Unexpected command '+command.constructor.name)
    }
  })
  return {storage,client,objects}
}
it('preserves conditional headers and uses a single shared capability check',async()=>{
  const {storage,objects,client}=fixture()
  const result=await Promise.all([
    storage.createFile('s','ui','chunks/one.bin',Buffer.from('first')),
    storage.createFile('s','ui','chunks/one.bin',Buffer.from('second')),
  ])
  expect(result.sort()).toEqual([false,true])
  expect(objects.size).toBe(1)
  expect(client.send.mock.calls.filter(([command]:any[])=>command.constructor.name==='PutObjectCommand')).toHaveLength(4)
  expect(await storage.readFileStrict('s','ui','missing')).toBeNull()
})
it('refuses an endpoint that silently ignores conditional creation',async()=>{
  const {storage,objects}=fixture(false)
  await expect(storage.createFile('s','ui','publish.lock',Buffer.from('lock'))).rejects.toThrow('does not enforce')
  expect(objects.size).toBe(0)
  await expect(storage.createFile('s','ui','chunks/one.bin',Buffer.from('image'))).rejects.toThrow('does not enforce')
  expect(objects.size).toBe(0)
})
it('does not treat authentication or transport errors as missing metadata',async()=>{
  const {storage,client}=fixture()
  client.send.mockRejectedValue(Object.assign(new Error('denied'),{name:'AccessDenied'}))
  await expect(storage.readFileStrict('s','ui','current.json')).rejects.toThrow('denied')
})
