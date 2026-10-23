// Encoding routines extracted from ixion-tex (GPL-3.0-only).
use anyhow::{Result, anyhow, bail};
use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use ravif::{Encoder as AvifEncoder, RGBA8 as AvifRgba8};
use rgb::FromSlice;
use tokio::task;
use webp::Encoder as WebpEncoder;

const DEFAULT_WEBP_QUALITY: f32 = 80.0;
const DEFAULT_AVIF_QUALITY: f32 = 50.0;
const DEFAULT_WEBP_EFFORT: u8 = 4;
const DEFAULT_AVIF_SPEED: u8 = 4;

#[derive(Clone, Copy)]
struct Dimensions {
    width: u32,
    height: u32,
}

#[napi(object)]
pub struct RgbaImage {
    pub width: f64,
    pub height: f64,
    pub data: Buffer,
}
#[napi(object)]
pub struct EncodeRgbaOptions {
    pub format: String,
    pub quality: Option<f64>,
    pub effort: Option<f64>,
}
#[napi(object)]
pub struct EncodedImage {
    pub format: String,
    pub data: Buffer,
}

#[napi]
pub async fn encode_rgba(
    image: RgbaImage,
    options: EncodeRgbaOptions,
) -> napi::Result<EncodedImage> {
    let dimensions =
        validate(&image, &options).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let rgba = image.data.to_vec();
    let format = options.format.clone();
    let result = task::spawn_blocking(move || -> Result<_> {
        let data = match options.format.as_str() {
            "webp" => encode_webp(&rgba, dimensions, options)?,
            "avif" => encode_avif(&rgba, dimensions, options)?,
            _ => unreachable!("validated format"),
        };
        Ok(data)
    })
    .await
    .map_err(|_| napi::Error::from_reason("image encoder worker failed"))?;
    result
        .map(|data| EncodedImage {
            format,
            data: data.into(),
        })
        .map_err(|e| napi::Error::from_reason(e.to_string()))
}

fn validate(image: &RgbaImage, options: &EncodeRgbaOptions) -> Result<Dimensions> {
    for value in [image.width, image.height] {
        if !value.is_finite() || value.fract() != 0.0 || !(1.0..=16384.0).contains(&value) {
            bail!("invalid RGBA dimensions");
        }
    }
    let pixels = (image.width as usize)
        .checked_mul(image.height as usize)
        .ok_or_else(|| anyhow!("RGBA size overflow"))?;
    if pixels > 16 * 1024 * 1024 || pixels.checked_mul(4) != Some(image.data.len()) {
        bail!("invalid RGBA buffer length");
    }
    if options.format != "webp" && options.format != "avif" {
        bail!("expected explicit webp or avif format");
    }
    if options.quality.is_some_and(|v| !v.is_finite()) {
        bail!("quality must be finite");
    }
    if options
        .effort
        .is_some_and(|v| !v.is_finite() || v.fract() != 0.0 || !(0.0..=255.0).contains(&v))
    {
        bail!("effort must be an integer from 0 to 255");
    }
    Ok(Dimensions {
        width: image.width as u32,
        height: image.height as u32,
    })
}

fn encode_webp(rgba: &[u8], header: Dimensions, options: EncodeRgbaOptions) -> Result<Vec<u8>> {
    let quality = options
        .quality
        .map(|value| value.clamp(0.0, 100.0) as f32)
        .unwrap_or(DEFAULT_WEBP_QUALITY);
    let effort = (options.effort.unwrap_or(f64::from(DEFAULT_WEBP_EFFORT)) as u8).clamp(0, 6);

    let encoder = WebpEncoder::from_rgba(rgba, header.width, header.height);
    let mut config = webp::WebPConfig::new().map_err(|_| anyhow!("webp config init failed"))?;
    config.quality = quality;
    config.method = i32::from(effort);

    let webp = encoder
        .encode_advanced(&config)
        .map_err(|error| anyhow!("webp encode failed: {error:?}"))?;

    Ok(webp.to_vec())
}

fn encode_avif(rgba: &[u8], header: Dimensions, options: EncodeRgbaOptions) -> Result<Vec<u8>> {
    let quality = options
        .quality
        .map(|value| value.clamp(0.0, 100.0) as f32)
        .unwrap_or(DEFAULT_AVIF_QUALITY);
    let speed = (options.effort.unwrap_or(f64::from(DEFAULT_AVIF_SPEED)) as u8).min(10);

    // ravif 0.11 requires quality/speed >= 1. Preserve the old rejection
    // at zero without invoking a panic in the blocking task.
    if quality < 1.0 || speed == 0 {
        bail!("AVIF quality and effort must be at least 1");
    }
    let width = header.width as usize;
    let height = header.height as usize;
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
