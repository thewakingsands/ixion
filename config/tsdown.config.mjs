import { defineConfig } from 'tsdown'

export const baseConfig = defineConfig({
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  // Keep the package exports and CI entry points at .js / .d.ts.
  fixedExtension: false,
  // Built-ins such as node:sqlite require the node: prefix.
  nodeProtocol: false,
  dts: true,
  clean: true,
  minify: false,
  outDir: 'dist',
})
