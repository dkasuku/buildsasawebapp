// Upload size policy, applied by api.uploadFile so every path — the shared
// hook, the older per-module handlers, the public bid form — behaves the same.

// Uploads go through the API to object storage, and a site phone on 3G was
// happily queuing 40 MB photos and 300 MB PDFs. Documents and drawings are
// capped; photos are downscaled in the browser before they leave the device,
// which turns a 12 MB camera JPEG into ~500 KB with no visible loss on screen.
export const MAX_DOCUMENT_MB = 25;
export const MAX_IMAGE_MB = 15;           // before downscaling; larger is refused outright
// Site evidence clips: enough for 30–60 seconds from a phone, small enough to
// upload on site data and play in the client portal without buffering forever.
export const MAX_VIDEO_MB = 20;
// Several files can be picked at once; together they must stay under this.
export const MAX_BATCH_MB = 100;

/** Why a whole selection must not be uploaded (too large in total), or null. */
export function batchRejectReason(files: File[]): string | null {
  const mb = files.reduce((s, f) => s + f.size, 0) / 1024 / 1024;
  if (mb > MAX_BATCH_MB) return `Those ${files.length} files add up to ${mb.toFixed(0)} MB. Upload up to ${MAX_BATCH_MB} MB at a time: pick fewer files, or upload them in two goes.`;
  return null;
}
const IMAGE_SHRINK_ABOVE_BYTES = 1.5 * 1024 * 1024;
const IMAGE_MAX_EDGE = 2048;
// 360° panoramas are stretched across the whole field of view, so 2048px wide
// looks blurry. They keep up to 6144px (the viewer downsizes further on phones
// whose GPU can't hold that) and may be as large as a document before shrinking.
export const PANORAMA_MAX_EDGE = 6144;
export type UploadOpts = { panorama?: boolean };
const IMAGE_QUALITY = 0.82;

/** Downscale a large photo to a JPEG no wider than 2048px. Non-images, small
 *  images, and anything the browser cannot decode are returned untouched. */
export async function shrinkImage(file: File, opts: UploadOpts = {}): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.type === "image/svg+xml") return file;
  if (file.size <= IMAGE_SHRINK_ABOVE_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, (opts.panorama ? PANORAMA_MAX_EDGE : IMAGE_MAX_EDGE) / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", IMAGE_QUALITY));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}

/** The reason a file must not be uploaded, or null if it is fine. */
export function rejectReason(file: File, opts: UploadOpts = {}): string | null {
  const mb = file.size / 1024 / 1024;
  if (file.type.startsWith("image/")) {
    const max = opts.panorama ? MAX_DOCUMENT_MB : MAX_IMAGE_MB;
    if (mb > max) return `${file.name} is ${mb.toFixed(0)} MB — ${opts.panorama ? "360° photos" : "photos"} must be under ${max} MB`;
    return null;
  }
  if (file.type.startsWith("video/")) {
    if (mb > MAX_VIDEO_MB) return `${file.name} is ${mb.toFixed(0)} MB — videos must be under ${MAX_VIDEO_MB} MB. Record a shorter clip (30–60 seconds).`;
    return null;
  }
  if (mb > MAX_DOCUMENT_MB) return `${file.name} is ${mb.toFixed(0)} MB — files must be under ${MAX_DOCUMENT_MB} MB. Compress the PDF or split it.`;
  return null;
}

