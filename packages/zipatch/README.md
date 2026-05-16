# @ffcafe/ixion-zipatch

A TypeScript library for reading and extracting ZiPatch files used in Final Fantasy XIV.

## Installation

```bash
pnpm add @ffcafe/ixion-zipatch
```

## Usage

```typescript
import { ZipatchReader } from '@ffcafe/ixion-zipatch';

// Open a patch file
const reader = await ZipatchReader.open('path/to/patch.patch');

// Open a patch URL with HTTP range requests
const remoteReader = await ZipatchReader.open('https://example.com/patch.patch');

// Preload chunk headers once, then reuse them for later opens
const chunks = await ZipatchReader.preload('https://example.com/patch.patch');
const preloadedReader = await ZipatchReader.open(
  'https://example.com/patch.patch',
  { chunks },
);

// Extract all files
await reader.applyTo('./extracted');

// Extract with allow list
await reader.applyTo('./extracted', ['sqpack/', 'game/']);

// List chunks
for await (const chunk of reader.chunks()) {
  console.log(chunk.name, chunk.size);
}

// Close the file handle
await reader.close();
```

## Development

```bash
# Build
pnpm build

# Development mode
pnpm dev

# Lint
pnpm lint
```
