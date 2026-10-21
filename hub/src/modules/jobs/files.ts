// Job photo checks: the file's own bytes decide what it is, not the name or the declared type.

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const ALLOWED_DECLARED = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence", "application/octet-stream", ""];

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"]);
const HEIF_BRANDS = new Set(["mif1", "msf1"]);

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

/** Returns the image content type from magic bytes, or null when it isn't an allowed image. */
export function sniffImage(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "image/heif" | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && ascii(bytes, 1, 4) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  if (ascii(bytes, 4, 8) === "ftyp") {
    const major = ascii(bytes, 8, 12);
    if (HEIC_BRANDS.has(major)) return "image/heic";
    if (HEIF_BRANDS.has(major)) {
      // mif1/msf1 is generic HEIF: look at the compatible brands so AVIF isn't mistaken for HEIC.
      const boxSize = Math.min(bytes.length, (bytes[0] << 24 | bytes[1] << 16 | bytes[2] << 8 | bytes[3]) >>> 0 || 32);
      const brands: string[] = [];
      for (let i = 16; i + 4 <= boxSize; i += 4) brands.push(ascii(bytes, i, i + 4));
      if (brands.some(b => HEIC_BRANDS.has(b))) return "image/heic";
      if (brands.includes("avif")) return null;
      return "image/heif";
    }
  }
  return null;
}
