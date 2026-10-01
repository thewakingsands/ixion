/** Bounded streaming map: completed work frees a slot without waiting for earlier items. */
export async function* mapUnordered<T, R>(
  source: Iterable<T> | AsyncIterable<T>,
  mapper: (value: T) => Promise<R>,
  concurrency: number,
): AsyncGenerator<R> {
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new Error('Concurrency must be a positive integer')
  type Outcome =
    | { task: Promise<Outcome>; ok: true; value: R }
    | { task: Promise<Outcome>; ok: false; error: unknown }
  const iterator =
    Symbol.asyncIterator in source
      ? source[Symbol.asyncIterator]()
      : source[Symbol.iterator]()
  const pending = new Set<Promise<Outcome>>()
  const completed: Outcome[] = []
  let wake: (() => void) | undefined
  let done = false
  try {
    while (!done || pending.size > 0) {
      while (!done && pending.size < concurrency) {
        const next = await iterator.next()
        done = Boolean(next.done)
        if (next.done) break
        const task: Promise<Outcome> = Promise.resolve()
          .then(() => mapper(next.value))
          .then(
            (value) => ({ task, ok: true, value }),
            (error: unknown) => ({ task, ok: false, error }),
          )
        pending.add(task)
        void task.then((result) => {
          completed.push(result)
          wake?.()
          wake = undefined
        })
      }
      if (pending.size === 0) break
      // One notification per completion; repeated Promise.race would accumulate
      // listeners on a slow task as thousands of fast tasks finish beside it.
      if (completed.length === 0)
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      const result = completed.shift()
      if (!result) throw new Error('Missing completed task')
      pending.delete(result.task)
      if (!result.ok) throw result.error
      yield result.value
    }
  } finally {
    // Do not close readers or return an error while started work still uses them.
    try {
      await iterator.return?.()
    } finally {
      await Promise.all(pending)
    }
  }
}
