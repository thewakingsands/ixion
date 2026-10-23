export interface RgbaImage {
  width: number
  height: number
  data: Buffer
}
export interface EncodeRgbaOptions {
  format: 'webp' | 'avif'
  quality?: number
  effort?: number
}
export interface EncodedImage {
  format: 'webp' | 'avif'
  data: Buffer
}
export function encodeRgba(image: RgbaImage, options: EncodeRgbaOptions): Promise<EncodedImage>
