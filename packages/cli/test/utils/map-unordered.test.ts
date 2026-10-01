import { expect, it, vi } from 'vitest'
import { mapUnordered } from '../../src/utils/map-unordered'

it('drains started work and closes the source before propagating a mapper error', async () => {
  const gate = Promise.withResolvers<void>()
  const failure = Promise.withResolvers<void>()
  const error = new Error('encode failed')
  let closed = false
  let settled = false
  let started = 0
  function* source() {
    try { yield* [0, 1, 2, 3] } finally { closed = true }
  }
  const run = (async () => {
    for await (const _ of mapUnordered(source(), async (value) => {
      ++started
      if (value === 0) {
        await failure.promise
        throw error
      }
      await gate.promise
    }, 2)) { /* consume */ }
  })().then(() => undefined, (cause: unknown) => cause).finally(() => { settled = true })
  try {
    await vi.waitFor(() => expect(started).toBe(2))
    failure.resolve()
    await vi.waitFor(() => expect(closed).toBe(true))
    expect(settled).toBe(false)
    expect(started).toBe(2)
  } finally {
    failure.resolve()
    gate.resolve()
  }
  expect(await run).toBe(error)
})

it('drains in-flight work when reading the source fails', async () => {
  const gate = Promise.withResolvers<void>()
  const error = new Error('read failed')
  let settled = false
  let started = false
  function* source() { yield 0; throw error }
  const run = (async () => {
    for await (const _ of mapUnordered(source(), async () => {
      started = true
      await gate.promise
    }, 2)) { /* consume */ }
  })().catch((cause: unknown) => cause).finally(() => { settled = true })
  try {
    await vi.waitFor(() => expect(started).toBe(true))
    expect(settled).toBe(false)
  } finally { gate.resolve() }
  expect(await run).toBe(error)
})
