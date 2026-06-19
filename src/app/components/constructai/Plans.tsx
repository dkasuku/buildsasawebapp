// Plans module — drawings, markups & version history (backend-wired)
import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import api from "../../services/api";
import { DrawingViewer, toViewerRole } from "./drawing-viewer";
import { FileStack, Search, Filter, Upload, Share2, Download, Eye, Clock, X, Check, MessageSquare, MapPin, Layers, Users as UsersIcon, ZoomIn, ZoomOut, Maximize2, PenTool, Circle, Type, Undo, History, Cloud, Box, ExternalLink } from "lucide-react";
import { ImageWithFallback } from "../figma/ImageWithFallback";
import type { Role } from "./roles";
import { ROLES } from "./roles";

type Drawing = {
  id: string;
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

const INITIAL: Drawing[] = [
  { id: "A-101", title: "Floor Plan · Level 14", project: "Harborfront Tower", rev: 4, discipline: "Architectural", updated: "2h ago", size: "4.2 MB", img: "https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=800&q=80", recipients: 12, status: "Current" },
  { id: "M-401", title: "Mechanical Plan · East Wing", project: "Harborfront Tower", rev: 4, discipline: "Mechanical", updated: "12h ago", size: "6.8 MB", img: "https://images.unsplash.com/photo-1581094794329-c8112a89af12?w=800&q=80", recipients: 8, status: "Current" },
  { id: "S-201", title: "Structural · Beam Schedule", project: "Midtown Medical", rev: 2, discipline: "Structural", updated: "1d ago", size: "2.1 MB", img: "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=800&q=80", recipients: 6, status: "Current" },
  { id: "E-301", title: "Electrical · Panel Schedule", project: "Riverside Plaza", rev: 7, discipline: "Electrical", updated: "3d ago", size: "1.4 MB", img: "https://images.unsplash.com/photo-1486325212027-8081e485255e?w=800&q=80", recipients: 4, status: "Superseded" },
  { id: "C-110", title: "Civil · Site Drainage", project: "Sunset Logistics", rev: 3, discipline: "Civil", updated: "5d ago", size: "8.9 MB", img: "https://images.unsplash.com/photo-1531834685032-c34bf0d84c77?w=800&q=80", recipients: 9, status: "Current" },
  { id: "A-204", title: "Sections · Building Envelope", project: "Cedar Heights", rev: 1, discipline: "Architectural", updated: "1w ago", size: "5.5 MB", img: "https://images.unsplash.com/photo-1448630360428-65456885c650?w=800&q=80", recipients: 3, status: "Draft" },
];

const workers = [
  { n: "Sarah Patel", r: "Superintendent · General", c: "#F5A623", on: true },
  { n: "Liam Park", r: "Worker · Painting", c: "#8B5CF6", on: true },
  { n: "Carlos Mendez", r: "Trade Lead · Plumbing", c: "#3B82F6", on: false },
  { n: "Jin Kowalski", r: "Trade Lead · Carpentry", c: "#A16207", on: false },
  { n: "Yuki Tanaka", r: "Trade Lead · HVAC", c: "#06B6D4", on: false },
  { n: "Adaora Eze", r: "Trade Lead · Electrical", c: "#F5A623", on: false },
];

const DISCIPLINES = ["All", "Architectural", "Mechanical", "Structural", "Electrical", "Civil"];
const UPLOAD_DISCIPLINES = ["Auto-detect", "Architectural", "Mechanical", "Structural", "Electrical", "Civil"];
const PROJECT_OPTIONS = ["Harborfront Tower", "Midtown Medical", "Riverside Plaza", "Sunset Logistics", "Cedar Heights", "Crescent Bay Marina"];

const formatBytes = (b: number) => {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
};

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
  const [drawings, setDrawings] = useState<Drawing[]>(INITIAL);
  const [q, setQ] = useState("");
  const [discipline, setDiscipline] = useState("All");
  const [shareOpen, setShareOpen] = useState<null | Drawing>(null);
  const [viewing, setViewing] = useState<null | Drawing>(null);
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadProject, setUploadProject] = useState(PROJECT_OPTIONS[0]);
  const [uploadDiscipline, setUploadDiscipline] = useState("Auto-detect");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  // Markups & versions
  const [markups, setMarkups] = useState<{ id: string; drawingId: string; x: number; y: number; w?: number; h?: number; text: string; color: string; type: string }[]>([]);
  const [markupMode, setMarkupMode] = useState<"off" | "pin" | "text" | "box">("off");
  const [markupText, setMarkupText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<any>(null);
  const [showVersions, setShowVersions] = useState(false);
  const [drawingVersions, setDrawingVersions] = useState<{ drawingId: string; rev: number; url: string; date: string }[]>([
    { drawingId: "A-101", rev: 1, url: "", date: "2024-01-10" },
    { drawingId: "A-101", rev: 2, url: "", date: "2024-02-14" },
    { drawingId: "A-101", rev: 3, url: "", date: "2024-03-20" },
    { drawingId: "A-101", rev: 4, url: "", date: "2024-04-05" },
  ]);

  const canShare = ROLES[role].sharePlans;

  // Resolve mock drawing project names to real backend project IDs so markups &
  // versions can persist. Falls back to local-only when no backend match exists.
  const [projectIds, setProjectIds] = useState<Record<string, string>>({});
  useEffect(() => {
    (async () => {
      try {
        const ps = await api.getProjects();
        const map: Record<string, string> = {};
        ps.forEach((p) => { map[p.name] = p.id; });
        setProjectIds(map);
      } catch { /* backend offline — markups stay local */ }
    })();
  }, []);
  const resolvePid = (d: Drawing): string | null => projectIds[d.project] ?? null;

  const filtered = drawings.filter((d) => {
    if (discipline !== "All" && d.discipline !== discipline) return false;
    if (q && !(d.title + d.id + d.project).toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const openShare = (d: Drawing) => {
    if (!canShare) {
      toast.error(`${role} role can't share drawings — ask a PM or Contractor`);
      return;
    }
    setSelected(workers.filter((w) => w.on).map((w) => w.n));
    setNote("");
    setShareOpen(d);
  };

  const submitShare = () => {
    if (!selected.length) return toast.error("Pick at least one recipient");
    toast.success(`${shareOpen!.id} sent to ${selected.length} recipient(s) · push notification queued`);
    setShareOpen(null);
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
        .catch(() => { /* backend offline — keep local markup */ });
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
      if (pid) api.updateMarkup(pid, d.id, { x: d.curX, y: d.curY }).catch(() => {});
    }
  };

  const setMarkupTextValue = (id: string, text: string) => setMarkups((prev) => prev.map((m) => m.id === id ? { ...m, text } : m));
  const commitMarkupText = (id: string) => {
    setEditingId(null);
    if (!viewing) return;
    const m = markups.find((x) => x.id === id);
    const pid = resolvePid(viewing);
    if (pid && m) api.updateMarkup(pid, id, { text: m.text }).catch(() => {});
  };
  const removeMarkup = (id: string) => {
    setMarkups((prev) => prev.filter((m) => m.id !== id));
    if (!viewing) return;
    const pid = resolvePid(viewing);
    if (pid) api.deleteMarkup(pid, id).catch(() => {});
  };

  const clearMarkups = () => {
    if (!viewing) return;
    const pid = resolvePid(viewing);
    const toRemove = markups.filter((m) => m.drawingId === viewing.id);
    setMarkups((prev) => prev.filter((m) => m.drawingId !== viewing.id));
    if (pid) toRemove.forEach((m) => { api.deleteMarkup(pid, m.id).catch(() => {}); });
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
    setPendingFiles([]);
    setUploadProject(PROJECT_OPTIONS[0]);
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
    toast.info(`Uploading ${pendingFiles.length} file${pendingFiles.length === 1 ? "" : "s"}…`);
    let uploaded: string[];
    try { uploaded = await Promise.all(pendingFiles.map((f) => api.uploadFile(f))); }
    catch { return toast.error("Upload failed"); }
    const added: Drawing[] = pendingFiles.map((f, i) => {
      const base = f.name.replace(/\.[^.]+$/, "");
      const id = base.match(/^[A-Z]-\d+/i)?.[0]?.toUpperCase() ?? `X-${1000 + drawings.length + i}`;
      const url = uploaded[i];
      return {
        id,
        title: base,
        project: uploadProject,
        rev: 1,
        discipline: uploadDiscipline === "Auto-detect" ? inferDiscipline(id) : uploadDiscipline,
        updated: "just now",
        size: formatBytes(f.size),
        img: f.type.startsWith("image/") ? url : "https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=800&q=80",
        recipients: 0,
        status: "Draft" as const,
        fileUrl: url,
        fileName: f.name,
      };
    });
    setDrawings((arr) => [...added, ...arr]);
    toast.success(`Uploaded ${added.length} drawing${added.length === 1 ? "" : "s"} to ${uploadProject} · status: Draft`);
    setPendingFiles([]);
    setUploadOpen(false);
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
          { i: FileStack, l: "Active drawings", v: String(drawings.length), s: "across 12 projects" },
          { i: Layers, l: "Disciplines", v: "6", s: "Arch · Mech · Struct · Elec · Civ · FP" },
          { i: UsersIcon, l: "Field recipients", v: "47", s: "synced in last 24h" },
          { i: Clock, l: "Avg. distribution", v: "1.2m", s: "from publish → field" },
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
            <button onClick={() => toast("Filters · trade, project, revision")} className="h-10 px-3 rounded-md border border-[#222A35] text-[12px] text-[#8A95A5] hover:text-white flex items-center gap-1.5 flex-1 sm:flex-none justify-center">
              <Filter className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Filters</span>
            </button>
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
          <div key={d.id} className="rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden hover:border-[#FF6B1A]/40 transition group flex flex-col">
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
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] py-16 text-center">
          <FileStack className="w-8 h-8 text-[#5B6675] mx-auto" />
          <div className="text-[14px] text-white mt-3 font-display">No drawings match</div>
          <div className="text-[12px] text-[#8A95A5] mt-1">Try clearing filters or search</div>
        </div>
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

      {/* Legacy inline viewer — superseded by DrawingViewer above, kept disabled for reference */}
      {false && viewing && (
        <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-2 sm:p-4" onClick={() => setViewing(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-[1100px] h-full max-h-[92vh] bg-[#0A0E14] border border-[#222A35] rounded-xl overflow-hidden flex flex-col">
            <div className="p-3 sm:p-4 border-b border-[#222A35] flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] text-[#5B6675] uppercase tracking-wider font-mono">{viewing.id} · Rev {viewing.rev} · {viewing.status}</div>
                <div className="text-[13px] sm:text-[15px] text-white font-display truncate">{viewing.title}</div>
                <div className="text-[11px] text-[#8A95A5] truncate">{viewing.project} · {viewing.discipline} · {viewing.size}</div>
              </div>
              <div className="flex items-center gap-1 sm:gap-2 shrink-0 flex-wrap">
                {/* Markup tools */}
                <button onClick={() => setMarkupMode(markupMode === "pin" ? "off" : "pin")} className={`h-9 px-2 rounded-md border text-[11px] flex items-center gap-1 ${markupMode === "pin" ? "bg-[#FF6B1A]/15 border-[#FF6B1A]/40 text-[#FF6B1A]" : "border-[#222A35] text-[#8A95A5] hover:text-white"}`}><PenTool className="w-3.5 h-3.5" /> Pin</button>
                <button onClick={() => setMarkupMode(markupMode === "text" ? "off" : "text")} className={`h-9 px-2 rounded-md border text-[11px] flex items-center gap-1 ${markupMode === "text" ? "bg-[#FF6B1A]/15 border-[#FF6B1A]/40 text-[#FF6B1A]" : "border-[#222A35] text-[#8A95A5] hover:text-white"}`}><Type className="w-3.5 h-3.5" /> Text</button>
                <button onClick={() => setMarkupMode(markupMode === "box" ? "off" : "box")} className={`h-9 px-2 rounded-md border text-[11px] flex items-center gap-1 ${markupMode === "box" ? "bg-[#FF6B1A]/15 border-[#FF6B1A]/40 text-[#FF6B1A]" : "border-[#222A35] text-[#8A95A5] hover:text-white"}`} title="Add an editable note box / placeholder"><Box className="w-3.5 h-3.5" /> Note Box</button>
                <button onClick={clearMarkups} className="h-9 px-2 rounded-md border border-[#222A35] text-[11px] text-[#8A95A5] hover:text-white flex items-center gap-1"><Undo className="w-3.5 h-3.5" /> Clear</button>
                <button onClick={() => setShowVersions((s) => !s)} className={`h-9 px-2 rounded-md border text-[11px] flex items-center gap-1 ${showVersions ? "bg-[#3B82F6]/15 border-[#3B82F6]/40 text-[#3B82F6]" : "border-[#222A35] text-[#8A95A5] hover:text-white"}`}><History className="w-3.5 h-3.5" /> Versions</button>
                <div className="w-px h-6 bg-[#222A35] mx-1 hidden sm:block" />
                <button onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} className="h-9 w-9 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white flex items-center justify-center"><ZoomOut className="w-4 h-4" /></button>
                <span className="text-[11px] text-[#8A95A5] w-10 text-center">{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom((z) => Math.min(3, z + 0.25))} className="h-9 w-9 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white flex items-center justify-center"><ZoomIn className="w-4 h-4" /></button>
                <button onClick={() => downloadDrawing(viewing)} className="h-9 px-2 sm:px-3 rounded-md border border-[#222A35] text-[12px] text-[#8A95A5] hover:text-white flex items-center gap-1.5"><Download className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Download</span></button>
                <button onClick={() => { const d = viewing; setViewing(null); openShare(d); }} className={`h-9 px-2 sm:px-3 rounded-md text-[12px] flex items-center gap-1.5 ${canShare ? "bg-[#FF6B1A] text-white" : "bg-[#222A35] text-[#5B6675]"}`}><Share2 className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Share</span></button>
                <button onClick={() => setViewing(null)} className="h-9 w-9 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white flex items-center justify-center"><X className="w-4 h-4" /></button>
              </div>
            </div>
            {markupMode === "text" && (
              <div className="px-3 py-2 border-b border-[#222A35] flex gap-2 items-center">
                <span className="text-[11px] text-[#8A95A5]">Text:</span>
                <input value={markupText} onChange={(e) => setMarkupText(e.target.value)} placeholder="Click on drawing to place text" className="flex-1 h-8 bg-[#0A0E14] border border-[#222A35] rounded px-2 text-[12px] text-white" />
              </div>
            )}
            {(markupMode === "box" || markupMode === "pin") && (
              <div className="px-3 py-2 border-b border-[#222A35] text-[11px] text-[#FF6B1A]">
                {markupMode === "box" ? "Click anywhere on the drawing to drop an editable note box — then click it to type designs, specs, or placeholders. Drag to move." : "Click on the drawing to drop a location pin. Drag any markup to reposition it."}
              </div>
            )}
            <div className="flex-1 flex overflow-hidden">
              <div ref={canvasRef} className={`flex-1 overflow-auto bg-[#050709] flex items-center justify-center p-3 sm:p-6 relative ${markupMode !== "off" ? "cursor-crosshair" : ""}`} onClick={addMarkup}>
                <ImageWithFallback
                  src={viewing.img}
                  alt={viewing.title}
                  className="max-w-none transition-transform select-none"
                  style={{ transform: `scale(${zoom})`, transformOrigin: "center" }}
                  draggable={false}
                />
                {/* Editable markup / annotation layer */}
                {markups.filter((m) => m.drawingId === viewing.id).map((m) => {
                  if (m.type === "box") {
                    return (
                      <div
                        key={m.id}
                        onPointerDown={(e) => startDrag(e, m)}
                        onClick={(e) => e.stopPropagation()}
                        className="absolute group rounded-md border-2 bg-black/55 backdrop-blur-sm shadow-lg cursor-move resize overflow-auto"
                        style={{ left: `${m.x}%`, top: `${m.y}%`, width: `${m.w ?? 24}%`, height: `${m.h ?? 16}%`, transform: "translate(-50%, -50%)", borderColor: m.color }}
                      >
                        <button onClick={(e) => { e.stopPropagation(); removeMarkup(m.id); }} className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-[#EF4444] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 z-10"><X className="w-3 h-3" /></button>
                        {editingId === m.id ? (
                          <textarea
                            autoFocus
                            value={m.text}
                            onChange={(e) => setMarkupTextValue(m.id, e.target.value)}
                            onBlur={() => commitMarkupText(m.id)}
                            onPointerDown={(e) => e.stopPropagation()}
                            placeholder="Type design notes, specs, dimensions, placeholders…"
                            className="w-full h-full bg-transparent text-white text-[11px] leading-snug p-2 resize-none focus:outline-none placeholder:text-[#8A95A5]"
                          />
                        ) : (
                          <div onDoubleClick={(e) => { e.stopPropagation(); setEditingId(m.id); }} className="w-full h-full p-2 text-white text-[11px] leading-snug whitespace-pre-wrap break-words">
                            {m.text || <span className="text-[#8A95A5]">Double-click to edit…</span>}
                          </div>
                        )}
                      </div>
                    );
                  }
                  return (
                    <div
                      key={m.id}
                      onPointerDown={(e) => startDrag(e, m)}
                      onClick={(e) => e.stopPropagation()}
                      className="absolute group cursor-move"
                      style={{ left: `${m.x}%`, top: `${m.y}%`, transform: "translate(-50%, -50%)" }}
                    >
                      <button onClick={(e) => { e.stopPropagation(); removeMarkup(m.id); }} className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-[#EF4444] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 z-10"><X className="w-2.5 h-2.5" /></button>
                      {m.type === "pin" ? (
                        <div className="flex flex-col items-center">
                          <div className="w-4 h-4 rounded-full border-2 border-white shadow" style={{ background: m.color }} />
                          {m.text && <div className="mt-1 px-1.5 py-0.5 rounded bg-black/70 text-white text-[10px] whitespace-nowrap">{m.text}</div>}
                        </div>
                      ) : editingId === m.id ? (
                        <input
                          autoFocus
                          value={m.text}
                          onChange={(e) => setMarkupTextValue(m.id, e.target.value)}
                          onBlur={() => commitMarkupText(m.id)}
                          onPointerDown={(e) => e.stopPropagation()}
                          className="px-2 py-1 rounded bg-black/80 text-white text-[11px] border focus:outline-none"
                          style={{ borderColor: m.color }}
                        />
                      ) : (
                        <div onDoubleClick={(e) => { e.stopPropagation(); setEditingId(m.id); }} className="px-2 py-1 rounded bg-black/70 text-white text-[11px] whitespace-nowrap border" style={{ borderColor: m.color }}>{m.text || "Note"}</div>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* Version history sidebar */}
              {showVersions && (
                <div className="w-56 border-l border-[#222A35] bg-[#11161D] overflow-y-auto hidden sm:block">
                  <div className="p-3 border-b border-[#222A35]">
                    <div className="text-[12px] text-white font-display">Version History</div>
                    <div className="text-[10px] text-[#5B6675]">{viewing.id}</div>
                  </div>
                  <div className="p-2 space-y-1">
                    {drawingVersions.filter((v) => v.drawingId === viewing.id).map((v) => (
                      <button key={v.rev} onClick={() => toast(`Switched to revision ${v.rev}`)} className="w-full text-left p-2 rounded-md hover:bg-[#161C24] border border-transparent hover:border-[#222A35]">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-white">Rev {v.rev}</span>
                          <span className="text-[10px] text-[#5B6675]">{v.date}</span>
                        </div>
                        {v.rev === viewing.rev && <div className="text-[10px] text-[#22C55E]">Current</div>}
                      </button>
                    ))}
                    {drawingVersions.filter((v) => v.drawingId === viewing.id).length === 0 && (
                      <div className="text-[11px] text-[#5B6675] p-2">No previous versions</div>
                    )}
                  </div>
                  {/* Cloud integrations */}
                  <div className="p-3 border-t border-[#222A35] space-y-2">
                    <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">Cloud Storage</div>
                    <button onClick={() => toast("Opening Box integration...")} className="w-full flex items-center gap-2 p-2 rounded-md border border-[#222A35] hover:border-[#3B82F6]/40 text-[11px] text-[#8A95A5] hover:text-white">
                      <Box className="w-4 h-4 text-[#3B82F6]" /> Box
                    </button>
                    <button onClick={() => toast("Opening Dropbox integration...")} className="w-full flex items-center gap-2 p-2 rounded-md border border-[#222A35] hover:border-[#3B82F6]/40 text-[11px] text-[#8A95A5] hover:text-white">
                      <Cloud className="w-4 h-4 text-[#3B82F6]" /> Dropbox
                    </button>
                    <button onClick={() => toast("Opening OneDrive integration...")} className="w-full flex items-center gap-2 p-2 rounded-md border border-[#222A35] hover:border-[#3B82F6]/40 text-[11px] text-[#8A95A5] hover:text-white">
                      <ExternalLink className="w-4 h-4 text-[#3B82F6]" /> OneDrive
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="p-3 border-t border-[#222A35] flex items-center justify-between text-[11px] text-[#5B6675]">
              <span>Updated {viewing.updated}</span>
              <span>{viewing.recipients} recipients · {markupMode !== "off" ? "click to place markup" : "drag to pan · scroll to zoom"}</span>
            </div>
          </div>
        </div>
      )}

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
                    {PROJECT_OPTIONS.map((p) => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-[#8A95A5] block mb-1">Discipline</label>
                  <select value={uploadDiscipline} onChange={(e) => setUploadDiscipline(e.target.value)} className="w-full h-9 px-3 rounded-md bg-[#0A0E14] border border-[#222A35] text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]">
                    {UPLOAD_DISCIPLINES.map((d) => <option key={d}>{d}</option>)}
                  </select>
                </div>
              </div>

              <button
                onClick={() => fileRef.current?.click()}
                className="w-full rounded-xl border border-dashed border-[#2C3744] bg-[#0A0E14] hover:border-[#FF6B1A]/50 hover:bg-[#FF6B1A]/5 transition p-6 flex flex-col items-center justify-center gap-2 text-center"
              >
                <Upload className="w-5 h-5 text-[#FF6B1A]" />
                <div className="text-[13px] text-white">Click to add files</div>
                <div className="text-[11px] text-[#5B6675]">PDF · DWG · DXF · RVT · images — upload as many as you want</div>
              </button>

              {pendingFiles.length > 0 && (
                <div>
                  <div className="text-[10px] text-[#5B6675] uppercase tracking-wider mb-2">{pendingFiles.length} file{pendingFiles.length === 1 ? "" : "s"} ready</div>
                  <div className="space-y-1.5 max-h-[220px] overflow-y-auto">
                    {pendingFiles.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 p-2 rounded-md bg-[#0A0E14] border border-[#222A35]">
                        <FileStack className="w-3.5 h-3.5 text-[#8A95A5] shrink-0" />
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
              <button
                onClick={commitUpload}
                disabled={!pendingFiles.length}
                className={`flex-1 h-10 rounded-md text-[12px] flex items-center justify-center gap-2 ${pendingFiles.length ? "bg-[#FF6B1A] text-white shadow-[0_4px_14px_rgba(255,107,26,0.35)] hover:bg-[#FF7E33]" : "bg-[#222A35] text-[#5B6675] cursor-not-allowed"}`}
              >
                <Upload className="w-4 h-4" /> Upload {pendingFiles.length || ""} to {uploadProject.split(" ")[0]}
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
              <div className="text-[10px] text-[#5B6675] uppercase tracking-wider mb-2">Recipients · field workers &amp; subs</div>
              <div className="space-y-1.5">
                {workers.map((w) => {
                  const on = selected.includes(w.n);
                  return (
                    <button
                      key={w.n}
                      onClick={() => setSelected(on ? selected.filter((n) => n !== w.n) : [...selected, w.n])}
                      className={`w-full flex items-center gap-3 p-2.5 rounded-md border transition ${on ? "bg-[#FF6B1A]/8 border-[#FF6B1A]/40" : "bg-[#0A0E14] border-[#222A35] hover:border-[#2C3744]"}`}
                    >
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px]" style={{ background: w.c }}>{w.n.split(" ").map(x => x[0]).join("")}</div>
                      <div className="flex-1 text-left min-w-0">
                        <div className="text-[12px] text-white truncate">{w.n}</div>
                        <div className="text-[10px] text-[#5B6675] truncate">{w.r}</div>
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
                <MessageSquare className="w-3.5 h-3.5" /> Recipients get push + offline-cached PDF in the mobile app
              </div>
            </div>
            <div className="p-5 border-t border-[#222A35] flex gap-2">
              <button onClick={() => setShareOpen(null)} className="flex-1 h-10 rounded-md border border-[#222A35] text-[12px] text-white hover:bg-[#161C24]">Cancel</button>
              <button onClick={submitShare} className="flex-1 h-10 rounded-md bg-[#FF6B1A] text-white text-[12px] flex items-center justify-center gap-2 shadow-[0_4px_14px_rgba(255,107,26,0.35)]">
                <Share2 className="w-4 h-4" /> Send to {selected.length}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
