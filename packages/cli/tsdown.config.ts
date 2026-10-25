import { baseConfig } from 'config/tsdown'
import { defineConfig } from 'tsdown'

export default defineConfig({
  ...baseConfig,
  entry: {
    index: 'src/index.ts',
    'asset-texture': 'src/actions/asset/texture.ts',
  },
})
