const root = process.env.XIVSTRINGS_ROOT?.trim()
const token = process.env.XIVSTRINGS_UPDATE_TOKEN?.trim()
const pollIntervalMs = Number(process.env.XIVSTRINGS_POLL_INTERVAL_MS ?? 10_000)
const timeoutMs = Number(process.env.XIVSTRINGS_TIMEOUT_MS ?? 30 * 60 * 1000)

if (!root) {
  throw new Error('Missing XIVSTRINGS_ROOT environment variable')
}

if (!token) {
  throw new Error('Missing XIVSTRINGS_UPDATE_TOKEN environment variable')
}

const startedAt = Date.now()

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const getVersionUrl = () => new URL('/api/version', root)

const getPostUrl = () => {
  const url = getVersionUrl()
  url.searchParams.set('token', token)
  return url
}

const requestJson = async (url, init) => {
  const response = await fetch(url, init)
  const text = await response.text()

  let body
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    body = { raw: text }
  }

  if (!response.ok) {
    const message = body?.error ?? body?.message ?? `HTTP ${response.status}`
    throw new Error(`${response.status} ${message}`)
  }

  return {
    status: response.status,
    body,
  }
}

const formatStatus = (payload) => {
  const update = payload?.update ?? {}
  const version = payload?.version ? ` version=${payload.version}` : ''
  const state = update.state ? ` state=${update.state}` : ''
  const startedAt = update.startedAt ? ` startedAt=${update.startedAt}` : ''
  const finishedAt = update.finishedAt ? ` finishedAt=${update.finishedAt}` : ''
  const updated =
    typeof update.updated === 'boolean'
      ? ` updated=${String(update.updated)}`
      : ''
  const error = update.error ? ` error=${update.error}` : ''
  return `${version}${state}${startedAt}${finishedAt}${updated}${error}`.trim()
}

const waitForCompletion = async (expectedStartedAt) => {
  while (true) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(
        `Timed out waiting for xivstrings update after ${timeoutMs}ms`,
      )
    }

    const { body: payload } = await requestJson(getVersionUrl())
    const state = payload?.update?.state ?? 'idle'
    const currentStartedAt = payload?.update?.startedAt

    console.log(`xivstrings status:${formatStatus(payload)}`)

    if (expectedStartedAt && currentStartedAt !== expectedStartedAt) {
      throw new Error(
        `Observed unexpected update job while waiting for ${expectedStartedAt}: ${formatStatus(payload)}`,
      )
    }

    if (state === 'success') {
      return payload
    }

    if (state === 'error') {
      throw new Error(payload?.update?.error ?? 'xivstrings update failed')
    }

    if (state !== 'running') {
      throw new Error(`Unexpected update state while polling: ${state}`)
    }

    await sleep(pollIntervalMs)
  }
}

const { status: triggerStatus, body: triggerPayload } = await requestJson(
  getPostUrl(),
  {
    method: 'POST',
  },
)

if (triggerStatus !== 202) {
  throw new Error(
    `Expected 202 Accepted from update trigger, got ${triggerStatus}`,
  )
}

if (triggerPayload?.update?.state !== 'running') {
  throw new Error(
    `Expected running update state from trigger response, got ${triggerPayload?.update?.state ?? 'missing'}`,
  )
}

console.log(
  `xivstrings update request accepted: ${triggerPayload.message ?? 'no message'} ${formatStatus(triggerPayload)}`.trim(),
)

const finalPayload = await waitForCompletion(triggerPayload.update.startedAt)
console.log(`xivstrings update finished:${formatStatus(finalPayload)}`)
