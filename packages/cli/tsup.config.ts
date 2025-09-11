import { baseConfig } from 'config/tsup'
import { defineConfig } from 'tsup'

export default defineConfig({
  ...baseConfig,
  entry: ['src/index.ts'],
})
