// ============================================================================
// Drawing Viewer — data service (in-memory mock + real-backend integration points)
//
// This is the ONLY file that knows where data comes from. Swap the bodies of
// these functions for real HTTP calls (see the // 🔌 BACKEND markers) without
// touching any presentation component or the useDrawingViewer hook.
// ============================================================================

import type { Drawing, DrawingRevision, Markup, ShareLink, DrawingSeed, ShareAccess, MarkupTool } from "./types";

const nowISO = () => new Date().toISOString();
const uid = (p = "id") => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// In-memory stores keyed appropriately. Replace with API responses later.
const revisionStore: Record<string, DrawingRevision[]> = {}; // drawingId -> revisions
const markupStore: Record<string, Markup[]> = {};            // revisionId -> markups
const drawingStore: Record<string, Drawing> = {};

// Local persistence so markups survive a page reload even before a backend is
// wired in. 🔌 BACKEND: once the real API persists markups, this can be removed.
const LS_KEY = "buildflex-drawing-markups";
function hydrate() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) Object.assign(markupStore, JSON.parse(raw));
  } catch { /* ignore */ }
}
function persist() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(markupStore)); } catch { /* ignore */ }
}
let hydrated = false;

// Build a Drawing + its revision history from the seed handed in by the host
// screen. In production this whole function becomes a `GET /drawings/:id`.
function ensureSeed(seed: DrawingSeed) {
  if (!hydrated) { hydrate(); hydrated = true; }
  if (drawingStore[seed.id]) return;
  const baseRev = seed.rev ?? 1;
  const revs: DrawingRevision[] = [];
  // Synthesize a small revision history so the Versions panel is meaningful.
  for (let r = 1; r <= baseRev; r++) {
    revs.push({
      id: `${seed.id}__r${r}`,
      drawingId: seed.id,
      rev: r,
      status: r === baseRev ? (seed.status ?? "published") : "published",
      fileUrl: seed.fileUrl,
      fileType: seed.fileType ?? (seed.fileUrl.toLowerCase().endsWith(".pdf") ? "pdf" : "image"),
      fileSize: seed.fileSize ?? "—",
      uploadedBy: r === baseRev ? "You" : "A. Hassan",
      uploadedAt: new Date(Date.now() - (baseRev - r) * 1000 * 60 * 60 * 24 * 9).toISOString(),
      changeNote: r === 1 ? "Initial issue" : `Revision ${r} — coordination updates`,
      isLatest: r === baseRev,
    });
  }
  revisionStore[seed.id] = revs;
  const latest = revs[revs.length - 1];
  drawingStore[seed.id] = {
    id: seed.id,
    sheetNumber: seed.sheetNumber,
    title: seed.title,
    projectName: seed.projectName,
    discipline: seed.discipline,
    currentRevisionId: latest.id,
    recipients: seed.recipients ?? 0,
    updatedAt: latest.uploadedAt,
  };
  // A couple of demo markups on the latest revision so the panel isn't empty
  // (only if nothing was restored from local persistence).
  if (!markupStore[latest.id]) markupStore[latest.id] = [
    { id: uid("mk"), revisionId: latest.id, tool: "pin", x: 38, y: 30, text: "Confirm beam depth at this grid.", color: "#FF6B1A", author: "J. Mwangi", createdAt: nowISO(), status: "open" },
    { id: uid("mk"), revisionId: latest.id, tool: "note", x: 64, y: 58, w: 24, h: 14, text: "RFI-045: duct clash — awaiting architect response.", color: "#3B82F6", author: "G. Njeri", createdAt: nowISO(), status: "open" },
  ];
}

export const drawingService = {
  async getDrawing(seed: DrawingSeed): Promise<Drawing> {
    ensureSeed(seed);
    // 🔌 BACKEND: return (await api.getDrawing(seed.id))
    return drawingStore[seed.id];
  },

  async getRevisions(drawingId: string): Promise<DrawingRevision[]> {
    // 🔌 BACKEND: return (await api.getDrawingVersions(projectId)).filter(v => v.drawingId === drawingId)
    return [...(revisionStore[drawingId] ?? [])].sort((a, b) => b.rev - a.rev);
  },

  async getMarkups(revisionId: string): Promise<Markup[]> {
    // 🔌 BACKEND: return (await api.getMarkups(projectId)).filter(m => m.revisionId === revisionId)
    return [...(markupStore[revisionId] ?? [])];
  },

  async createMarkup(revisionId: string, m: { tool: MarkupTool; x: number; y: number; w?: number; h?: number; text: string; color: string; author: string }): Promise<Markup> {
    const markup: Markup = { id: uid("mk"), revisionId, status: "open", createdAt: nowISO(), attachment: null, ...m };
    markupStore[revisionId] = [...(markupStore[revisionId] ?? []), markup];
    persist();
    // 🔌 BACKEND: const saved = await api.createMarkup(projectId, {...}); return saved;
    return markup;
  },

  async updateMarkup(revisionId: string, id: string, patch: Partial<Markup>): Promise<void> {
    markupStore[revisionId] = (markupStore[revisionId] ?? []).map((m) => (m.id === id ? { ...m, ...patch } : m));
    persist();
    // 🔌 BACKEND: await api.updateMarkup(projectId, id, patch);
  },

  async deleteMarkup(revisionId: string, id: string): Promise<void> {
    markupStore[revisionId] = (markupStore[revisionId] ?? []).filter((m) => m.id !== id);
    persist();
    // 🔌 BACKEND: await api.deleteMarkup(projectId, id);
  },

  async createShareLink(drawingId: string, revisionId: string, opts: { access: ShareAccess; expiresAt?: string | null }): Promise<ShareLink> {
    const token = Math.random().toString(36).slice(2, 10);
    const base = (typeof window !== "undefined" ? window.location.origin : "https://app.buildflex.co.ke");
    const link: ShareLink = {
      id: uid("share"),
      drawingId,
      revisionId,
      access: opts.access,
      url: `${base}/d/${drawingId}/${revisionId}?t=${token}`,
      expiresAt: opts.expiresAt ?? null,
      createdAt: nowISO(),
    };
    // 🔌 BACKEND: const saved = await api.createShareLink(...); return saved;
    return link;
  },
};

// QR generation integration point.
// Default uses a public QR image endpoint (works in the browser, no deps).
// Swap for the `qrcode` npm package (offline) if field connectivity is a concern.
export function qrImageUrl(data: string, size = 220): string {
  // 🔌 QR: replace with `await QRCode.toDataURL(data)` from the `qrcode` package.
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=8&data=${encodeURIComponent(data)}`;
}
