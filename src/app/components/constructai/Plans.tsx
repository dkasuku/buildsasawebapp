// Plans module — drawings, markups & version history (backend-wired)
import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import api, { absoluteFileUrl } from "../../services/api";
import type { DrawingDto } from "../../services/api";
import { DrawingViewer, toViewerRole } from "./drawing-viewer";
import { FileStack, Search, Filter, Upload, Share2, Download, Eye, Clock, X, Check, MessageSquare, MapPin, Layers, Users as UsersIcon, ZoomIn, ZoomOut, Maximize2, PenTool, Circle, Type, Undo, History, Cloud, Box, ExternalLink } from "lucide-react";
import { ImageWithFallback } from "../figma/ImageWithFallback";
import { EmptyState } from "./EmptyState";
import type { Role } from "./roles";
import { ROLES } from "./roles";
import { useTeam } from "./useTeam";
import { warnSaveFailed } from "./saveFeedback";

type Drawing = {
  /** The sheet NUMBER (e.g. "A-101"). Markups and versions are correlated by
   *  this value, which is why it is not the database id. */
  id: string;
  /** The database row id — used for React keys and for delete/update calls.
   *  Sheet numbers are not unique (two files can derive the same one), so using
   *  `id` as the key made same-numbered sheets collide and disappear. */
  rowId: string;
  title: string;
  project: string;
  rev: number;
  discipline: string;
  updated: string;
  size: string;
  img: string;
  recipients: number;
  status: "Current" | "Draft" | "Superseded";
  fileUrl?: string;
  fileName?: string;
};

// Recipients come from the real invited team (useTeam below). This was a
// hardcoded roster of six invented people — Sarah Patel, Carlos Mendez and the
// rest — so "sharing" a drawing listed colleagues who do not exist and sent it
// nowhere. A stable colour per person keeps the avatars readable.
const AVATAR_COLORS = ["#F5A623", "#8B5CF6", "#3B82F6", "#A16207", "#06B6D4", "#22C55E", "#EF4444"];
const colorFor = (key: string) => AVATAR_COLORS[Array.from(key).reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];

const DISCIPLINES = ["All", "Architectural", "Mechanical", "Structural", "Electrical", "Civil"];
const UPLOAD_DISCIPLINES = ["Auto-detect", "Architectural", "Mechanical", "Structural", "Electrical", "Civil"];

const formatBytes = (b: number) => {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
};

// Thumbnail for a locally-picked file, before it is uploaded. Owns the blob URL
// for exactly as long as it is on screen.
function FilePreview({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  if (!url) return <div className="w-9 h-9 rounded bg-[#161C24] border border-[#222A35] shrink-0" />;
  return <img src={url} alt="" className="w-9 h-9 rounded object-cover border border-[#222A35] shrink-0" />;
}

const inferDiscipline = (name: string): string => {
  const n = name.toUpperCase();
  if (n.startsWith("A")) return "Architectural";
  if (n.startsWith("M")) return "Mechanical";
  if (n.startsWith("S")) return "Structural";
  if (n.startsWith("E")) return "Electrical";
  if (n.startsWith("C") || n.startsWith("L")) return "Civil";
  return "Architectural";
};

export function Plans({ role }: { role: Role }) {
  // The workspace's real invited teammates, for the share dialog.
  const team = useTeam();
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [q, setQ] = useState("");
  const [discipline, setDiscipline] = useState("All");
  const [shareOpen, setShareOpen] = useState<null | Drawing>(null);
  const [viewing, setViewing] = useState<null | Drawing>(null);
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  // Set from the real project list once it loads; see loadBoard below.
  const [uploadProject, setUploadProject] = useState("");
  const [uploadDiscipline, setUploadDiscipline] = useState("Auto-detect");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Sheet filters (the Filters button below).
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [projectFilter, setProjectFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<Drawing["status"][]>([]);
  const [latestRevOnly, setLatestRevOnly] = useState(false);

  // Markups & versions
  const [markups, setMarkups] = useState<{ id: string; drawingId: string; x: number; y: number; w?: number; h?: number; text: string; color: string; type: string }[]>([]);
  const [markupMode, setMarkupMode] = useState<"off" | "pin" | "text" | "box">("off");
  const [markupText, setMarkupText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<any>(null);
  const [showVersions, setShowVersions] = useState(false);
  // Starts empty and is filled from the backend when a sheet is opened. It used
  // to be seeded with four invented revisions of a sheet named "A-101", so every
  // real drawing appeared to have a version history that did not exist.
  const [drawingVersions, setDrawingVersions] = useState<{ drawingId: string; rev: number; url: string; date: string }[]>([]);

  const canShare = ROLES[role].sharePlans;

  // Resolve drawing project names to real backend project IDs so markups &
  // versions can persist. Falls back to local-only when no backend match exists.
  const [projectIds, setProjectIds] = useState<Record<string, string>>({});
  const [projectList, setProjectList] = useState<{ id: string; name: string }[]>([]);

  const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i;
  const SHEET_THUMB = "https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=800&q=80";
  // A stored row is the source of truth for a sheet; rebuild the card from it.
  const rowToDrawing = (r: DrawingDto): Drawing => ({
    id: r.number,
    rowId: r.id,
    title: r.title,
    project: r.project?.name || "",
    rev: r.rev,
    discipline: r.discipline,
    updated: r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "just now",
    size: r.fileSize ? formatBytes(r.fileSize) : "—",
    img: IMAGE_EXT.test(r.fileName || r.fileUrl || "") ? absoluteFileUrl(r.fileUrl) : SHEET_THUMB,
    recipients: 0,
    status: (r.status as Drawing["status"]) || "Draft",
    fileUrl: absoluteFileUrl(r.fileUrl),
    fileName: r.fileName || undefined,
  });

  // Load the real project list and every sheet already saved against it. The
  // board used to start empty and stay that way: uploads only ever went into
  // component state, so a reload lost them and the KPI always read zero.
  const loadBoard = async () => {
    try {
      const ps = await api.getProjects();
      const map: Record<string, string> = {};
      ps.forEach((p) => { map[p.name] = p.id; });
      setProjectIds(map);
      setProjectList(ps.map((p) => ({ id: p.id, name: p.name })));
    } catch { /* backend offline — markups stay local */ }
    try {
      setDrawings((await api.getDrawings()).map(rowToDrawing));
    } catch { /* leave the board empty rather than inventing rows */ }
  };
  useEffect(() => { loadBoard(); }, []);

  const resolvePid = (d: Drawing): string | null => projectIds[d.project] ?? null;
  // Real number of projects loaded from the backend (0 for a fresh workspace).
  const projectCount = Object.keys(projectIds).length;

  const activeFilterCount = (projectFilter ? 1 : 0) + statusFilter.length + (latestRevOnly ? 1 : 0);

  // Highest revision held for each sheet number, for the "latest revision only"
  // filter. Computed once per render rather than per row.
  const highestRevByNumber = drawings.reduce<Record<string, number>>((acc, d) => {
    acc[d.id] = Math.max(acc[d.id] ?? 0, d.rev);
    return acc;
  }, {});

  const filtered = drawings.filter((d) => {
    if (discipline !== "All" && d.discipline !== discipline) return false;
    if (q && !(d.title + d.id + d.project).toLowerCase().includes(q.toLowerCase())) return false;
    if (projectFilter && d.project !== projectFilter) return false;
    if (statusFilter.length && !statusFilter.includes(d.status)) return false;
    if (latestRevOnly && d.rev !== highestRevByNumber[d.id]) return false;
    return true;
  });

  const openShare = (d: Drawing) => {
    if (!canShare) {
      toast.error(`${role} role can't share drawings — ask a PM or Contractor`);
      return;
    }
    setSelected([]);
    setNote("");
    setShareOpen(d);
  };

  // Share a sheet by posting it to the project's message thread, with the note
  // and the recipients named. Previously this only raised a toast claiming the
  // drawing had been "sent" and a "push notification queued" — nothing was sent,
  // stored, or queued, so the recipients never heard about it.
  const [sharing, setSharing] = useState(false);
  const submitShare = async () => {
    if (!shareOpen) return;
    if (!selected.length) return toast.error("Pick at least one recipient");
    const pid = resolvePid(shareOpen);
    if (!pid) return toast.error("This drawing isn't linked to a project yet, so it can't be shared.");
    setSharing(true);
    try {
      const who = selected.join(", ");
      const body = [
        `📐 ${shareOpen.id} · ${shareOpen.title} (Rev ${shareOpen.rev}) shared with ${who}.`,
        note.trim(),
      ].filter(Boolean).join("\n\n");
      await api.createMessage(pid, body, shareOpen.fileUrl || undefined);
      toast.success(`${shareOpen.id} posted to ${shareOpen.project} for ${selected.length} recipient${selected.length === 1 ? "" : "s"}`);
      setShareOpen(null);
      setNote("");
    } catch (e: any) {
      toast.error(`Could not share ${shareOpen.id} — ${e?.message || "unknown error"}`, { duration: 8000 });
    } finally {
      setSharing(false);
    }
  };

  const openViewer = async (d: Drawing) => {
    setZoom(1);
    setMarkupMode("off");
    setShowVersions(false);
    setViewing(d);
    const pid = resolvePid(d);
    if (!pid) return;
    // Load any persisted markups & versions for this drawing from the backend
    try {
      const [ms, vs] = await Promise.all([api.getMarkups(pid), api.getDrawingVersions(pid)]);
      setMarkups((prev) => [
        ...prev.filter((m) => m.drawingId !== d.id),
        ...ms.filter((m) => m.drawingId === d.id).map((m) => ({
          id: m.id, drawingId: m.drawingId, x: m.x, y: m.y, text: m.text || "", color: m.color, type: m.type,
        })),
      ]);
      const dvs = vs.filter((v) => v.drawingId === d.id).map((v) => ({
        drawingId: v.drawingId, rev: v.rev, url: v.url, date: new Date(v.createdAt).toISOString().split("T")[0],
      }));
      if (dvs.length) setDrawingVersions((prev) => [...prev.filter((v) => v.drawingId !== d.id), ...dvs]);
    } catch { /* backend offline — keep local markups */ }
  };

  // Place a new markup where the user clicks the drawing. Pin = location marker,
  // Text = inline label, Box = an editable note placeholder that holds text/designs.
  const addMarkup = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!viewing || markupMode === "off") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    const type = markupMode;
    const isBox = type === "box";
    const text = type === "text" ? (markupText || "Note") : "";
    const localId = String(Date.now());
    const sized = isBox ? { w: 24, h: 16 } : {};
    setMarkups((prev) => [...prev, { id: localId, drawingId: viewing.id, x, y, ...sized, text, color: "#FF6B1A", type }]);
    setMarkupText("");
    setMarkupMode("off"); // one-shot: place then return to view mode
    if (isBox || type === "text") setEditingId(localId);
    toast.success(isBox ? "Note box added — click it to type" : "Markup added");
    const pid = resolvePid(viewing);
    if (pid) {
      api.createMarkup(pid, { drawingId: viewing.id, type, x, y, text, color: "#FF6B1A", createdBy: "demo-user" })
        .then((saved: any) => setMarkups((prev) => prev.map((m) => m.id === localId ? { ...m, id: saved.id } : m)))
        .catch(warnSaveFailed("markup creation"));
    }
  };

  // Drag a markup to reposition it (percentage coords relative to the canvas).
  const startDrag = (e: React.PointerEvent, m: { id: string; x: number; y: number }) => {
    if (editingId === m.id) return; // editing text — don't drag
    e.stopPropagation();
    dragRef.current = { id: m.id, startX: e.clientX, startY: e.clientY, origX: m.x, origY: m.y, curX: m.x, curY: m.y, moved: false };
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragEnd);
  };
  const onDragMove = (e: PointerEvent) => {
    const d = dragRef.current; const rect = canvasRef.current?.getBoundingClientRect();
    if (!d || !rect) return;
    const nx = Math.max(0, Math.min(100, d.origX + ((e.clientX - d.startX) / rect.width) * 100));
    const ny = Math.max(0, Math.min(100, d.origY + ((e.clientY - d.startY) / rect.height) * 100));
    d.moved = true; d.curX = nx; d.curY = ny;
    setMarkups((prev) => prev.map((m) => m.id === d.id ? { ...m, x: nx, y: ny } : m));
  };
  const onDragEnd = () => {
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragEnd);
    const d = dragRef.current; dragRef.current = null;
    if (d && d.moved && viewing) {
      const pid = resolvePid(viewing);
      if (pid) api.updateMarkup(pid, d.id, { x: d.curX, y: d.curY }).catch(warnSaveFailed("markup update"));
    }
  };

  const setMarkupTextValue = (id: string, text: string) => setMarkups((prev) => prev.map((m) => m.id === id ? { ...m, text } : m));
  const commitMarkupText = (id: string) => {
    setEditingId(null);
    if (!viewing) return;
    const m = markups.find((x) => x.id === id);
    const pid = resolvePid(viewing);
    if (pid && m) api.updateMarkup(pid, id, { text: m.text }).catch(warnSaveFailed("markup update"));
  };
  const removeMarkup = (id: string) => {
    setMarkups((prev) => prev.filter((m) => m.id !== id));
    if (!viewing) return;
    const pid = resolvePid(viewing);
    if (pid) api.deleteMarkup(pid, id).catch(warnSaveFailed("markup deletion"));
  };

  const clearMarkups = () => {
    if (!viewing) return;
    const pid = resolvePid(viewing);
    const toRemove = markups.filter((m) => m.drawingId === viewing.id);
    setMarkups((prev) => prev.filter((m) => m.drawingId !== viewing.id));
    if (pid) toRemove.forEach((m) => { api.deleteMarkup(pid, m.id).catch(warnSaveFailed("markup deletion")); });
  };

  const downloadDrawing = (d: Drawing) => {
    const a = document.createElement("a");
    if (d.fileUrl) {
      a.href = d.fileUrl;
      a.download = d.fileName || `${d.id}.pdf`;
    } else {
      a.href = d.img;
      a.download = `${d.id}-${d.title.replace(/[^\w]+/g, "_")}.jpg`;
      a.target = "_blank";
      a.rel = "noopener";
    }
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success(`${d.id} downloading`);
  };

  const triggerUpload = () => {
    if (!canShare) return toast.error(`${role} can't upload drawings`);
    if (!projectList.length) return toast.error("Create a project first — drawings are filed under one.");
    setPendingFiles([]);
    setUploadProject(projectList[0].id);
    setUploadDiscipline("Auto-detect");
    setUploadOpen(true);
  };

  const onPickFiles = (files: FileList | null) => {
    if (!files) return;
    setPendingFiles((prev) => [...prev, ...Array.from(files)]);
    if (fileRef.current) fileRef.current.value = "";
  };

  const removePending = (idx: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const commitUpload = async () => {
    if (!pendingFiles.length) return toast.error("Add at least one file");
    if (!uploadProject) return toast.error("Select a project");
    const projectName = projectList.find((p) => p.id === uploadProject)?.name || "project";
    setUploading(true);
    const toastId = toast.loading(`Uploading ${pendingFiles.length} file${pendingFiles.length === 1 ? "" : "s"} to ${projectName}…`);
    try {
      // Upload the bytes, then record the sheet against the project. Saving was
      // the missing half: uploads previously stopped at component state, so
      // every drawing vanished on reload.
      const saved: Drawing[] = [];
      for (let i = 0; i < pendingFiles.length; i++) {
        const f = pendingFiles[i];
        toast.loading(`Uploading ${f.name} (${i + 1}/${pendingFiles.length})…`, { id: toastId });
        const url = await api.uploadFile(f, (pct) => {
          toast.loading(`Uploading ${f.name} (${i + 1}/${pendingFiles.length}) — ${pct}%`, { id: toastId });
        });
        const base = f.name.replace(/\.[^.]+$/, "");
        const number = base.match(/^[A-Z]-\d+/i)?.[0]?.toUpperCase() ?? base.slice(0, 40);
        const row = await api.createDrawing(uploadProject, {
          number,
          title: base,
          discipline: uploadDiscipline === "Auto-detect" ? inferDiscipline(number) : uploadDiscipline,
          rev: 1,
          status: "Draft",
          fileUrl: url,
          fileName: f.name,
          fileSize: f.size,
        });
        saved.push(rowToDrawing(row));
      }
      setDrawings((arr) => [...saved, ...arr]);
      toast.success(`Saved ${saved.length} drawing${saved.length === 1 ? "" : "s"} to ${projectName}`, { id: toastId });
      setPendingFiles([]);
      setUploadOpen(false);
    } catch (e: any) {
      toast.error(`Upload failed — ${e?.message || "unknown error"}`, { id: toastId, duration: 10000 });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="px-4 sm:px-6 lg:px-7 py-4 sm:py-5 lg:py-6 space-y-4 sm:space-y-5">
      {/* hidden file input */}
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/*,application/pdf,.dwg,.dxf,.rvt"
        className="hidden"
        onChange={(e) => onPickFiles(e.target.files)}
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[
          { i: FileStack, l: "Active drawings", v: String(drawings.length), s: `across ${projectCount} project${projectCount === 1 ? "" : "s"}` },
          { i: Layers, l: "Disciplines", v: String(DISCIPLINES.length - 1), s: "Arch · Mech · Struct · Elec · Civ" },
          { i: UsersIcon, l: "Field recipients", v: "0", s: "synced in last 24h" },
          { i: Clock, l: "Avg. distribution", v: "—", s: "from publish → field" },
        ].map((k) => (
          <div key={k.l} className="rounded-xl border border-[#222A35] bg-[#11161D] p-3 sm:p-4">
            <div className="w-8 h-8 rounded-md bg-[#FF6B1A]/15 text-[#FF6B1A] flex items-center justify-center"><k.i className="w-4 h-4" /></div>
            <div className="text-[18px] sm:text-[22px] text-white mt-2 sm:mt-3 font-display">{k.v}</div>
            <div className="text-[11px] text-[#8A95A5]">{k.l}</div>
            <div className="text-[10px] text-[#5B6675] mt-1.5 pt-2 border-t border-[#222A35] line-clamp-1">{k.s}</div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5B6675]" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search drawing number, title, or project…"
              className="w-full h-10 bg-[#11161D] border border-[#222A35] rounded-md pl-10 pr-3 text-[13px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]"
            />
          </div>
          <div className="flex gap-2">
            {/* A real filter panel. This button used to show a toast naming the
                filters it would have offered and change nothing. */}
            <div className="relative flex-1 sm:flex-none" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => setFiltersOpen((o) => !o)}
                className={`h-10 px-3 w-full rounded-md border text-[12px] flex items-center gap-1.5 justify-center ${activeFilterCount ? "border-[#FF6B1A]/60 text-white" : "border-[#222A35] text-[#8A95A5] hover:text-white"}`}
              >
                <Filter className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Filters</span>
                {activeFilterCount > 0 && <span className="rounded-full bg-[#FF6B1A] text-white text-[10px] px-1.5">{activeFilterCount}</span>}
              </button>
              {filtersOpen && (
                <div className="absolute right-0 mt-2 w-72 rounded-xl border border-[#222A35] bg-[#0A0E14] shadow-2xl z-30 overflow-hidden">
                  <div className="px-4 pt-3 pb-2 text-[10px] uppercase tracking-wider text-[#5B6675]">Project</div>
                  <div className="px-4 pb-3">
                    <select
                      value={projectFilter}
                      onChange={(e) => setProjectFilter(e.target.value)}
                      className="w-full h-9 bg-[#11161D] border border-[#222A35] rounded-md px-2 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]"
                    >
                      <option value="">All projects</option>
                      {projectList.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                    </select>
                  </div>
                  <div className="border-t border-[#222A35] px-4 pt-3 pb-2 text-[10px] uppercase tracking-wider text-[#5B6675]">Status</div>
                  <div className="px-4 pb-3 grid grid-cols-3 gap-2">
                    {(["Current", "Draft", "Superseded"] as const).map((s) => (
                      <label key={s} className="flex items-center gap-1.5 text-[11px] text-[#E6EAF0]">
                        <input
                          type="checkbox"
                          checked={statusFilter.includes(s)}
                          onChange={() => setStatusFilter((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s])}
                          className="h-3.5 w-3.5 accent-[#FF6B1A]"
                        />
                        {s}
                      </label>
                    ))}
                  </div>
                  <div className="border-t border-[#222A35] px-4 pt-3 pb-3">
                    <label className="flex items-center gap-2 text-[11px] text-[#E6EAF0]">
                      <input type="checkbox" checked={latestRevOnly} onChange={(e) => setLatestRevOnly(e.target.checked)} className="h-3.5 w-3.5 accent-[#FF6B1A]" />
                      Latest revision of each sheet only
                    </label>
                  </div>
                  <div className="border-t border-[#222A35] px-4 py-3 flex items-center justify-between">
                    <button
                      onClick={() => { setProjectFilter(""); setStatusFilter([]); setLatestRevOnly(false); }}
                      className="text-[11px] text-[#8A95A5] hover:text-white"
                    >
                      Clear filters
                    </button>
                    <button onClick={() => setFiltersOpen(false)} className="text-[11px] text-[#FF6B1A] hover:underline">Done</button>
                  </div>
                </div>
              )}
            </div>
            {canShare && (
              <button
                onClick={triggerUpload}
                className="h-10 px-3 rounded-md text-[12px] flex items-center gap-1.5 flex-1 sm:flex-none justify-center bg-[#FF6B1A] text-white hover:bg-[#FF7E33]"
              >
                <Upload className="w-3.5 h-3.5" /> Upload
              </button>
            )}
          </div>
        </div>
        <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1">
          {DISCIPLINES.map((d) => (
            <button
              key={d}
              onClick={() => setDiscipline(d)}
              className={`px-3 h-9 rounded-md text-[12px] whitespace-nowrap shrink-0 ${discipline === d ? "bg-[#FF6B1A]/15 text-[#FF6B1A] border border-[#FF6B1A]/30" : "bg-[#11161D] border border-[#222A35] text-[#8A95A5] hover:text-white"}`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {/* Drawings grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
        {filtered.map((d) => (
          <div key={d.rowId || d.id} className="rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden hover:border-[#FF6B1A]/40 transition group flex flex-col">
            <button
              onClick={() => openViewer(d)}
              className="relative h-[140px] sm:h-[160px] overflow-hidden bg-[#0A0E14] text-left"
            >
              <ImageWithFallback src={d.img} alt={d.title} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition" />
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
              <span className={`absolute top-3 left-3 px-2 py-0.5 rounded-full text-[10px] border ${
                d.status === "Current" ? "bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/30" :
                d.status === "Draft" ? "bg-[#3B82F6]/15 text-[#3B82F6] border-[#3B82F6]/30" :
                "bg-[#5B6675]/15 text-[#5B6675] border-[#5B6675]/30"
              }`}>{d.status}</span>
              <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full text-[10px] bg-[#FF6B1A]/15 text-[#FF6B1A] border border-[#FF6B1A]/30">Rev {d.rev}</span>
              <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 to-transparent">
                <div className="text-[10px] text-white font-mono truncate" style={{ color: '#ffffff', textShadow: '0 1px 3px rgba(0,0,0,1)' }}>{d.id} · {d.discipline}</div>
                <div className="text-[13px] sm:text-[14px] text-white font-display truncate" style={{ color: '#ffffff', textShadow: '0 2px 4px rgba(0,0,0,1)' }}>{d.title}</div>
              </div>
            </button>
            <div className="p-3 sm:p-4 flex-1 flex flex-col">
              <div className="flex items-center gap-3 text-[11px] text-[#8A95A5] flex-wrap">
                <span className="flex items-center gap-1 truncate"><MapPin className="w-3 h-3 shrink-0" />{d.project}</span>
                <span className="flex items-center gap-1 shrink-0"><Clock className="w-3 h-3" />{d.updated}</span>
              </div>
              <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-[#222A35] flex-wrap">
                <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] text-[#5B6675] min-w-0">
                  <UsersIcon className="w-3 h-3 shrink-0" /> <span className="truncate">{d.recipients} · {d.size}</span>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button title="View" onClick={() => openViewer(d)} className="h-8 w-8 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white hover:border-[#FF6B1A]/40 flex items-center justify-center"><Eye className="w-3.5 h-3.5" /></button>
                  <button title="Download" onClick={() => downloadDrawing(d)} className="h-8 w-8 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white hover:border-[#FF6B1A]/40 flex items-center justify-center"><Download className="w-3.5 h-3.5" /></button>
                  {canShare && (
                    <button
                      title="Share"
                      onClick={() => openShare(d)}
                      className="h-8 px-2 sm:px-3 rounded-md text-[11px] flex items-center gap-1 sm:gap-1.5 bg-[#FF6B1A]/15 text-[#FF6B1A] border border-[#FF6B1A]/30 hover:bg-[#FF6B1A]/25"
                    >
                      <Share2 className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Share</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        // Distinguish "you have no drawings" from "your filters hide them all".
        // A single "No drawings match" message for both made a fresh workspace
        // look like a filtering problem, and a filtered-out board look empty.
        drawings.length === 0 ? (
          <EmptyState
            icon={FileStack}
            title="No drawings uploaded yet"
            description={canShare
              ? "Upload your architectural, structural or MEP sheets — PDFs, images and CAD files are all accepted."
              : "No sheets have been published to this workspace yet."}
            actionLabel={canShare ? "Upload drawings" : undefined}
            onAction={canShare ? triggerUpload : undefined}
          />
        ) : (
          <EmptyState
            icon={FileStack}
            title="No drawings match your filters"
            description={`${drawings.length} drawing${drawings.length === 1 ? "" : "s"} on the board are hidden by the current search or filters.`}
            actionLabel="Clear filters"
            onAction={() => { setQ(""); setDiscipline("All"); setProjectFilter(""); setStatusFilter([]); setLatestRevOnly(false); }}
          />
        )
      )}

      {/* New full-featured drawing viewer (Procore-style, original implementation) */}
      {viewing && (
        <DrawingViewer
          seed={{
            id: viewing.id,
            sheetNumber: viewing.id,
            title: viewing.title,
            projectName: viewing.project,
            discipline: viewing.discipline,
            fileUrl: viewing.fileUrl || viewing.img,
            fileType: (viewing.fileUrl || "").toLowerCase().endsWith(".pdf") ? "pdf" : "image",
            fileSize: viewing.size,
            status: viewing.status === "Draft" ? "draft" : "published",
            rev: viewing.rev,
            recipients: viewing.recipients,
          }}
          role={toViewerRole(canShare, true)}
          appRole={role}
          onClose={() => setViewing(null)}
        />
      )}

      {/* The legacy inline viewer that used to live here was dead code behind
          `{false && …}` — superseded by DrawingViewer above. It was removed: it
          could never render, yet it still had to compile, and its 15 type errors
          masked real ones in this file. */}

      {/* Upload modal */}
      {uploadOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setUploadOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-[560px] bg-[#11161D] border border-[#222A35] rounded-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
            <div className="p-5 border-b border-[#222A35] flex items-center justify-between">
              <div>
                <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">Upload drawings</div>
                <div className="text-[15px] text-white font-display">Pick a project & add files</div>
                <div className="text-[11px] text-[#8A95A5] mt-0.5">Drawings always belong to a project — no limit on how many you can upload at once.</div>
              </div>
              <button onClick={() => setUploadOpen(false)} className="text-[#8A95A5] hover:text-white shrink-0"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-[#8A95A5] block mb-1">Project *</label>
                  <select value={uploadProject} onChange={(e) => setUploadProject(e.target.value)} className="w-full h-9 px-3 rounded-md bg-[#0A0E14] border border-[#222A35] text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]">
                    {projectList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-[#8A95A5] block mb-1">Discipline</label>
                  <select value={uploadDiscipline} onChange={(e) => setUploadDiscipline(e.target.value)} className="w-full h-9 px-3 rounded-md bg-[#0A0E14] border border-[#222A35] text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]">
                    {UPLOAD_DISCIPLINES.map((d) => <option key={d}>{d}</option>)}
                  </select>
                </div>
              </div>

              {/* The dashed border reads as a drop target, so it has to behave
                  like one — dropping files here previously did nothing at all. */}
              <button
                onClick={() => fileRef.current?.click()}
                onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); onPickFiles(e.dataTransfer.files); }}
                className={`w-full rounded-xl border border-dashed transition p-6 flex flex-col items-center justify-center gap-2 text-center ${dragOver ? "border-[#FF6B1A] bg-[#FF6B1A]/10" : "border-[#2C3744] bg-[#0A0E14] hover:border-[#FF6B1A]/50 hover:bg-[#FF6B1A]/5"}`}
              >
                <Upload className="w-5 h-5 text-[#FF6B1A]" />
                <div className="text-[13px] text-white">{dragOver ? "Drop to add" : "Click to add files, or drag them here"}</div>
                <div className="text-[11px] text-[#5B6675]">PDF · DWG · DXF · RVT · images — upload as many as you want</div>
              </button>

              {pendingFiles.length > 0 && (
                <div>
                  <div className="text-[10px] text-[#5B6675] uppercase tracking-wider mb-2">{pendingFiles.length} file{pendingFiles.length === 1 ? "" : "s"} ready</div>
                  <div className="space-y-1.5 max-h-[220px] overflow-y-auto">
                    {pendingFiles.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 p-2 rounded-md bg-[#0A0E14] border border-[#222A35]">
                        {/* Images preview straight from the local File, so you can
                            confirm you picked the right sheet before it uploads.
                            FilePreview owns the blob URL: creating it inline in
                            render minted a new one on every re-render (a leak),
                            and revoking it in onLoad meant the thumbnail vanished
                            the moment the browser had to repaint it. */}
                        {f.type.startsWith("image/")
                          ? <FilePreview file={f} />
                          : <FileStack className="w-3.5 h-3.5 text-[#8A95A5] shrink-0" />}
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] text-white truncate">{f.name}</div>
                          <div className="text-[10px] text-[#5B6675]">{formatBytes(f.size)}</div>
                        </div>
                        <button onClick={() => removePending(i)} className="text-[#5B6675] hover:text-[#EF4444] shrink-0"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="p-5 border-t border-[#222A35] flex gap-2">
              <button onClick={() => setUploadOpen(false)} className="flex-1 h-10 rounded-md border border-[#222A35] text-[12px] text-white hover:bg-[#161C24]">Cancel</button>
              {/* Deliberately not `disabled`: a dead button explains nothing, and
                  someone who clicks it reads that as "uploading is broken".
                  commitUpload already says what is missing. */}
              <button
                onClick={commitUpload}
                className={`flex-1 h-10 rounded-md text-[12px] flex items-center justify-center gap-2 ${uploading ? "bg-[#FF6B1A]/60 text-white cursor-wait" : pendingFiles.length ? "bg-[#FF6B1A] text-white shadow-[0_4px_14px_rgba(255,107,26,0.35)] hover:bg-[#FF7E33]" : "bg-[#222A35] text-[#8A95A5] hover:bg-[#2A3441]"}`}
              >
                <Upload className="w-4 h-4" />
                {uploading
                  ? "Uploading…"
                  : `Upload ${pendingFiles.length || ""} to ${(projectList.find((p) => p.id === uploadProject)?.name || "project").split(" ")[0]}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share modal */}
      {shareOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setShareOpen(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-[520px] bg-[#11161D] border border-[#222A35] rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-5 border-b border-[#222A35] flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">Share drawing</div>
                <div className="text-[15px] text-white font-display truncate">{shareOpen.id} · {shareOpen.title}</div>
                <div className="text-[11px] text-[#8A95A5]">{shareOpen.project} · Rev {shareOpen.rev}</div>
              </div>
              <button onClick={() => setShareOpen(null)} className="text-[#8A95A5] hover:text-white shrink-0"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 overflow-y-auto flex-1">
              <div className="text-[10px] text-[#5B6675] uppercase tracking-wider mb-2">Recipients · your team</div>
              {team.length === 0 && (
                <div className="text-[11.5px] text-[#5B6675] rounded-md border border-[#222A35] bg-[#0A0E14] p-3">
                  No teammates yet — invite people on the Team page and they will appear here.
                </div>
              )}
              <div className="space-y-1.5">
                {team.map((w) => {
                  const on = selected.includes(w.name);
                  return (
                    <button
                      key={w.id}
                      onClick={() => setSelected(on ? selected.filter((n) => n !== w.name) : [...selected, w.name])}
                      className={`w-full flex items-center gap-3 p-2.5 rounded-md border transition ${on ? "bg-[#FF6B1A]/8 border-[#FF6B1A]/40" : "bg-[#0A0E14] border-[#222A35] hover:border-[#2C3744]"}`}
                    >
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px]" style={{ background: colorFor(w.id) }}>{w.initials || w.name.split(" ").map((x) => x[0]).join("")}</div>
                      <div className="flex-1 text-left min-w-0">
                        <div className="text-[12px] text-white truncate">{w.name}</div>
                        <div className="text-[10px] text-[#5B6675] truncate">{w.role}</div>
                      </div>
                      <div className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${on ? "bg-[#FF6B1A] border-[#FF6B1A]" : "border-[#222A35]"}`}>
                        {on && <Check className="w-3 h-3 text-white" />}
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="mt-4">
                <div className="text-[10px] text-[#5B6675] uppercase tracking-wider mb-1.5">Message (optional)</div>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Heads up — new revision for the east wing rough-in tomorrow…"
                  className="w-full h-20 bg-[#0A0E14] border border-[#222A35] rounded-md p-3 text-[12px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A] resize-none"
                />
              </div>
              <div className="mt-3 flex items-center gap-2 text-[11px] text-[#8A95A5]">
                <MessageSquare className="w-3.5 h-3.5" /> Posts the sheet to this project's message thread, where the named recipients can open it
              </div>
            </div>
            <div className="p-5 border-t border-[#222A35] flex gap-2">
              <button onClick={() => setShareOpen(null)} className="flex-1 h-10 rounded-md border border-[#222A35] text-[12px] text-white hover:bg-[#161C24]">Cancel</button>
              <button onClick={submitShare} disabled={sharing} className="flex-1 h-10 rounded-md bg-[#FF6B1A] disabled:opacity-60 text-white text-[12px] flex items-center justify-center gap-2 shadow-[0_4px_14px_rgba(255,107,26,0.35)]">
                <Share2 className="w-4 h-4" /> {sharing ? "Sharing…" : `Send to ${selected.length}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
