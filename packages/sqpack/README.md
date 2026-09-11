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

## Local game resources and LGB

```ts
import { GameSqPackReader, resolveSqPackPrefix, readLgbFile } from '@ffcafe/ixion-sqpack'

const resource = 'bg/ffxiv/sea_s1/twn/s1t1/level/bg.lgb'
const prefix = await resolveSqPackPrefix('/path/to/game', resource)
// /path/to/game/sqpack/ffxiv/020000 (null if not installed)

const game = new GameSqPackReader('/path/to/game')
try {
  const data = await game.readFile(resource)
  const lgb = data ? readLgbFile(data) : null
} finally {
  await game.close()
}
```

The local reader normalizes resource paths, selects the category and expansion,
then searches installed Windows indexes across all chunks. It supports index2-only
packs and caches indexes for repeated reads. Returned prefixes exclude `.win32`;
append it when constructing a `SqPackReader` directly.

`readLgbFile` decodes LGB1/LGP1 headers, layer IDs/names/festivals, instance
types/IDs/names, and translation/rotation/scale. Asset-specific payloads and layer
reference lists are not decoded. Unknown asset types retain their common metadata.
Invalid signatures, sizes, offsets and unterminated strings throw errors.
