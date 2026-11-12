// Weak-signal outbox (idea.md 6.3): nothing typed on site may be lost.
//
// When a save fails because there's no connection, the request (and any photos
// picked for it) is kept in this phone's IndexedDB and sent, in order, as soon
// as the connection is back: on the browser's "online" event, when the app
// comes back to the front, and every 30 seconds. Photos are uploaded first and
// their URLs put into the request. A request the server refuses (a real error,
// not the network) stays in the outbox with the reason, so it can be fixed or
// discarded, never silently dropped.
import { http } from "./api";
import api from "./api";

export type OutboxItem = {
  id: string;
  label: string;              // "Daily log · Kitengela House"
  method: "POST" | "PUT";
  path: string;
  body: Record<string, any>;
  /** Photos/videos picked offline, appended to body[field] once uploaded. */
  files?: { field: string; blobs: Blob[]; names: string[] }[];
  createdAt: number;
  tries: number;
  error?: string;             // the server's reason, when it refused the request
};

const DB = "buildsasa-outbox", STORE = "items", EVENT = "buildsasa:outbox";
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req ? (req as IDBRequest<T>).result : undefined);
    t.onerror = () => reject(t.error);
  });
}
const announce = () => { try { window.dispatchEvent(new Event(EVENT)); } catch { /* */ } };

export const outboxItems = async (): Promise<OutboxItem[]> => ((await tx<OutboxItem[]>("readonly", (s) => s.getAll())) || []).sort((a, b) => a.createdAt - b.createdAt);
export async function enqueue(item: Omit<OutboxItem, "id" | "createdAt" | "tries">): Promise<OutboxItem> {
  const full: OutboxItem = { ...item, id: `ob-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, createdAt: Date.now(), tries: 0 };
  await tx("readwrite", (s) => s.put(full));
  announce();
  return full;
}
export async function discard(id: string) { await tx("readwrite", (s) => s.delete(id)); announce(); }
export const onOutboxChange = (fn: () => void) => { window.addEventListener(EVENT, fn); return () => window.removeEventListener(EVENT, fn); };

/** No connection, or a gateway that couldn't reach the server: worth retrying. */
export function isOffline(e: any): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const m = String(e?.message || e || "");
  return e instanceof TypeError || /failed to fetch|networkerror|load failed|network request failed|unreachable|timed? ?out|ERR_INTERNET/i.test(m);
}

let flushing: Promise<void> | null = null;
/** Send everything waiting, oldest first. Stops at the first network failure. */
export function flushOutbox(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    for (const item of await outboxItems()) {
      if (item.error) continue;   // refused by the server: waits for the user
      try {
        const body = { ...item.body };
        for (const f of item.files || []) {
          if (!f.blobs.length) continue;
          const files = f.blobs.map((b, i) => new File([b], f.names[i] || `photo-${i}.jpg`, { type: b.type || "image/jpeg" }));
          const { urls, failed } = await api.uploadFiles(files);
          if (failed.length && !urls.length) throw new Error(failed[0].error || "Upload failed");
          body[f.field] = [...(Array.isArray(body[f.field]) ? body[f.field] : []), ...urls];
        }
        await http(item.path, { method: item.method, body: JSON.stringify(body) });
        await tx("readwrite", (s) => s.delete(item.id));
        announce();
        try { window.dispatchEvent(new CustomEvent("buildsasa:outbox-sent", { detail: { label: item.label } })); } catch { /* */ }
      } catch (e: any) {
        if (isOffline(e)) { await tx("readwrite", (s) => s.put({ ...item, tries: item.tries + 1 })); break; }
        await tx("readwrite", (s) => s.put({ ...item, tries: item.tries + 1, error: String(e?.message || "The server refused this").slice(0, 300) }));
        announce();
      }
    }
  })().finally(() => { flushing = null; announce(); });
  return flushing;
}
/** Try a refused item again (after the cause is fixed). */
export async function retry(id: string) {
  const it = (await outboxItems()).find((x) => x.id === id);
  if (it) { await tx("readwrite", (s) => s.put({ ...it, error: undefined })); await flushOutbox(); }
}

/**
 * Save now if there's signal; otherwise keep it on the phone and send later.
 * Returns the server's answer, or { queued: true } when it was kept for later.
 */
export async function saveOrQueue<T>(item: Omit<OutboxItem, "id" | "createdAt" | "tries">): Promise<T | { queued: true; item: OutboxItem }> {
  if (!item.files?.some((f) => f.blobs.length) && (typeof navigator === "undefined" || navigator.onLine !== false)) {
    try { return await http<T>(item.path, { method: item.method, body: JSON.stringify(item.body) }); }
    catch (e) { if (!isOffline(e)) throw e; }
  }
  return { queued: true, item: await enqueue(item) };
}

let started = false;
/** Start retrying in the background (call once at app start). */
export function startOutbox() {
  if (started || typeof window === "undefined" || !("indexedDB" in window)) return;
  started = true;
  const go = () => { if (navigator.onLine !== false) flushOutbox().catch(() => {}); };
  window.addEventListener("online", go);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") go(); });
  setInterval(go, 30000);
  go();
}
