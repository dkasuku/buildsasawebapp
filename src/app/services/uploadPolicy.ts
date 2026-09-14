// Upload size policy, applied by api.uploadFile so every path — the shared
// hook, the older per-module handlers, the public bid form — behaves the same.

// Uploads go through the API to object storage, and a site phone on 3G was
// happily queuing 40 MB photos and 300 MB PDFs. Documents and drawings are
// capped; photos are downscaled in the browser before they leave the device,
// which turns a 12 MB camera JPEG into ~500 KB with no visible loss on screen.
export const MAX_DOCUMENT_MB = 25;
export const MAX_IMAGE_MB = 15;           // before downscaling; larger is refused outright
const IMAGE_SHRINK_ABOVE_BYTES = 1.5 * 1024 * 1024;
const IMAGE_MAX_EDGE = 2048;
const IMAGE_QUALITY = 0.82;

/** Downscale a large photo to a JPEG no wider than 2048px. Non-images, small
 *  images, and anything the browser cannot decode are returned untouched. */
export async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.type === "image/svg+xml") return file;
  if (file.size <= IMAGE_SHRINK_ABOVE_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
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
export function rejectReason(file: File): string | null {
  const mb = file.size / 1024 / 1024;
  if (file.type.startsWith("image/")) {
    if (mb > MAX_IMAGE_MB) return `${file.name} is ${mb.toFixed(0)} MB — photos must be under ${MAX_IMAGE_MB} MB`;
    return null;
  }
  if (mb > MAX_DOCUMENT_MB) return `${file.name} is ${mb.toFixed(0)} MB — files must be under ${MAX_DOCUMENT_MB} MB. Compress the PDF or split it.`;
  return null;
}

