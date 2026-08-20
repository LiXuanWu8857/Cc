import { describe, expect, it } from "vitest";
import { DEFAULT_IMAGE_LIMITS, validateImageBytes } from "./validateImage";

/** Minimal valid PNG header (signature + IHDR) with the given dimensions. */
function pngHeader(width: number, height: number): Uint8Array {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0x00, 0x00, 0x00, 0x0d], 8); // IHDR length
  b.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

/** Minimal JPEG: SOI + SOF0 with the given dimensions. */
function jpegHeader(width: number, height: number): Uint8Array {
  const b = new Uint8Array(20);
  b.set([0xff, 0xd8], 0); // SOI
  b.set([0xff, 0xc0], 2); // SOF0
  b.set([0x00, 0x11], 4); // segment length
  b[6] = 0x08; // precision
  new DataView(b.buffer).setUint16(7, height);
  new DataView(b.buffer).setUint16(9, width);
  return b;
}

describe("validateImageBytes", () => {
  it("accepts a valid PNG and reads dimensions", () => {
    const r = validateImageBytes(pngHeader(100, 50));
    expect(r.ok).toBe(true);
    expect(r.format).toBe("png");
    expect(r).toMatchObject({ width: 100, height: 50 });
  });

  it("accepts a valid JPEG and reads dimensions", () => {
    const r = validateImageBytes(jpegHeader(640, 480));
    expect(r.ok).toBe(true);
    expect(r.format).toBe("jpeg");
    expect(r).toMatchObject({ width: 640, height: 480 });
  });

  it("rejects SVG/markup content", () => {
    const svg = new TextEncoder().encode('   <svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const r = validateImageBytes(svg);
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/markup|script/i);
  });

  it("rejects unknown formats (e.g. GIF)", () => {
    const gif = new TextEncoder().encode("GIF89a........");
    expect(validateImageBytes(gif).ok).toBe(false);
  });

  it("rejects oversized dimensions (decompression-bomb guard)", () => {
    const r = validateImageBytes(pngHeader(10000, 10000));
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/exceeds/i);
  });

  it("rejects files over the byte cap", () => {
    const big = pngHeader(100, 100);
    const r = validateImageBytes(big, { ...DEFAULT_IMAGE_LIMITS, maxBytes: 8 });
    expect(r.ok).toBe(false);
  });

  it("rejects empty input", () => {
    expect(validateImageBytes(new Uint8Array(0)).ok).toBe(false);
  });
});
