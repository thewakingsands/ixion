import { defineConfig } from 'tsup'

export const baseConfig = defineConfig({
  format: ['esm'],
  dts: true,
  clean: true,
  minify: false,
  outDir: 'dist',
})
