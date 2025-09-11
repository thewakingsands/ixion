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

### MinioStorage

Stores version files in a MinIO object storage bucket. Version directories are automatically compressed into zip files for efficient storage and transfer.
