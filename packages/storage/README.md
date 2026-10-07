# @ffcafe/ixion-storage

A flexible storage system for managing FFXIV version files across multiple storage backends.

## Installation

```bash
npm install @ffcafe/ixion-storage
```

## Usage

```typescript
import { StorageManager } from '@ffcafe/ixion-storage'

// Create a storage manager with configuration
const storageManager = new StorageManager([
  {
    name: 'local',
    type: 'local',
    config: {
      rootPath: './versions'
    }
  },
  {
    name: 'minio-backup',
    type: 'minio',
    config: {
      endPoint: 'localhost',
      port: 9000,
      useSSL: false,
      accessKey: 'minioadmin',
      secretKey: 'minioadmin',
      bucketName: 'ixion-versions',
      prefix: 'ffxiv' // Optional: organize objects with a prefix
    }
  }
])

// Read current version
const currentVersion = await storageManager.readCurrentVersion()

// Write current version to all storages
await storageManager.writeCurrentVersion({
  ffxiv: '2025.07.28.0000.0000',
  ex1: '2025.07.28.0000.0000'
})

// Sync versions between storages
const result = await storageManager.syncVersions('local', 'minio-backup')
console.log(`Synced ${result.synced.length} versions`)
```

## Storage Types

### LocalStorage

Stores version files on the local filesystem with direct file access.

### S3Storage (MinioStorage alias)

Uses a shared S3 implementation for Garage, MinIO and other compatible services.
Use `type: 's3'`; `type: 'minio'` remains an alias. Version directories are
automatically compressed into ZIP files for transfer.

Asset publication defaults to `publicationMode: 'conditional'` and verifies
atomic create support. Garage instead requires explicit
`publicationMode: 'cooperative'`, which opts into a best-effort remote lock
without hostname binding or shared local directories. The asset workflow checks
remote ownership around writes, but GET/PUT/DELETE are not atomic and simultaneous
publication is not strictly safe. Direct `createFile` calls remain rejected.
Locks never expire automatically; use `asset ui-lock`, `asset ui-sync --resume`
or explicit `asset ui-unlock --owner <uuid> --confirm-stopped` for recovery after
stopping old writers. See the root README for deployment and recovery rules.
