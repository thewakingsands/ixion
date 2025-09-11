# @ffcafe/ixion-server

A TypeScript library for managing FFXIV patch providers and game patch list.

## Installation

```bash
npm install @ffcafe/ixion-server
```

## Usage

```typescript
import { servers } from '@ffcafe/ixion-server'

// Request patches from SDO
const sdoPatches = await servers.sdo.request({
  boot: 'ffxivboot.exe/149504/5f2a70612aa58378eb347869e75adeb8f5581a1b',
  ffxiv: '2025.07.28.0000.0000',
  expansions: {}
})

// Request patches from Thaliak (Square Enix)
const sePatches = await servers.squareEnix.request({
  boot: 'ffxivboot.exe/149504/5f2a70612aa58378eb347869e75adeb8f5581a1b',
  ffxiv: '2025.07.28.0000.0000',
  expansions: {}
})
```

## Available Providers

### SDO Provider

SDO service provider using HTTP protocol for patch delivery.

### Thaliak Provider

GraphQL-based patch provider supporting multiple regions with dependency tree management.
