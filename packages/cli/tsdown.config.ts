import { baseConfig } from 'config/tsdown'
import { defineConfig } from 'tsdown'

export default defineConfig({
  ...baseConfig,
  entry: {
    index: 'src/index.ts',
    status: 'src/status.ts',
    'asset-texture': 'src/actions/asset/texture.ts',
  },
})
