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
The implementation uses AWS SDK v3 (`@aws-sdk/client-s3` and `@aws-sdk/lib-storage`).
Existing endpoint host, port, TLS, credentials, prefixes and `minio` aliases remain
compatible. Set `region` to your server's configured S3 region (for Garage this
is often `garage`); the fallback remains `us-east-1`. `forcePathStyle` defaults
to `true` for custom endpoints and can be set to `false` for DNS-style buckets.

SDK checksums remain enabled by default (`WHEN_SUPPORTED`). If isolated testing
shows that your backend version cannot handle the SDK's optional checksums, set
`requestChecksumCalculation` and/or `responseChecksumValidation` to
`WHEN_REQUIRED` in that storage's config. This reduces optional integrity checks;
it does not disable TLS or request signing. Do not assume compatibility from a
Garage major version alone. Verify single and multipart uploads, full and Range
downloads, pagination, Content-Type and publication recovery with your deployment.
See [AWS checksum settings](https://docs.aws.amazon.com/sdkref/latest/guide/feature-dataintegrity.html)
and [Garage client configuration](https://garagehq.deuxfleurs.fr/documentation/connect/).

Uploads use managed multipart transfer with automatic abort on failure; conditional
creation stays a single PUT. Downloads fully consume the response stream. The
`readFileRange` method reads a byte range without exposing the SDK client.
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
