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

// Bind to elpis-texture and ixion-image-encoder once the former has a published
// registry version. Keeping the adapter injectable permits tarball acceptance
// without putting a temporary file dependency in the production lockfile.
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
