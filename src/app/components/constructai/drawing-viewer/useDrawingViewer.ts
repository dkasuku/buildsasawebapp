// ============================================================================
// useDrawingViewer — all viewer state & actions in one hook.
// Presentation components stay dumb; they read this and call its actions.
// ============================================================================

import { useState, useEffect, useCallback, useMemo } from "react";
import type { Drawing, DrawingRevision, Markup, MarkupTool, DrawingSeed, ViewerRole } from "./types";
import { capabilitiesFor } from "./types";
import { drawingService } from "./drawingService";
import { toast } from "sonner";

// The signed-in user, shown as the author of markups placed in this session.
const ME = (() => { try { return JSON.parse(localStorage.getItem("constructai-user") || "null")?.name || "You"; } catch { return "You"; } })();
const TOOL_COLOR: Record<MarkupTool, string> = { pin: "#FF6B1A", text: "#22C55E", note: "#3B82F6" };

export function useDrawingViewer(seed: DrawingSeed, role: ViewerRole) {
  const caps = useMemo(() => capabilitiesFor(role), [role]);

  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [revisions, setRevisions] = useState<DrawingRevision[]>([]);
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null);
  const [markups, setMarkups] = useState<Markup[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Viewport
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // Tools / selection
  const [activeTool, setActiveTool] = useState<MarkupTool | null>(null);
  const [selectedMarkupId, setSelectedMarkupId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");

  // Auto-save indicator. Markups save automatically (no manual Save button) —
  // this surfaces that to the user.
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const flagSaved = useCallback(() => { setSaveState("saving"); window.setTimeout(() => setSaveState("saved"), 280); }, []);

  const selectedRevision = useMemo(
    () => revisions.find((r) => r.id === selectedRevisionId) ?? null,
    [revisions, selectedRevisionId]
  );
  const isViewingLatest = selectedRevision?.isLatest ?? true;

  // ---- Load drawing + revisions ----
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setLoadError(null);
      let d, revs;
      try {
        d = await drawingService.getDrawing(seed);
        revs = await drawingService.getRevisions(d.id);
      } catch (e: any) {
        if (alive) { setLoadError(e?.message || "This drawing couldn't be opened."); setLoading(false); }
        return;
      }
      if (!alive) return;
      setDrawing(d);
      setRevisions(revs);
      setSelectedRevisionId(d.currentRevisionId);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [seed.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Load markups whenever the selected revision changes ----
  useEffect(() => {
    if (!selectedRevisionId) return;
    let alive = true;
    drawingService.getMarkups(selectedRevisionId).then((m) => { if (alive) setMarkups(m); });
    // reset viewport on revision switch
    setZoom(1); setPan({ x: 0, y: 0 }); setSelectedMarkupId(null);
    return () => { alive = false; };
  }, [selectedRevisionId]);

  // ---- Viewport actions ----
  const zoomIn = useCallback(() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2))), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(0.25, +(z - 0.25).toFixed(2))), []);
  const fitToScreen = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, []);

  // ---- Tool actions ----
  const toggleTool = useCallback((t: MarkupTool) => {
    if (!caps.canMarkup) return;
    setActiveTool((cur) => (cur === t ? null : t));
  }, [caps.canMarkup]);

  // Place a markup at canvas-relative %coords (called by the canvas on click).
  const placeMarkup = useCallback(async (x: number, y: number) => {
    if (!activeTool || !selectedRevisionId || !caps.canMarkup) return;
    const isNote = activeTool === "note";
    const text = activeTool === "text" ? (draftText || "Note") : "";
    const optimistic: Markup = {
      id: `tmp_${Date.now()}`,
      revisionId: selectedRevisionId,
      tool: activeTool,
      x, y,
      ...(isNote ? { w: 24, h: 16 } : {}),
      text,
      color: TOOL_COLOR[activeTool],
      author: ME,
      createdAt: new Date().toISOString(),
      status: "open",
    };
    setMarkups((prev) => [...prev, optimistic]);
    setActiveTool(null);
    setDraftText("");
    if (isNote || activeTool === "text") setSelectedMarkupId(optimistic.id);
    let saved;
    try {
      saved = await drawingService.createMarkup(selectedRevisionId, {
        tool: optimistic.tool, x, y, w: optimistic.w, h: optimistic.h, text, color: optimistic.color, author: ME,
      });
    } catch (e: any) {
      setMarkups((prev) => prev.filter((m) => m.id !== optimistic.id));
      toast.error(`The markup wasn't saved: ${e?.message || "please try again"}`);
      return;
    }
    setMarkups((prev) => prev.map((m) => (m.id === optimistic.id ? saved : m)));
    if (isNote || activeTool === "text") setSelectedMarkupId(saved.id);
    flagSaved();
  }, [activeTool, selectedRevisionId, caps.canMarkup, draftText, flagSaved]);

  const moveMarkup = useCallback((id: string, x: number, y: number) => {
    setMarkups((prev) => prev.map((m) => (m.id === id ? { ...m, x, y } : m)));
  }, []);
  const commitMarkup = useCallback((id: string, patch: Partial<Markup>) => {
    if (!selectedRevisionId) return;
    setMarkups((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
    drawingService.updateMarkup(selectedRevisionId, id, patch).catch((e) => toast.error(`Change not saved: ${e?.message || "please try again"}`));
    flagSaved();
  }, [selectedRevisionId, flagSaved]);
  const setMarkupText = useCallback((id: string, text: string) => {
    setMarkups((prev) => prev.map((m) => (m.id === id ? { ...m, text } : m)));
  }, []);
  const resolveMarkup = useCallback((id: string, status: Markup["status"]) => {
    if (!caps.canResolve || !selectedRevisionId) return;
    setMarkups((prev) => prev.map((m) => (m.id === id ? { ...m, status } : m)));
    drawingService.updateMarkup(selectedRevisionId, id, { status }).catch((e) => toast.error(`Not saved: ${e?.message || "please try again"}`));
    flagSaved();
  }, [caps.canResolve, selectedRevisionId, flagSaved]);
  const deleteMarkup = useCallback((id: string) => {
    if (!selectedRevisionId) return;
    setMarkups((prev) => prev.filter((m) => m.id !== id));
    drawingService.deleteMarkup(selectedRevisionId, id).catch((e) => toast.error(`Not saved: ${e?.message || "please try again"}`));
    flagSaved();
  }, [selectedRevisionId, flagSaved]);
  const clearMarkups = useCallback(() => {
    if (!selectedRevisionId) return;
    const open = markups.filter((m) => m.status === "open");
    if (!open.length) return;
    // Markups are shared with the whole team now, so confirm before wiping them.
    if (!window.confirm(`Delete all ${open.length} open markup${open.length === 1 ? "" : "s"} on this revision? Everyone on the team will lose them.`)) return;
    open.forEach((m) => drawingService.deleteMarkup(selectedRevisionId, m.id).catch((e) => toast.error(`Not saved: ${e?.message || "please try again"}`)));
    setMarkups((prev) => prev.filter((m) => m.status !== "open"));
    flagSaved();
  }, [markups, selectedRevisionId, flagSaved]);

  return {
    // data
    seed, role, caps, loading, loadError, saveState,
    drawing, revisions, selectedRevision, selectedRevisionId, isViewingLatest, markups,
    // viewport
    zoom, pan, setPan, zoomIn, zoomOut, fitToScreen, setZoom,
    // tools
    activeTool, toggleTool, draftText, setDraftText,
    selectedMarkupId, setSelectedMarkupId,
    // markup actions
    placeMarkup, moveMarkup, commitMarkup, setMarkupText, resolveMarkup, deleteMarkup, clearMarkups,
    // versions
    selectRevision: setSelectedRevisionId,
  };
}

export type DrawingViewerState = ReturnType<typeof useDrawingViewer>;
