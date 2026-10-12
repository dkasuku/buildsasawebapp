// ============================================================================
// DrawingViewer — full-screen construction drawing viewer.
// Composes: Header · Toolbar · Canvas · SidePanel (markups/versions) ·
// ShareDialog (+QR) · Footer. Role-aware. Original UI.
// ============================================================================

import { useState, useEffect } from "react";
import {
  X, MapPin, Type, StickyNote, Eraser, Layers, ZoomIn, ZoomOut, Maximize2,
  Download, Share2, MoreHorizontal, Check, Copy, Link2, Clock, Users,
  ExternalLink, Printer, CircleDot, CheckCircle2, ChevronRight, Crosshair, ArrowLeft, MessageCircle, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import type { DrawingSeed, ViewerRole, MarkupTool } from "./types";
import { useDrawingViewer, type DrawingViewerState } from "./useDrawingViewer";
import { drawingService, qrImageUrl } from "./drawingService";
import { DrawingCanvas } from "./DrawingCanvas";
import api from "../../../services/api";
import type { Role } from "../roles";
import { PunchForm, PunchDetail } from "../PunchListPro";

const timeAgo = (iso: string) => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); return `${d}d ago`;
};

export function DrawingViewer({ seed, role, onClose, appRole = "Contractor" as Role }: { seed: DrawingSeed; role: ViewerRole; onClose: () => void; appRole?: Role }) {
  const vm = useDrawingViewer(seed, role);
  // On phones the panel is a bottom sheet over the drawing, so start with it closed.
  const [panel, setPanel] = useState<"none" | "markups" | "versions">(() => (typeof window !== "undefined" && window.innerWidth < 768 ? "none" : "markups"));
  const [shareOpen, setShareOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // Punch integration
  const [punchMode, setPunchMode] = useState(false);
  const [punchPins, setPunchPins] = useState<any[]>([]);
  const [placing, setPlacing] = useState<{ x: number; y: number } | null>(null);
  const [detailPunchId, setDetailPunchId] = useState<string | null>(null);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  // Punch items have always been linked to a drawing by its sheet number.
  const loadPins = () => api.getDrawingPunch(seed.sheetNumber).then(setPunchPins).catch(() => setPunchPins([]));
  useEffect(() => {
    loadPins();
    api.getProjects().then((p) => setProjects(p.map((x) => ({ id: x.id, name: x.name })))).catch(() => {});
    // eslint-disable-next-line
  }, [seed.id, seed.sheetNumber]);

  if (vm.loadError) {
    return (
      <div className="fixed inset-0 z-[58] bg-[#0A0E14] flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <AlertTriangle className="w-8 h-8 text-[#F59E0B] mx-auto" />
          <div className="text-[14px] text-white mt-3">This drawing couldn't be opened</div>
          <div className="text-[12px] text-[#8A95A5] mt-1">{vm.loadError}</div>
          <button onClick={onClose} className="mt-4 h-9 px-4 rounded-md border border-[#222A35] text-[12px] text-white inline-flex items-center gap-1.5"><ArrowLeft className="w-4 h-4" /> Go back</button>
        </div>
      </div>
    );
  }
  if (vm.loading || !vm.drawing || !vm.selectedRevision) {
    return (
      <div className="fixed inset-0 z-[58] bg-[#0A0E14] flex items-center justify-center">
        <div className="text-[13px] text-[#8A95A5]">Loading drawing…</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[58] bg-[#0A0E14] flex flex-col text-[#E6EAF0]">
      <Header vm={vm} onClose={onClose} />
      <Toolbar vm={vm} panel={panel} setPanel={setPanel} onShare={() => setShareOpen(true)} moreOpen={moreOpen} setMoreOpen={setMoreOpen} punchMode={punchMode} setPunchMode={setPunchMode} />
      <div className="flex-1 flex min-h-0 relative">
        <DrawingCanvas vm={vm} punchPins={punchPins} punchActive={punchMode} onPunchPlace={(x, y) => { setPlacing({ x, y }); setPunchMode(false); }} onPunchClick={(id) => setDetailPunchId(id)} />
        {panel !== "none" && <SidePanel vm={vm} panel={panel} setPanel={setPanel} />}
      </div>
      <Footer vm={vm} />
      {shareOpen && <ShareDialog vm={vm} onClose={() => setShareOpen(false)} />}
      {placing && (
        <PunchForm
          role={appRole}
          projects={projects}
          initial={{ id: "", projectId: projects[0]?.id || "", status: "open", priority: "medium", title: "", linkedDrawingId: seed.sheetNumber, drawingCoordinates: JSON.stringify({ x: placing.x, y: placing.y, zoom: vm.zoom }), location: seed.sheetNumber } as any}
          onClose={() => setPlacing(null)}
          onSaved={() => { setPlacing(null); loadPins(); toast.success("Punch item pinned to drawing"); }}
        />
      )}
      {detailPunchId && <PunchDetail id={detailPunchId} role={appRole} onClose={() => setDetailPunchId(null)} onChange={loadPins} />}
    </div>
  );
}

/* ─────────────────────────── Header ─────────────────────────── */
function Header({ vm, onClose }: { vm: DrawingViewerState; onClose: () => void }) {
  const d = vm.drawing!; const r = vm.selectedRevision!;
  return (
    <div className="shrink-0 px-3 sm:px-4 py-3 border-b border-[#222A35] bg-[#11161D] flex items-center justify-between gap-3">
      <button onClick={onClose} title="Back" aria-label="Back" className="shrink-0 h-9 px-2.5 rounded-md border border-[#222A35] text-[#C2CAD6] hover:text-white flex items-center gap-1.5 text-[12px]"><ArrowLeft className="w-4 h-4" /><span className="hidden sm:inline">Back</span></button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-mono text-[#5B6675]">{d.sheetNumber}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#FF6B1A]/15 text-[#FF6B1A] border border-[#FF6B1A]/30">Rev {r.rev}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${r.status === "published" ? "bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/30" : "bg-[#F5A623]/15 text-[#F5A623] border-[#F5A623]/30"}`}>{r.status === "published" ? "Published" : "Draft"}</span>
          {!vm.isViewingLatest && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#EF4444]/15 text-[#EF4444] border border-[#EF4444]/30">Not latest revision</span>}
        </div>
        <div className="text-[14px] text-white font-display truncate mt-0.5">{d.title}</div>
        <div className="text-[11px] text-[#8A95A5] truncate">{d.projectName} · {d.discipline} · {r.fileSize}<span className="hidden sm:inline"> · updated {timeAgo(d.updatedAt)}</span></div>
      </div>
      <button onClick={onClose} title="Close" aria-label="Close" className="shrink-0 w-9 h-9 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white flex items-center justify-center"><X className="w-4 h-4" /></button>
    </div>
  );
}

/* ─────────────────────────── Toolbar ─────────────────────────── */
function ToolBtn({ active, disabled, onClick, icon: Icon, label }: { active?: boolean; disabled?: boolean; onClick: () => void; icon: any; label: string }) {
  return (
    <button onClick={onClick} disabled={disabled} title={disabled ? `${label} — not allowed for your role` : label}
      className={`h-9 px-2.5 rounded-md border text-[11px] flex items-center gap-1.5 transition ${active ? "bg-[#FF6B1A]/15 border-[#FF6B1A]/40 text-[#FF6B1A]" : "border-[#222A35] text-[#8A95A5] hover:text-white"} disabled:opacity-40 disabled:cursor-not-allowed`}>
      <Icon className="w-3.5 h-3.5" /> <span className="hidden md:inline">{label}</span>
    </button>
  );
}

function Toolbar({ vm, panel, setPanel, onShare, moreOpen, setMoreOpen, punchMode, setPunchMode }: { vm: DrawingViewerState; panel: string; setPanel: (p: any) => void; onShare: () => void; moreOpen: boolean; setMoreOpen: (b: boolean) => void; punchMode: boolean; setPunchMode: (b: boolean) => void }) {
  const { caps, activeTool, toggleTool, zoom, zoomIn, zoomOut, fitToScreen, clearMarkups, selectedRevision } = vm;
  const tool = (t: MarkupTool) => activeTool === t;
  const download = () => {
    const a = document.createElement("a");
    a.href = selectedRevision!.fileUrl; a.download = `${vm.drawing!.sheetNumber}-rev${selectedRevision!.rev}`; a.target = "_blank"; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
    toast.success("Downloading current revision");
  };
  return (
    <div className="shrink-0 px-3 py-2 border-b border-[#222A35] bg-[#0A0E14] flex items-center gap-1.5 flex-nowrap sm:flex-wrap overflow-x-auto">
      <ToolBtn active={tool("pin")} disabled={!caps.canMarkup} onClick={() => toggleTool("pin")} icon={MapPin} label="Pin" />
      <ToolBtn active={tool("text")} disabled={!caps.canMarkup} onClick={() => toggleTool("text")} icon={Type} label="Text" />
      <ToolBtn active={tool("note")} disabled={!caps.canMarkup} onClick={() => toggleTool("note")} icon={StickyNote} label="Note Box" />
      <ToolBtn disabled={!caps.canMarkup} onClick={clearMarkups} icon={Eraser} label="Clear" />
      <ToolBtn active={punchMode} disabled={!caps.canMarkup} onClick={() => setPunchMode(!punchMode)} icon={Crosshair} label="Punch" />
      <div className="w-px h-6 bg-[#222A35] mx-1" />
      <ToolBtn active={panel === "versions"} onClick={() => setPanel(panel === "versions" ? "none" : "versions")} icon={Layers} label="Versions" />
      <ToolBtn active={panel === "markups"} onClick={() => setPanel(panel === "markups" ? "none" : "markups")} icon={CircleDot} label="Markups" />
      <div className="w-px h-6 bg-[#222A35] mx-1" />
      <button onClick={zoomOut} className="w-9 h-9 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white flex items-center justify-center"><ZoomOut className="w-4 h-4" /></button>
      <button onClick={fitToScreen} className="h-9 px-2 rounded-md border border-[#222A35] text-[11px] text-[#8A95A5] hover:text-white w-14 text-center" title="Fit to screen">{Math.round(zoom * 100)}%</button>
      <button onClick={zoomIn} className="w-9 h-9 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white flex items-center justify-center"><ZoomIn className="w-4 h-4" /></button>
      <button onClick={fitToScreen} title="Fit to screen" className="w-9 h-9 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white flex items-center justify-center hidden sm:flex"><Maximize2 className="w-4 h-4" /></button>

      <div className="flex-1 min-w-2" />

      <button onClick={download} disabled={!caps.canDownload} className="h-9 px-2.5 rounded-md border border-[#222A35] text-[11px] text-[#8A95A5] hover:text-white flex items-center gap-1.5 disabled:opacity-40"><Download className="w-3.5 h-3.5" /><span className="hidden md:inline">Download</span></button>
      <button onClick={onShare} disabled={!caps.canShare} className="h-9 px-2.5 rounded-md bg-[#FF6B1A] text-white text-[11px] flex items-center gap-1.5 hover:bg-[#FF7E33] disabled:opacity-40"><Share2 className="w-3.5 h-3.5" /><span className="hidden md:inline">Share</span></button>
      <div className="relative">
        <button onClick={() => setMoreOpen(!moreOpen)} className="w-9 h-9 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white flex items-center justify-center"><MoreHorizontal className="w-4 h-4" /></button>
        {moreOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMoreOpen(false)} />
            <div className="absolute right-0 mt-1 w-48 rounded-md border border-[#222A35] bg-[#11161D] shadow-xl z-20 py-1 text-[12px]">
              <button onClick={() => { window.open(selectedRevision!.fileUrl, "_blank"); setMoreOpen(false); }} className="w-full px-3 py-2 text-left text-[#8A95A5] hover:text-white hover:bg-[#161C24] flex items-center gap-2"><ExternalLink className="w-3.5 h-3.5" /> Open in new tab</button>
              <button onClick={() => { window.open(selectedRevision!.fileUrl, "_blank"); setMoreOpen(false); toast("Opened the file in a new tab. Print it from there."); }} className="w-full px-3 py-2 text-left text-[#8A95A5] hover:text-white hover:bg-[#161C24] flex items-center gap-2"><Printer className="w-3.5 h-3.5" /> Print sheet</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────── Side panel (markups + versions) ─────────────────────── */
function SidePanel({ vm, panel, setPanel }: { vm: DrawingViewerState; panel: string; setPanel: (p: any) => void }) {
  return (
    // Bottom sheet over the drawing on phones; a fixed side column from md up.
    <div className="absolute inset-x-0 bottom-0 h-[55%] md:static md:h-auto md:w-[300px] shrink-0 border-t md:border-t-0 md:border-l border-[#222A35] bg-[#11161D] flex flex-col rounded-t-xl md:rounded-none shadow-2xl md:shadow-none z-10">
      <div className="flex border-b border-[#222A35]">
        {(["markups", "versions"] as const).map((t) => (
          <button key={t} onClick={() => setPanel(t)} className={`flex-1 h-10 text-[12px] capitalize ${panel === t ? "text-white border-b-2 border-[#FF6B1A]" : "text-[#8A95A5] hover:text-white"}`}>{t}</button>
        ))}
        <button onClick={() => setPanel("none")} className="md:hidden w-10 h-10 flex items-center justify-center text-[#8A95A5] hover:text-white" title="Hide panel"><X className="w-4 h-4" /></button>
      </div>
      {panel === "markups" ? <MarkupList vm={vm} /> : <VersionList vm={vm} />}
    </div>
  );
}

function MarkupList({ vm }: { vm: DrawingViewerState }) {
  const { markups, selectedRevision, caps, resolveMarkup, setSelectedMarkupId, deleteMarkup } = vm;
  const mine = markups.filter((m) => m.revisionId === selectedRevision!.id);
  const open = mine.filter((m) => m.status === "open");
  const resolved = mine.filter((m) => m.status === "resolved");
  const Row = ({ m }: { m: typeof mine[number] }) => (
    <div className="px-3 py-2.5 border-b border-[#222A35] hover:bg-[#161C24] cursor-pointer group" onClick={() => setSelectedMarkupId(m.id)}>
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: m.color }} />
        <span className="text-[11px] text-white capitalize">{m.tool}</span>
        <span className="text-[10px] text-[#5B6675] ml-auto">{timeAgo(m.createdAt)}</span>
      </div>
      <div className="text-[11px] text-[#C2CAD6] mt-1 line-clamp-2">{m.text || <span className="text-[#5B6675] italic">No text</span>}</div>
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[10px] text-[#8A95A5]">{m.author}</span>
        <div className="flex items-center gap-1 md:opacity-0 md:group-hover:opacity-100">
          {caps.canResolve && (
            m.status === "open"
              ? <button onClick={(e) => { e.stopPropagation(); resolveMarkup(m.id, "resolved"); }} className="text-[10px] px-1.5 py-0.5 rounded bg-[#22C55E]/15 text-[#22C55E] border border-[#22C55E]/30">Resolve</button>
              : <button onClick={(e) => { e.stopPropagation(); resolveMarkup(m.id, "open"); }} className="text-[10px] px-1.5 py-0.5 rounded bg-[#5B6675]/15 text-[#8A95A5] border border-[#5B6675]/30">Reopen</button>
          )}
          {caps.canMarkup && <button onClick={(e) => { e.stopPropagation(); deleteMarkup(m.id); }} className="text-[10px] px-1.5 py-0.5 rounded text-[#8A95A5] hover:text-[#EF4444]">Delete</button>}
        </div>
      </div>
    </div>
  );
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-[#5B6675] flex items-center gap-1.5"><CircleDot className="w-3 h-3 text-[#FF6B1A]" /> Open · {open.length}</div>
      {open.map((m) => <Row key={m.id} m={m} />)}
      {open.length === 0 && <div className="px-3 py-3 text-[11px] text-[#5B6675]">No open markups.</div>}
      <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-[#5B6675] flex items-center gap-1.5 mt-2"><CheckCircle2 className="w-3 h-3 text-[#22C55E]" /> Resolved · {resolved.length}</div>
      {resolved.map((m) => <Row key={m.id} m={m} />)}
    </div>
  );
}

function VersionList({ vm }: { vm: DrawingViewerState }) {
  const { revisions, selectedRevisionId, selectRevision, caps } = vm;
  return (
    <div className="flex-1 overflow-y-auto">
      {!caps.canManageVersions && <div className="px-3 py-2 text-[10px] text-[#5B6675] bg-[#161C24]">Read-only — your role can view revisions but not manage them.</div>}
      {revisions.map((r) => {
        const active = r.id === selectedRevisionId;
        return (
          <button key={r.id} onClick={() => selectRevision(r.id)} className={`w-full text-left px-3 py-2.5 border-b border-[#222A35] hover:bg-[#161C24] ${active ? "bg-[#161C24]" : ""}`}>
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-white">Rev {r.rev}</span>
              {r.isLatest && <span className="text-[9px] px-1 py-0.5 rounded bg-[#22C55E]/15 text-[#22C55E]">Latest</span>}
              {active && <ChevronRight className="w-3.5 h-3.5 text-[#FF6B1A] ml-auto" />}
            </div>
            <div className="text-[10px] text-[#8A95A5] mt-0.5">{new Date(r.uploadedAt).toLocaleDateString()} · {r.uploadedBy} · {r.status} · {r.fileSize}</div>
            {r.changeNote && <div className="text-[10px] text-[#5B6675] mt-0.5 line-clamp-2">{r.changeNote}</div>}
          </button>
        );
      })}
      {revisions.length === 1 && <div className="px-3 py-3 text-[11px] text-[#5B6675]">This is the only revision. Upload a new version of this sheet from the project's Drawings folder or Plans & Drawings.</div>}
    </div>
  );
}

/* ─────────────────────────── Share dialog (+ QR) ─────────────────────────── */
function ShareDialog({ vm, onClose }: { vm: DrawingViewerState; onClose: () => void }) {
  const [link, setLink] = useState<string | null>(null);
  useEffect(() => { drawingService.createShareLink(vm.drawing!.id, vm.selectedRevision!.id).then((l) => setLink(l.url)); }, []);
  const copy = () => { if (link) navigator.clipboard?.writeText(link).then(() => toast.success("Link copied")).catch(() => toast.error("Couldn't copy. Select the link and copy it.")); };
  const message = link ? `${vm.drawing!.sheetNumber} ${vm.drawing!.title} (Rev ${vm.selectedRevision!.rev}): ${link}` : "";
  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-[440px] rounded-xl border border-[#222A35] bg-[#11161D]" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#222A35] flex items-center justify-between">
          <div className="text-[14px] text-white font-display flex items-center gap-2"><Share2 className="w-4 h-4 text-[#FF6B1A]" /> Share with your team</div>
          <button onClick={onClose} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-[12px] text-[#8A95A5]">Anyone on your Buildsasa team can open this exact sheet and revision. They'll be asked to sign in.</p>
          <div className="flex items-center gap-2">
            <input readOnly value={link || ""} onFocus={(e) => e.target.select()} className="flex-1 min-w-0 h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[11px] text-[#C2CAD6]" />
            <button onClick={copy} className="h-9 px-3 rounded-md border border-[#222A35] text-[11px] text-[#8A95A5] hover:text-white flex items-center gap-1.5"><Copy className="w-3.5 h-3.5" /> Copy</button>
          </div>
          <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer" className="h-10 rounded-md bg-[#25D366] text-white text-[12px] flex items-center justify-center gap-1.5"><MessageCircle className="w-4 h-4" /> Send on WhatsApp</a>
          {link && (
            <div className="flex flex-col items-center gap-2 pt-1">
              <div className="text-[10px] uppercase tracking-wider text-[#5B6675]">Scan to open on a site phone</div>
              <img src={qrImageUrl(link)} alt="QR code" className="w-40 h-40 rounded-md bg-white p-1.5" />
              <div className="text-[10px] text-[#5B6675]">{vm.drawing!.sheetNumber} · Rev {vm.selectedRevision!.rev}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Footer ─────────────────────────── */
function Footer({ vm }: { vm: DrawingViewerState }) {
  const d = vm.drawing!; const r = vm.selectedRevision!;
  return (
    <div className="shrink-0 px-4 py-2 border-t border-[#222A35] bg-[#11161D] flex items-center justify-between text-[11px] text-[#5B6675] gap-3">
      <div className="flex items-center gap-3 min-w-0">
        {vm.saveState === "saving"
          ? <span className="flex items-center gap-1 text-[#F5A623]"><CircleDot className="w-3 h-3 animate-pulse" /> Saving…</span>
          : <span className="flex items-center gap-1 text-[#22C55E]"><CheckCircle2 className="w-3 h-3" /> {vm.saveState === "saved" ? "All changes saved" : "Auto-saves"}</span>}
        <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> Updated {timeAgo(d.updatedAt)}</span>
                <span className="hidden sm:inline">Viewing Rev {r.rev}{r.isLatest ? " (latest)" : ""}</span>
      </div>
      <span className="hidden md:inline">drag to pan · ⌘/Ctrl + scroll or pinch to zoom</span>
    </div>
  );
}

// Helper so hosts can map an app role to a viewer role.
export function toViewerRole(canEdit: boolean, canComment: boolean): ViewerRole {
  if (canEdit) return "editor";
  if (canComment) return "commenter";
  return "viewer";
}
