// ============================================================================
// DrawingCanvas — pan/zoom surface + editable markup layer + minimap.
// Pure presentation: everything comes from the useDrawingViewer state object.
// ============================================================================

import { useRef, useState, useCallback } from "react";
import { X, Check, RotateCcw } from "lucide-react";
import type { DrawingViewerState } from "./useDrawingViewer";
import { ImageWithFallback } from "../../figma/ImageWithFallback";

const PUNCH_COLOR: Record<string, string> = { open: "#EF4444", in_progress: "#3B82F6", ready_for_review: "#A855F7", resolved: "#F5A623", closed: "#22C55E", rejected: "#8A95A5" };
const parseCoords = (s?: string) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

export function DrawingCanvas({ vm, punchPins = [], punchActive = false, onPunchPlace, onPunchClick }: { vm: DrawingViewerState; punchPins?: any[]; punchActive?: boolean; onPunchPlace?: (x: number, y: number) => void; onPunchClick?: (id: string) => void }) {
  const { selectedRevision, markups, zoom, pan, setPan, activeTool, caps,
    placeMarkup, moveMarkup, commitMarkup, setMarkupText, deleteMarkup,
    selectedMarkupId, setSelectedMarkupId, setZoom } = vm;

  const pageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<any>(null);
  const panRef = useRef<any>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  const pct = (clientX: number, clientY: number) => {
    const r = pageRef.current?.getBoundingClientRect();
    if (!r) return { x: 50, y: 50 };
    return {
      x: Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)),
      y: Math.max(0, Math.min(100, ((clientY - r.top) / r.height) * 100)),
    };
  };

  // Place a markup where the user clicks (only when a tool is armed).
  const onPageClick = (e: React.MouseEvent) => {
    if (punchActive) { const c = pct(e.clientX, e.clientY); onPunchPlace?.(c.x, c.y); return; }
    if (!activeTool) return;
    const { x, y } = pct(e.clientX, e.clientY);
    placeMarkup(x, y);
  };

  // Drag a markup.
  const startMarkupDrag = (e: React.PointerEvent, id: string) => {
    if (selectedMarkupId === id && (e.target as HTMLElement).tagName === "TEXTAREA") return;
    e.stopPropagation();
    dragRef.current = { id, moved: false, last: null };
    const onMove = (ev: PointerEvent) => {
      const { x, y } = pct(ev.clientX, ev.clientY);
      dragRef.current.moved = true; dragRef.current.last = { x, y };
      moveMarkup(id, x, y);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (dragRef.current?.moved && dragRef.current.last) commitMarkup(id, dragRef.current.last);
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Pan the page (only when no tool is armed and you grab empty space).
  const startPan = (e: React.PointerEvent) => {
    if (activeTool) return;
    panRef.current = { startX: e.clientX, startY: e.clientY, origX: pan.x, origY: pan.y };
    const onMove = (ev: PointerEvent) => {
      if (!panRef.current) return;
      setPan({ x: panRef.current.origX + (ev.clientX - panRef.current.startX), y: panRef.current.origY + (ev.clientY - panRef.current.startY) });
    };
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); panRef.current = null; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return; // ctrl/cmd+scroll to zoom, plain scroll to pan-through-overflow
    e.preventDefault();
    setZoom((z) => Math.max(0.25, Math.min(4, +(z - Math.sign(e.deltaY) * 0.15).toFixed(2))));
  }, [setZoom]);

  if (!selectedRevision) return <div className="flex-1 bg-[#050709]" />;

  const isPdf = selectedRevision.fileType === "pdf";
  const visible = markups.filter((m) => m.revisionId === selectedRevision.id);

  return (
    <div
      className={`relative flex-1 overflow-hidden bg-[#050709] ${activeTool || punchActive ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing"}`}
      onWheel={onWheel}
      onPointerDown={startPan}
      onMouseMove={(e) => setCursor(pct(e.clientX, e.clientY))}
      onMouseLeave={() => setCursor(null)}
    >
      <div className="absolute inset-0 flex items-center justify-center p-6 select-none">
        <div
          ref={pageRef}
          onClick={onPageClick}
          className="relative shadow-2xl"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transition: panRef.current ? "none" : "transform 0.08s ease-out" }}
        >
          {isPdf ? (
            // 🔌 PDF: drop a react-pdf / pdf.js <Page> here. Placeholder keeps layout + markups working.
            <div className="w-[680px] h-[480px] bg-white text-[#0F172A] flex flex-col items-center justify-center gap-2 rounded-sm">
              <div className="text-[13px] font-semibold">{selectedRevision.fileSize} · PDF</div>
              <div className="text-[11px] text-[#64748B]">PDF rendering integration point (pdf.js)</div>
            </div>
          ) : (
            <ImageWithFallback src={selectedRevision.fileUrl} alt="drawing" className="max-w-none max-h-[78vh] block" draggable={false} />
          )}

          {/* Markup layer */}
          {visible.map((m) => {
            const dim = m.status === "resolved" ? "opacity-50" : "";
            if (m.tool === "note") {
              return (
                <div key={m.id} onPointerDown={(e) => startMarkupDrag(e, m.id)} onClick={(e) => { e.stopPropagation(); setSelectedMarkupId(m.id); }}
                  className={`absolute group rounded-md border-2 bg-black/55 backdrop-blur-sm shadow-lg cursor-move ${dim}`}
                  style={{ left: `${m.x}%`, top: `${m.y}%`, width: `${m.w ?? 24}%`, height: `${m.h ?? 16}%`, transform: "translate(-50%,-50%)", borderColor: m.color }}>
                  {caps.canMarkup && <button onClick={(e) => { e.stopPropagation(); deleteMarkup(m.id); }} className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-[#EF4444] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 z-10"><X className="w-3 h-3" /></button>}
                  {selectedMarkupId === m.id && caps.canMarkup ? (
                    <textarea autoFocus value={m.text} onChange={(e) => setMarkupText(m.id, e.target.value)} onBlur={() => commitMarkup(m.id, { text: m.text })} onPointerDown={(e) => e.stopPropagation()} placeholder="Field note, RFI, issue…" className="w-full h-full bg-transparent dwg-ink text-[11px] p-2 resize-none focus:outline-none placeholder:text-[#8A95A5]" />
                  ) : (
                    <div className="w-full h-full p-2 dwg-ink text-[11px] whitespace-pre-wrap break-words overflow-auto">{m.text || "Note"}</div>
                  )}
                </div>
              );
            }
            return (
              <div key={m.id} onPointerDown={(e) => startMarkupDrag(e, m.id)} onClick={(e) => { e.stopPropagation(); setSelectedMarkupId(m.id); }}
                className={`absolute group cursor-move ${dim}`} style={{ left: `${m.x}%`, top: `${m.y}%`, transform: "translate(-50%,-50%)" }}>
                {caps.canMarkup && <button onClick={(e) => { e.stopPropagation(); deleteMarkup(m.id); }} className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-[#EF4444] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 z-10"><X className="w-2.5 h-2.5" /></button>}
                {m.tool === "pin" ? (
                  <div className="flex flex-col items-center">
                    <div className="w-4 h-4 rounded-full border-2 border-white shadow" style={{ background: m.color }} />
                    {m.text && <div className="mt-1 px-1.5 py-0.5 rounded bg-black/70 dwg-ink text-[10px] whitespace-nowrap max-w-[160px] truncate">{m.text}</div>}
                  </div>
                ) : selectedMarkupId === m.id && caps.canMarkup ? (
                  <input autoFocus value={m.text} onChange={(e) => setMarkupText(m.id, e.target.value)} onBlur={() => commitMarkup(m.id, { text: m.text })} onPointerDown={(e) => e.stopPropagation()} className="px-2 py-1 rounded bg-black/80 dwg-ink text-[11px] border focus:outline-none" style={{ borderColor: m.color }} />
                ) : (
                  <div className="px-2 py-1 rounded bg-black/70 dwg-ink text-[11px] whitespace-nowrap border" style={{ borderColor: m.color }}>{m.text || "Text"}</div>
                )}
              </div>
            );
          })}

          {/* Punch pins linked to this drawing (status-colored) */}
          {punchPins.map((p) => {
            const c = parseCoords(p.drawingCoordinates); if (!c) return null;
            const color = PUNCH_COLOR[p.status] || "#EF4444";
            return (
              <button key={p.id} onClick={(e) => { e.stopPropagation(); onPunchClick?.(p.id); }} onPointerDown={(e) => e.stopPropagation()}
                className="absolute group/punch" style={{ left: `${c.x}%`, top: `${c.y}%`, transform: "translate(-50%,-100%)" }} title={`${p.code} · ${p.title || p.desc || ""} · ${p.status}`}>
                <svg width="22" height="28" viewBox="0 0 22 28"><path d="M11 0C5 0 0 4.6 0 10.3 0 18 11 28 11 28s11-10 11-17.7C22 4.6 17 0 11 0z" fill={color} stroke="#fff" strokeWidth="1.5" /><circle cx="11" cy="10" r="4" fill="#fff" /></svg>
                <div className="absolute left-1/2 -translate-x-1/2 mt-0.5 px-1.5 py-0.5 rounded bg-black/80 dwg-ink text-[9px] whitespace-nowrap opacity-0 group-hover/punch:opacity-100 pointer-events-none">{p.code} · {p.title || p.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Mini-map / overview */}
      <div className="absolute bottom-3 right-3 w-36 h-24 rounded-md border border-[#222A35] bg-[#0A0E14]/90 overflow-hidden hidden sm:block">
        {!isPdf && <ImageWithFallback src={selectedRevision.fileUrl} alt="overview" className="w-full h-full object-cover opacity-60" draggable={false} />}
        <div className="absolute inset-0">
          {visible.map((m) => <span key={m.id} className="absolute w-1 h-1 rounded-full" style={{ left: `${m.x}%`, top: `${m.y}%`, background: m.color }} />)}
        </div>
        <div className="absolute top-1 left-1 text-[8px] uppercase tracking-wider text-[#8A95A5] bg-black/50 px-1 rounded">Overview</div>
      </div>

      {/* Cursor readout + reset */}
      {cursor && <div className="absolute bottom-3 left-3 text-[10px] font-mono text-[#8A95A5] bg-[#0A0E14]/80 px-2 py-1 rounded hidden sm:block">x {cursor.x.toFixed(0)} · y {cursor.y.toFixed(0)}</div>}
      <button onClick={vm.fitToScreen} title="Reset view" className="absolute top-3 right-3 w-8 h-8 rounded-md border border-[#222A35] bg-[#0A0E14]/80 text-[#8A95A5] hover:text-white flex items-center justify-center"><RotateCcw className="w-4 h-4" /></button>
    </div>
  );
}
