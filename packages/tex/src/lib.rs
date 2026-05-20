use anyhow::{Context, Result, anyhow, bail};
use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use ravif::{Encoder as AvifEncoder, RGBA8 as AvifRgba8};
use rgb::FromSlice;
use texture2ddecoder::{decode_bc1, decode_bc3, decode_bc7};
use tokio::task;
use webp::Encoder as WebpEncoder;

const TEX_HEADER_SIZE: usize = 0x50;
const AUTO_AVIF_MIN_DIMENSION: u16 = 129;
const DEFAULT_WEBP_QUALITY: f32 = 80.0;
const DEFAULT_AVIF_QUALITY: f32 = 50.0;
const DEFAULT_WEBP_EFFORT: u8 = 4;
const DEFAULT_AVIF_SPEED: u8 = 4;

const FORMAT_BGRA4_UNORM: u32 = 0x1440;
const FORMAT_BGR5A1_UNORM: u32 = 0x1441;
const FORMAT_BGRA8_UNORM: u32 = 0x1450;
const FORMAT_BGRX8_UNORM: u32 = 0x1451;
const FORMAT_BC1_UNORM: u32 = 0x3420;
const FORMAT_BC3_UNORM: u32 = 0x3431;
const FORMAT_BC7_UNORM: u32 = 0x6432;

#[derive(Debug, Clone, Copy)]
enum OutputFormat {
    Webp,
    Avif,
    Auto,
}

#[derive(Debug, Clone, Copy)]
struct TextureHeader {
    format: u32,
    width: u16,
    height: u16,
    surface_offsets: [u32; 13],
}

impl TextureHeader {
    fn parse(data: &[u8]) -> Result<Self> {
        if data.len() < TEX_HEADER_SIZE {
            bail!(
                "invalid texture buffer: expected at least {} bytes, got {}",
                TEX_HEADER_SIZE,
                data.len()
            );
        }

        let read_u32 = |offset| {
            u32::from_le_bytes(
                data[offset..offset + 4]
                    .try_into()
                    .expect("slice length checked"),
            )
        };
        let read_u16 = |offset| {
            u16::from_le_bytes(
                data[offset..offset + 2]
                    .try_into()
                    .expect("slice length checked"),
            )
        };

        let mut surface_offsets = [0u32; 13];
        for (index, entry) in surface_offsets.iter_mut().enumerate() {
            *entry = read_u32(28 + index * 4);
        }

        Ok(Self {
            format: read_u32(4),
            width: read_u16(8),
            height: read_u16(10),
            surface_offsets,
        })
    }
}

#[napi(object)]
pub struct FormatTexOptions {
    pub format: Option<String>,
    pub quality: Option<f64>,
    pub effort: Option<u8>,
}

#[napi]
pub async fn format_tex(buffer: Buffer, options: Option<FormatTexOptions>) -> napi::Result<Buffer> {
    let bytes = buffer.to_vec();

    let result = task::spawn_blocking(move || {
        let options = options.unwrap_or(FormatTexOptions {
            format: None,
            quality: None,
            effort: None,
        });
        format_tex_inner(&bytes, options)
    })
    .await
    .map_err(|error| napi::Error::from_reason(format!("texture worker failed: {error}")))?;

    result
        .map(Buffer::from)
        .map_err(|error| napi::Error::from_reason(format!("{error:#}")))
}

fn format_tex_inner(data: &[u8], options: FormatTexOptions) -> Result<Vec<u8>> {
    let header = TextureHeader::parse(data)?;
    let output_format = parse_output_format(options.format.as_deref())?;
    let resolved_format = choose_output_format(output_format, header);
    let rgba = decode_tex_rgba(data, header)?;

    match resolved_format {
        OutputFormat::Webp => encode_webp(&rgba, header, options),
        OutputFormat::Avif => encode_avif(&rgba, header, options),
        OutputFormat::Auto => unreachable!("auto resolves to a concrete format"),
    }
}

fn parse_output_format(value: Option<&str>) -> Result<OutputFormat> {
    match value.unwrap_or("webp").to_ascii_lowercase().as_str() {
        "webp" => Ok(OutputFormat::Webp),
        "avif" => Ok(OutputFormat::Avif),
        "auto" => Ok(OutputFormat::Auto),
        other => bail!("unsupported output format `{other}`; expected `webp`, `avif`, or `auto`"),
    }
}

fn choose_output_format(requested: OutputFormat, header: TextureHeader) -> OutputFormat {
    match requested {
        OutputFormat::Webp | OutputFormat::Avif => requested,
        OutputFormat::Auto => {
            if header.width >= AUTO_AVIF_MIN_DIMENSION && header.height >= AUTO_AVIF_MIN_DIMENSION {
                OutputFormat::Avif
            } else {
                OutputFormat::Webp
            }
        }
    }
}

fn encode_webp(rgba: &[u8], header: TextureHeader, options: FormatTexOptions) -> Result<Vec<u8>> {
    let quality = options
        .quality
        .map(|value| value.clamp(0.0, 100.0) as f32)
        .unwrap_or(DEFAULT_WEBP_QUALITY);
    let effort = options.effort.unwrap_or(DEFAULT_WEBP_EFFORT).clamp(0, 6);

    let encoder = WebpEncoder::from_rgba(rgba, u32::from(header.width), u32::from(header.height));
    let mut config = webp::WebPConfig::new().map_err(|_| anyhow!("webp config init failed"))?;
    config.quality = quality;
    config.method = i32::from(effort);

    let webp = encoder
        .encode_advanced(&config)
        .map_err(|error| anyhow!("webp encode failed: {error:?}"))?;

    Ok(webp.to_vec())
}

fn encode_avif(rgba: &[u8], header: TextureHeader, options: FormatTexOptions) -> Result<Vec<u8>> {
    let quality = options
        .quality
        .map(|value| value.clamp(0.0, 100.0) as f32)
        .unwrap_or(DEFAULT_AVIF_QUALITY);
    let speed = options.effort.unwrap_or(DEFAULT_AVIF_SPEED).min(10);

    let width = usize::from(header.width);
    let height = usize::from(header.height);
    let pixels: Vec<AvifRgba8> = rgba.as_rgba().to_vec();
    let image = ravif::Img::new(pixels.as_slice(), width, height);
    let encoded = AvifEncoder::new()
        .with_quality(quality)
        .with_alpha_quality(quality)
        .with_speed(speed)
        .encode_rgba(image)
        .map_err(|error| anyhow!("avif encode failed: {error}"))?;

    Ok(encoded.avif_file)
}

fn decode_tex_rgba(data: &[u8], header: TextureHeader) -> Result<Vec<u8>> {
    match header.format {
        FORMAT_BGRA8_UNORM => decode_bgra8(data, header, true),
        FORMAT_BGRX8_UNORM => decode_bgra8(data, header, false),
        FORMAT_BGRA4_UNORM => decode_bgra4(data, header),
        FORMAT_BGR5A1_UNORM => decode_bgr5a1(data, header),
        FORMAT_BC1_UNORM => decode_block_compressed(data, header, 8, decode_bc1),
        FORMAT_BC3_UNORM => decode_block_compressed(data, header, 16, decode_bc3),
        FORMAT_BC7_UNORM => decode_block_compressed(data, header, 16, decode_bc7),
        other => bail!("unsupported texture format 0x{other:04x}"),
    }
}

fn decode_bgra8(data: &[u8], header: TextureHeader, preserve_alpha: bool) -> Result<Vec<u8>> {
    let pixel_count = usize::from(header.width) * usize::from(header.height);
    let source = pixel_data(data, header, pixel_count * 4)?;
    let mut rgba = vec![0; pixel_count * 4];

    for (src, dst) in source.chunks_exact(4).zip(rgba.chunks_exact_mut(4)) {
        dst[0] = src[2];
        dst[1] = src[1];
        dst[2] = src[0];
        dst[3] = if preserve_alpha { src[3] } else { 0xff };
    }

    Ok(rgba)
}

fn decode_bgra4(data: &[u8], header: TextureHeader) -> Result<Vec<u8>> {
    let pixel_count = usize::from(header.width) * usize::from(header.height);
    let source = pixel_data(data, header, pixel_count * 2)?;
    let mut rgba = vec![0; pixel_count * 4];

    for (src, dst) in source.chunks_exact(2).zip(rgba.chunks_exact_mut(4)) {
        let packed = u16::from_le_bytes([src[0], src[1]]);
        dst[0] = scale_4bit(((packed >> 8) & 0x0f) as u8);
        dst[1] = scale_4bit(((packed >> 4) & 0x0f) as u8);
        dst[2] = scale_4bit((packed & 0x0f) as u8);
        dst[3] = scale_4bit(((packed >> 12) & 0x0f) as u8);
    }

    Ok(rgba)
}

fn decode_bgr5a1(data: &[u8], header: TextureHeader) -> Result<Vec<u8>> {
    let pixel_count = usize::from(header.width) * usize::from(header.height);
    let source = pixel_data(data, header, pixel_count * 2)?;
    let mut rgba = vec![0; pixel_count * 4];

    for (src, dst) in source.chunks_exact(2).zip(rgba.chunks_exact_mut(4)) {
        let packed = u16::from_le_bytes([src[0], src[1]]);
        dst[0] = scale_5bit(((packed >> 10) & 0x1f) as u8);
        dst[1] = scale_5bit(((packed >> 5) & 0x1f) as u8);
        dst[2] = scale_5bit((packed & 0x1f) as u8);
        dst[3] = if (packed & 0x8000) != 0 { 0xff } else { 0x00 };
    }

    Ok(rgba)
}

fn decode_block_compressed(
    data: &[u8],
    header: TextureHeader,
    bytes_per_block: usize,
    decoder: fn(&[u8], usize, usize, &mut [u32]) -> std::result::Result<(), &'static str>,
) -> Result<Vec<u8>> {
    let width = usize::from(header.width);
    let height = usize::from(header.height);
    let block_width = width.div_ceil(4).max(1);
    let block_height = height.div_ceil(4).max(1);
    let compressed = pixel_data(data, header, block_width * block_height * bytes_per_block)?;
    let mut pixels = vec![0u32; width * height];

    decoder(compressed, width, height, &mut pixels)
        .map_err(|error| anyhow!("texture decode failed: {error}"))?;

    let mut rgba = vec![0u8; width * height * 4];
    for (pixel, dst) in pixels.into_iter().zip(rgba.chunks_exact_mut(4)) {
        let [b, g, r, a] = pixel.to_le_bytes();
        dst[0] = r;
        dst[1] = g;
        dst[2] = b;
        dst[3] = a;
    }

    Ok(rgba)
}

fn pixel_data<'a>(data: &'a [u8], header: TextureHeader, length: usize) -> Result<&'a [u8]> {
    let start = usize::try_from(header.surface_offsets[0]).context("invalid surface offset")?;
    let end = start + length;
    if start < TEX_HEADER_SIZE || end > data.len() {
        bail!(
            "texture pixel data out of bounds: {}..{} of {}",
            start,
            end,
            data.len()
        );
    }

    Ok(&data[start..end])
}

fn scale_4bit(value: u8) -> u8 {
    (value << 4) | value
}

fn scale_5bit(value: u8) -> u8 {
    (value << 3) | (value >> 2)
}
