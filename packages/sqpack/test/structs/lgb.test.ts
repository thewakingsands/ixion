import { describe, expect, it } from 'vitest'
import { readLgbFile } from '../../src/structs/lgb'

function fixture() {
  const data = Buffer.alloc(256)
  data.write('LGB1')
  data.writeInt32LE(256, 4)
  data.writeInt32LE(1, 8)
  data.write('LGP1', 12)
  data.writeInt32LE(24, 16)
  data.writeInt32LE(7, 20)
  data.writeInt32LE(16, 28)
  data.writeInt32LE(2, 32)
  // Reversed layer order proves offsets, not sequential reads, select layers.
  data.writeInt32LE(92, 36)
  data.writeInt32LE(12, 40)
  data.writeUInt32LE(2, 48)
  data.writeUInt32LE(1, 128)
  data.writeInt32LE(52, 136)
  data.writeInt32LE(1, 140)
  data.writeUInt16LE(19, 152)
  data.writeInt32LE(4, 180)
  data.writeInt32LE(49, 184)
  data.writeUInt32LE(12345, 188)
  data.writeInt32LE(48, 192)
  data.writeFloatLE(100, 196)
  data.writeFloatLE(-20, 200)
  data.writeFloatLE(300, 204)
  data.write('event\0', 232)
  return data
}

describe('LGB metadata', () => {
  it('follows relative layer, object and name offsets', () => {
    const lgb = readLgbFile(fixture())
    expect(lgb.layers.map((layer) => layer.layerId)).toEqual([1, 2])
    expect(lgb.layers[0].festivalId).toBe(19)
    expect(lgb.layers[0].instanceObjects[0]).toMatchObject({ assetType: 49, instanceId: 12345, name: 'event', transform: { translation: { x: 100, y: -20, z: 300 } } })
  })
  it('retains unknown asset metadata without interpreting its payload', () => {
    const data = fixture()
    data.writeInt32LE(9999, 184)
    expect(readLgbFile(data).layers[0].instanceObjects[0].assetType).toBe(9999)
  })
  it.each([4, 16, 28, 32, 36, 136, 140, 180, 192])('rejects corrupt sizes, counts and offsets at %i', (offset) => {
    const data = fixture()
    data.writeInt32LE(0x7fffffff, offset)
    expect(() => readLgbFile(data)).toThrow()
  })
  it('rejects truncated input', () => {
    expect(() => readLgbFile(fixture().subarray(0, 200))).toThrow()
  })
})
