// Job photos and videos: picking from the camera or the gallery, shrinking on the phone, and uploading.
// Photos go up with a ~1600px JPEG preview (thumbnails and email attachments). Videos stream up with a progress bar.
import { t } from "./core.js";
import { tServer } from "/assets/i18n.js";

const MAX_PHOTO = 10 * 1024 * 1024;
export const MAX_VIDEO = 95 * 1024 * 1024;

async function toJpeg(file, maxSide, quality) {
  if (typeof createImageBitmap !== "function") return null;
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch { return null; } // HEIC on Android/desktop browsers can't be decoded; the original still uploads
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), hgt = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = hgt;
  canvas.getContext("2d").drawImage(bmp, 0, 0, w, hgt);
  bmp.close?.();
  return new Promise(res => canvas.toBlob(b => res(b), "image/jpeg", quality));
}

export const isVideo = f => /^video\//.test(f.type) || /\.(mp4|mov|m4v|webm|3gp)$/i.test(f.name || "");

/** Uploads one photo. Very large photos are shrunk to a sharp 3200px JPEG first instead of being refused. */
export async function uploadPhoto(apiFn, base, file) {
  let main = file;
  if (file.size > MAX_PHOTO) {
    main = await toJpeg(file, 3200, 0.88);
    if (!main || main.size > MAX_PHOTO) throw new Error(t("{name} is over 10 MB.", { name: file.name }));
  }
  const preview = await toJpeg(main, 1600, 0.82);
  const fd = new FormData();
  fd.append("file", main, file.name || "photo.jpg");
  if (preview) fd.append("preview", preview, "preview.jpg");
  if (file.name) fd.append("filename", file.name);
  return (await apiFn(`${base}/files`, { method: "POST", body: fd })).file;
}

/** Uploads one video, reporting progress (0..1). */
export function uploadVideo(base, file, onProgress) {
  if (file.size > MAX_VIDEO) return Promise.reject(new Error(t("{name} is over 95 MB. Trim it or record a shorter clip.", { name: file.name || t("This video") })));
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${base}/videos`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("content-type", file.type || "video/mp4");
    if (file.name) xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onerror = () => reject(new Error(t("The upload stopped. Check the signal and try again.")));
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText || "{}"); } catch {}
      if (xhr.status === 401) { location.href = "/login"; return reject(new Error(t("Sign in to continue."))); }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data.file);
      else reject(new Error(data?.error?.message ? tServer(data.error.message) : t("Request failed ({status}).", { status: xhr.status })));
    };
    xhr.send(file);
  });
}

export const fmtSize = bytes => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
