import { randomUUID } from 'node:crypto'
import type { AbstractStorage, PublicationPolicy } from '@ffcafe/ixion-storage'

const lockPath = 'publish.lock'
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/
export interface PublicationLockRecord {
  owner: string
  publication: string
  acquiredAt: string
}

function parseLock(bytes: Buffer): PublicationLockRecord {
  const value = JSON.parse(bytes.toString()) as PublicationLockRecord
  if (
    !value ||
    !uuid.test(value.owner) ||
    !uuid.test(value.publication) ||
    typeof value.acquiredAt !== 'string' ||
    !Number.isFinite(Date.parse(value.acquiredAt))
  )
    throw new Error(
      'Unrecognized publication lock; inspect it before manual recovery',
    )
  return value
}

export async function readPublicationLock(
  remote: AbstractStorage,
  server: string,
) {
  const bytes = await remote.readFileStrict(server, 'ui', lockPath)
  return bytes === null ? null : parseLock(bytes)
}

/** Remote ownership checks, not fencing: Garage can still race between GET and PUT/DELETE. */
export class PublicationLock {
  private constructor(
    private readonly remote: AbstractStorage,
    private readonly server: string,
    private readonly bytes: Buffer,
  ) {}

  static async acquire(
    remote: AbstractStorage,
    server: string,
    policy: PublicationPolicy,
    publication: string,
    resume: boolean,
  ) {
    if (!uuid.test(publication)) throw new Error('Invalid publication UUID')
    if (policy.mode === 'cooperative')
      console.warn(
        'Cooperative Garage lock: concurrent publication is not strictly safe; do not run multiple publishers.',
      )
    const bytes = Buffer.from(
      JSON.stringify({
        owner: randomUUID(),
        publication,
        acquiredAt: new Date().toISOString(),
      } satisfies PublicationLockRecord),
    )
    const active = await remote.readFileStrict(server, 'ui', lockPath)
    if (active !== null) {
      const previous = parseLock(active)
      if (!resume || previous.publication !== publication)
        throw new Error(
          `Publication locked by ${previous.owner} for ${previous.publication}; stop its writer before resuming or explicitly unlocking`,
        )
      // --resume explicitly asserts that the old writer was stopped. Rotate the owner
      // token even for the same publication, so the old process detects the takeover.
      const again = await remote.readFileStrict(server, 'ui', lockPath)
      if (!again?.equals(active))
        throw new Error('Publication lock changed during recovery')
      await remote.writeFile(server, 'ui', lockPath, bytes, 'application/json')
    } else if (policy.mode === 'conditional') {
      if (
        !(await remote.createFile(
          server,
          'ui',
          lockPath,
          bytes,
          'application/json',
        ))
      )
        throw new Error('Publication locked by another writer')
    } else {
      // Deliberately best-effort; read/write/read cannot implement atomic acquisition.
      await remote.writeFile(server, 'ui', lockPath, bytes, 'application/json')
    }
    const lock = new PublicationLock(remote, server, bytes)
    await lock.assertOwned()
    return lock
  }

  async assertOwned() {
    const current = await this.remote.readFileStrict(
      this.server,
      'ui',
      lockPath,
    )
    if (!current?.equals(this.bytes))
      throw new Error(
        "Publication lock ownership lost; stopped without releasing the other writer's lock",
      )
  }

  async write(path: string, content: Buffer | string, contentType?: string) {
    await this.assertOwned()
    await this.remote.writeFile(this.server, 'ui', path, content, contentType)
    await this.assertOwned()
  }

  async release() {
    await this.assertOwned()
    // No conditional delete in Garage: all writers must avoid overlapping runs.
    await this.remote.deleteFile(this.server, 'ui', lockPath)
  }
}

/** Manual recovery only: no timeouts, leases or automatic stale-lock takeover. */
export async function unlockPublication(
  remote: AbstractStorage,
  server: string,
  owner: string,
  confirmStopped: boolean,
) {
  if (!confirmStopped)
    throw new Error(
      'Confirm all previous writers are stopped with --confirm-stopped',
    )
  if (!uuid.test(owner)) throw new Error('Invalid lock owner UUID')
  const bytes = await remote.readFileStrict(server, 'ui', lockPath)
  if (bytes === null) throw new Error('No publication lock exists')
  if (parseLock(bytes).owner !== owner)
    throw new Error('Lock owner does not match; nothing removed')
  const again = await remote.readFileStrict(server, 'ui', lockPath)
  if (!again?.equals(bytes))
    throw new Error('Publication lock changed; nothing removed')
  await remote.deleteFile(server, 'ui', lockPath)
}

export async function writePublicationObject(
  remote: AbstractStorage,
  server: string,
  policy: PublicationPolicy,
  lock: PublicationLock,
  path: string,
  bytes: Buffer,
  contentType = 'application/octet-stream',
): Promise<boolean> {
  await lock.assertOwned()
  if (policy.mode === 'conditional') {
    if (await remote.createFile(server, 'ui', path, bytes, contentType)) {
      await lock.assertOwned()
      return true
    }
  } else {
    const existing = await remote.readFileStrict(server, 'ui', path)
    if (existing !== null) {
      if (!existing.equals(bytes))
        throw new Error(`Immutable publication object collision: ${path}`)
      await lock.assertOwned()
      return false
    }
    await lock.write(path, bytes, contentType)
    return true
  }
  const existing = await remote.readFileStrict(server, 'ui', path)
  if (!existing?.equals(bytes))
    throw new Error(`Immutable publication object collision: ${path}`)
  await lock.assertOwned()
  return false
}
