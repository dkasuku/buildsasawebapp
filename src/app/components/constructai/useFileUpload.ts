// Shared file-upload behaviour for every module that attaches images or docs.
//
// Written because each screen had rolled its own handler, and they were wrong in
// the same three ways:
//   * The picked file was invisible until the upload finished, so a slow or
//     failed upload was indistinguishable from "the picker didn't work".
//   * Failures were swallowed (`catch {}`) or reported as a bare "Upload failed",
//     which says nothing about which file died or why.
//   * Several fell back to `URL.createObjectURL(file)` on error. That renders
//     once, then dies on the next reload and on every other device — a broken
//     image that looks like a successful upload.
//
// The contract here: you see the file the instant you pick it, the real reason
// on failure, and only durable server URLs ever reach state you save.
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import api from "../../services/api";

export type PendingUpload = {
  /** Stable key for React lists. */
  id: string;
  file: File;
  /** Local blob URL — for preview only, never persisted. */
  previewUrl: string;
  status: "uploading" | "done" | "error";
  progress: number;
  /** Durable server URL, present once status is "done". */
  url?: string;
  error?: string;
};

let seq = 0;
const nextId = () => `up-${Date.now()}-${++seq}`;

export function useFileUpload(options?: { onUploaded?: (urls: string[]) => void }) {
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [busy, setBusy] = useState(false);
  // Revoke blob URLs on unmount. Each preview holds the whole file in memory
  // until released, which adds up fast with phone photos.
  const created = useRef<string[]>([]);
  useEffect(() => () => { created.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  const onUploadedRef = useRef(options?.onUploaded);
  onUploadedRef.current = options?.onUploaded;

  /**
   * Upload a picked FileList. Resolves with the durable URLs that stored.
   * Previews appear immediately; each file reports its own outcome.
   */
  const upload = useCallback(async (files: FileList | File[] | null): Promise<string[]> => {
    const list = Array.from(files || []);
    if (!list.length) return [];

    const items: PendingUpload[] = list.map((file) => {
      const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : "";
      if (previewUrl) created.current.push(previewUrl);
      return { id: nextId(), file, previewUrl, status: "uploading", progress: 0 };
    });
    setPending((prev) => [...prev, ...items]);
    setBusy(true);

    const done: string[] = [];
    const failures: string[] = [];
    // Sequential, not parallel: a phone on site uploading eight photos at once
    // starves its own connection and the whole batch times out. One at a time is
    // slower on paper and far more likely to actually finish.
    for (const item of items) {
      try {
        const url = await api.uploadFile(item.file, (pct) => {
          setPending((prev) => prev.map((p) => (p.id === item.id ? { ...p, progress: pct } : p)));
        });
        done.push(url);
        setPending((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: "done", progress: 100, url } : p)));
      } catch (e: any) {
        const message = e?.message || "upload failed";
        failures.push(message);
        setPending((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: "error", error: message } : p)));
      }
    }

    setBusy(false);
    if (done.length) {
      toast.success(done.length === 1 ? "File uploaded" : `${done.length} files uploaded`);
      onUploadedRef.current?.(done);
    }
    // Show the real server message, and keep it up long enough to read — these
    // are the messages that tell you storage is misconfigured.
    failures.forEach((message) => toast.error(message, { duration: 10000 }));
    return done;
  }, []);

  /** Drop a row from the tray (e.g. a failed upload the user dismisses). */
  const remove = useCallback((id: string) => {
    setPending((prev) => {
      const hit = prev.find((p) => p.id === id);
      if (hit?.previewUrl) URL.revokeObjectURL(hit.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }, []);

  /** Clear the tray, typically after a form is saved or closed. */
  const reset = useCallback(() => {
    setPending((prev) => { prev.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl)); return []; });
  }, []);

  /** Retry every failed row. */
  const retryFailed = useCallback(async (): Promise<string[]> => {
    const failed = pending.filter((p) => p.status === "error");
    if (!failed.length) return [];
    setPending((prev) => prev.filter((p) => p.status !== "error"));
    return upload(failed.map((p) => p.file));
  }, [pending, upload]);

  return { pending, busy, upload, remove, reset, retryFailed };
}

/**
 * Open a file picker without needing a hidden <input> in the tree.
 *
 * The hidden-input pattern kept breaking in this codebase: the input lived
 * outside the modal that used it, so unmounting the modal (or re-rendering it)
 * dropped the ref and the click did nothing at all — the single most common
 * cause of "I click upload and nothing happens".
 */
export function pickFiles(opts?: { accept?: string; multiple?: boolean; capture?: string }): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    if (opts?.accept) input.accept = opts.accept;
    if (opts?.multiple) input.multiple = true;
    if (opts?.capture) input.setAttribute("capture", opts.capture);
    input.style.position = "fixed";
    input.style.left = "-9999px";
    // Safari and Firefox will not open a picker for an input that is not in the
    // document, so it has to be attached — just kept off-screen.
    document.body.appendChild(input);

    let settled = false;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };

    input.addEventListener("change", () => finish(Array.from(input.files || [])));
    // Cancelling the dialog fires no `change` event in most browsers. Without
    // this the promise would hang forever and any spinner with it.
    input.addEventListener("cancel", () => finish([]));
    window.addEventListener("focus", () => {
      // `focus` returns before the change event is dispatched, so give it a turn.
      setTimeout(() => { if (!input.files?.length) finish([]); }, 400);
    }, { once: true });

    input.click();
  });
}
