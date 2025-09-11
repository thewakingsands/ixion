# @ffcafe/ixion-sqpack

A TypeScript library for reading SqPack files used in Final Fantasy XIV.

## Installation

```bash
pnpm add @ffcafe/ixion-sqpack
```

## Usage

```typescript
import { SqPackReader } from '@ffcafe/ixion-sqpack';

// Open a SqPack repository
const reader = await SqPackReader.open({
  prefix: './sqpack/ffxiv/0a0000.win32',
  useIndex2: false // Use index files (default) or index2 files
});

// Check if a file exists
const exists = await reader.hasFile('exd/root.exl');

// Get file information
const fileInfo = await reader.getFileIndex('exd/root.exl');
console.log(fileInfo); // { path, dataFileId, offset }

// Read file data
const fileData = await reader.readFile('exd/root.exl');

// Close the reader
await reader.close();
```

## Index vs Index2

- **Index files**: Use separate directory and filename hashes (64-bit)
- **Index2 files**: Use single path hash (32-bit)

Index2 files are more efficient but less precise for path resolution.

## Development

```bash
# Build
pnpm build

# Development mode
pnpm dev

# Lint
pnpm lint

# Test
pnpm test
```

## References

Based on the [XIV Dev SqPack documentation](https://xiv.dev/data-files/sqpack#reading-index-data).
