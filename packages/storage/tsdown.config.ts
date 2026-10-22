import { baseConfig } from 'config/tsdown'
import { defineConfig } from 'tsdown'

export default defineConfig({
  ...baseConfig,
  entry: ['src/index.ts'],
})
