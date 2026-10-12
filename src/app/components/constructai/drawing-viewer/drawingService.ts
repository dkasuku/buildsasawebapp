// ============================================================================
// Drawing Viewer — data service.
//
// The only file that knows where viewer data comes from. Everything is real:
//   * Revisions are the Drawing rows sharing the sheet's number in its project
//     (each upload of a sheet is a revision), newest first.
//   * Markups are PlanMarkup rows on those revisions, so the whole team sees
//     the same pins and notes.
//   * The share link opens the drawing in Buildsasa for anyone on the team.
// (This used to be an in-memory mock that invented earlier revisions and demo
// markups, and kept real markups in one browser's local storage.)
// ============================================================================

import api, { absoluteFileUrl, type DrawingDto, type PlanMarkupDto } from "../../../services/api";
import type { Drawing, DrawingRevision, Markup, ShareLink, DrawingSeed, MarkupTool } from "./types";

const sizeLabel = (bytes?: number | null) => {
  if (!bytes) return "—";
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
};
const isPdf = (url: string, name?: string | null) => /\.pdf(\?|$)/i.test(name || url);

// The project each loaded drawing belongs to, for markup writes.
const projectOf: Record<string, string> = {};
const markupCache: Record<string, Markup[]> = {}; // revisionId -> markups

const toRevision = (d: DrawingDto, latestId: string): DrawingRevision => ({
  id: d.id,
  drawingId: d.id,
  rev: d.rev,
  status: /draft/i.test(d.status) ? "draft" : "published",
  fileUrl: absoluteFileUrl(d.fileUrl),
  fileType: isPdf(d.fileUrl, d.fileName) ? "pdf" : "image",
  fileSize: sizeLabel(d.fileSize),
  uploadedBy: d.uploadedBy || "—",
  uploadedAt: d.createdAt,
  changeNote: d.status && !/draft|published/i.test(d.status) ? d.status : undefined,
  isLatest: d.id === latestId,
});

const toMarkup = (m: PlanMarkupDto): Markup => ({
  id: m.id,
  revisionId: m.drawingId,
  tool: (["pin", "text", "note"].includes(m.type) ? m.type : "pin") as MarkupTool,
  x: m.x, y: m.y,
  ...(m.w != null ? { w: m.w } : {}),
  ...(m.h != null ? { h: m.h } : {}),
  text: m.text || "",
  color: m.color,
  author: m.createdBy,
  createdAt: m.createdAt,
  status: m.status === "resolved" ? "resolved" : "open",
});

let lastLoad: { drawing: Drawing; revisions: DrawingRevision[] } | null = null;

export const drawingService = {
  async getDrawing(seed: DrawingSeed): Promise<Drawing> {
    const r = await api.getDrawingViewer(seed.id);
    const revs = r.revisions.length ? r.revisions : [r.drawing];
    const latest = revs[0];
    for (const rev of revs) { projectOf[rev.id] = r.drawing.projectId; markupCache[rev.id] = []; }
    for (const m of r.markups) (markupCache[m.drawingId] ||= []).push(toMarkup(m));
    const drawing: Drawing = {
      id: latest.id,
      sheetNumber: r.drawing.number,
      title: latest.title,
      projectName: r.projectName || seed.projectName,
      discipline: latest.discipline,
      // Open the revision that was clicked, even if a newer one exists.
      currentRevisionId: revs.some((x) => x.id === seed.id) ? seed.id : latest.id,
      recipients: seed.recipients ?? 0,
      updatedAt: latest.updatedAt || latest.createdAt,
    };
    lastLoad = { drawing, revisions: revs.map((x) => toRevision(x, latest.id)) };
    return drawing;
  },

  async getRevisions(_drawingId: string): Promise<DrawingRevision[]> {
    return lastLoad ? lastLoad.revisions : [];
  },

  async getMarkups(revisionId: string): Promise<Markup[]> {
    return [...(markupCache[revisionId] ?? [])];
  },

  async createMarkup(revisionId: string, m: { tool: MarkupTool; x: number; y: number; w?: number; h?: number; text: string; color: string; author: string }): Promise<Markup> {
    const saved = await api.createMarkup(projectOf[revisionId], { drawingId: revisionId, type: m.tool, x: m.x, y: m.y, w: m.w ?? null, h: m.h ?? null, text: m.text, color: m.color });
    const mk = toMarkup(saved);
    markupCache[revisionId] = [...(markupCache[revisionId] ?? []), mk];
    return mk;
  },

  async updateMarkup(revisionId: string, id: string, patch: Partial<Markup>): Promise<void> {
    markupCache[revisionId] = (markupCache[revisionId] ?? []).map((m) => (m.id === id ? { ...m, ...patch } : m));
    const body: Record<string, unknown> = {};
    for (const k of ["x", "y", "w", "h", "text", "color", "status"] as const) if (patch[k] !== undefined) body[k] = patch[k];
    if (patch.tool) body.type = patch.tool;
    await api.updateMarkup(projectOf[revisionId], id, body as any);
  },

  async deleteMarkup(revisionId: string, id: string): Promise<void> {
    markupCache[revisionId] = (markupCache[revisionId] ?? []).filter((m) => m.id !== id);
    await api.deleteMarkup(projectOf[revisionId], id);
  },

  /** A link that opens this drawing in Buildsasa. Teammates sign in to view it. */
  async createShareLink(drawingId: string, revisionId: string): Promise<ShareLink> {
    return {
      id: revisionId, drawingId, revisionId, access: "view",
      url: `${window.location.origin}/?drawing=${encodeURIComponent(revisionId)}`,
      expiresAt: null, createdAt: new Date().toISOString(),
    };
  },
};

// QR code image for a link, so a site phone can open the drawing by scanning.
export function qrImageUrl(data: string, size = 220): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=8&data=${encodeURIComponent(data)}`;
}
