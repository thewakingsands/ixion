import { decodeTex } from '@ffcafe/elpis-texture'
import { encodeRgba } from '@ffcafe/ixion-image-encoder'

export interface DecodedTexture {
  width: number
  height: number
  data: Buffer
}
export interface FormatTexOptions {
  format?: 'webp' | 'avif' | 'auto'
  quality?: number
  effort?: number
}
interface EncodedTexture {
  format: 'webp' | 'avif'
  data: Buffer
}
type Decode = (buffer: Buffer) => Promise<DecodedTexture>
type Encode = (
  image: DecodedTexture,
  options: Omit<FormatTexOptions, 'format'> & { format: 'webp' | 'avif' },
) => Promise<EncodedTexture>

export function createTextureFormatter(decodeTex: Decode, encodeRgba: Encode) {
  return async (
    buffer: Buffer,
    options: FormatTexOptions = {},
  ): Promise<EncodedTexture> => {
    const requested = options.format?.toLowerCase() ?? 'webp'
    if (!['webp', 'avif', 'auto'].includes(requested))
      throw new Error('Unsupported texture format')
    const image = await decodeTex(buffer)
    const format =
      requested === 'auto'
        ? image.width >= 129 && image.height >= 129
          ? 'avif'
          : 'webp'
        : (requested as 'webp' | 'avif')
    return encodeRgba(image, {
      format,
      quality: options.quality,
      effort: options.effort,
    })
  }
}

export const formatTex = createTextureFormatter(decodeTex, encodeRgba)
