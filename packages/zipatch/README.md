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

// Extract all files
await reader.extractTo('./extracted');

// Extract with allow list
await reader.extractTo('./extracted', ['sqpack/', 'game/']);

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
