/**
 * Server-side image upload validation (§4.8, §4.9, Threat Model #15).
 *
 * Treats every upload as hostile. Validates by MAGIC BYTES (not the filename
 * or client-supplied MIME), checks real pixel dimensions parsed from the
 * header, caps file size, and rejects everything that is not a plain raster
 * photo — SVG/HTML/scripts, and formats we do not decode. Dimension caps guard
 * against decompression bombs.
 *
 * Supported now: JPEG and PNG (what phone camera captures of labels/receipts
 * produce). WebP/HEIC normalisation needs a decode library (e.g. sharp) and is
 * a later enhancement; until then those are rejected rather than trusted.
 */

export type ImageFormat = "jpeg" | "png";

export interface ImageValidationOptions {
  maxBytes: number;
  maxWidth: number;
  maxHeight: number;
  minWidth?: number;
  minHeight?: number;
}

export interface ImageValidationResult {
  ok: boolean;
  format?: ImageFormat;
  width?: number;
  height?: number;
  errors: string[];
}

export const DEFAULT_IMAGE_LIMITS: ImageValidationOptions = {
  maxBytes: 8 * 1024 * 1024, // 8 MB
  maxWidth: 6000,
  maxHeight: 6000,
  minWidth: 16,
  minHeight: 16,
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function validateImageBytes(
  buf: Uint8Array,
  opts: ImageValidationOptions = DEFAULT_IMAGE_LIMITS,
): ImageValidationResult {
  const errors: string[] = [];

  if (buf.length === 0) return { ok: false, errors: ["Empty file"] };
  if (buf.length > opts.maxBytes) {
    errors.push(`File exceeds ${opts.maxBytes} bytes`);
  }

  // Fast reject of text-based payloads (SVG/HTML/XML) which can start with
  // whitespace then '<'. Never accept these as images.
  const head = firstNonWhitespace(buf, 64);
  if (head === 0x3c /* '<' */) {
    return { ok: false, errors: ["Markup/script content is not an allowed image"] };
  }

  const format = detectFormat(buf);
  if (!format) {
    return { ok: false, errors: ["Unsupported or unrecognised image format (allowed: JPEG, PNG)"] };
  }

  const dims = format === "png" ? readPngSize(buf) : readJpegSize(buf);
  if (!dims) {
    return { ok: false, format, errors: [...errors, "Could not read image dimensions (corrupt header)"] };
  }

  const { width, height } = dims;
  if (width > opts.maxWidth || height > opts.maxHeight) {
    errors.push(`Image exceeds ${opts.maxWidth}x${opts.maxHeight}px`);
  }
  if ((opts.minWidth && width < opts.minWidth) || (opts.minHeight && height < opts.minHeight)) {
    errors.push("Image is too small");
  }

  return { ok: errors.length === 0, format, width, height, errors };
}

function detectFormat(buf: Uint8Array): ImageFormat | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.length >= 8 && PNG_SIGNATURE.every((b, i) => buf[i] === b)) return "png";
  return null;
}

/** PNG: IHDR is the first chunk; width/height are big-endian at bytes 16 & 20. */
function readPngSize(buf: Uint8Array): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  // Bytes 12..15 must be the "IHDR" chunk type.
  if (buf[12] !== 0x49 || buf[13] !== 0x48 || buf[14] !== 0x44 || buf[15] !== 0x52) return null;
  const width = be32(buf, 16);
  const height = be32(buf, 20);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

/** JPEG: walk markers until a Start-Of-Frame (SOF0..SOF3, etc.). */
function readJpegSize(buf: Uint8Array): { width: number; height: number } | null {
  let off = 2; // skip SOI (FF D8)
  const len = buf.length;
  while (off + 9 < len) {
    if (buf[off] !== 0xff) return null; // markers must be byte-aligned
    const marker = buf[off + 1]!;

    // Standalone markers (no length): RSTn (D0-D7), SOI(D8), EOI(D9), TEM(01).
    if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
      off += 2;
      continue;
    }

    const segLen = be16(buf, off + 2);
    if (segLen < 2) return null;

    // SOF markers carrying dimensions (exclude DHT C4, JPG C8, DAC CC).
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const height = be16(buf, off + 5);
      const width = be16(buf, off + 7);
      if (width <= 0 || height <= 0) return null;
      return { width, height };
    }
    off += 2 + segLen;
  }
  return null;
}

function be16(b: Uint8Array, o: number): number {
  return (b[o]! << 8) | b[o + 1]!;
}
function be32(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
}
function firstNonWhitespace(b: Uint8Array, scan: number): number | null {
  for (let i = 0; i < Math.min(scan, b.length); i++) {
    const c = b[i]!;
    if (c !== 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return c;
  }
  return null;
}
