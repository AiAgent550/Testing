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

// ---------- videos ----------
// Phones record MP4 (Android) or QuickTime MOV (iPhone); WebM and 3GP turn up from some apps. Uploads are streamed
// straight to storage, so the limit is just under the 100 MB a single request can carry.
export const MAX_VIDEO_BYTES = 95 * 1024 * 1024;
export const MAX_PREVIEW_BYTES = 3 * 1024 * 1024;
export const VIDEO_DECLARED = ["video/mp4", "video/quicktime", "video/webm", "video/3gpp", "video/x-m4v", "application/octet-stream"];

const MP4_BRANDS = /^(isom|iso[2-9]|mp41|mp42|avc1|M4V |M4VP|dash|3gp[4-6]|3g2[abc]|mmp4|MSNV|f4v |XAVC|nvr1)$/;

export function sniffVideo(bytes: Uint8Array): "video/mp4" | "video/quicktime" | "video/webm" | "video/3gpp" | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "video/webm";
  const box = ascii(bytes, 4, 8);
  if (box === "ftyp") {
    const brand = ascii(bytes, 8, 12);
    if (brand === "qt  ") return "video/quicktime";
    if (/^3g/.test(brand)) return "video/3gpp";
    if (MP4_BRANDS.test(brand)) return "video/mp4";
    return null;
  }
  // Older QuickTime files can start with other atoms before (or without) ftyp.
  if (["moov", "mdat", "wide", "free", "skip"].includes(box)) return "video/quicktime";
  return null;
}
