// ============================================================================
// Drawings & Designs — one card per sheet, every revision inside it.
//
// A "version" is another Drawing row with the same sheet number and a higher
// rev, so V1 is never overwritten by V2 and the Plans module sees exactly the
// same rows. Non-sheet design documents (reports, specs) go in the linked
// document folder underneath.
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FileStack, UploadCloud, Loader2, History, Trash2 } from "lucide-react";
import api, { absoluteFileUrl, type DocumentDto, type DrawingDto, type DrawingSheetDto } from "../../../services/api";
import { pickFiles, useFileUpload } from "../useFileUpload";
import { UploadTray } from "../UploadTray";
import { DocumentFolder } from "./DocumentFolder";
import { DrawingViewer, toViewerRole } from "../drawing-viewer";
import type { Role } from "../roles";
import { Field, Modal, btnGhost, btnPrimary, fileSizeLabel, fmtDate, input } from "./shared";

const DISCIPLINES = ["Architectural", "Structural", "Civil", "Mechanical", "Electrical", "Plumbing", "Landscape", "Interior", "Other"];
const STATUSES = ["Draft", "For Review", "Approved", "For Construction", "Superseded"];

const PAGE = 7;

/** Status pill for a sheet: label always shown, colour only reinforces it. */
function SheetStatus({ status }: { status: string }) {
  const s = status.toLowerCase();
  const tone = s.includes("construction") || s === "approved" ? "ws-pill-green" : s.includes("review") || s.includes("await") ? "ws-pill-amber" : s.includes("draft") ? "ws-pill-blue" : "";
  const label = s.includes("review") ? "Awaiting approval" : status;
  return <span className={`ws-pill ${tone}`}>{label}</span>;
}

export function DrawingsFolder({
  projectId, sheets, docs, canEdit, onChanged, role = "Contractor", projectName = "",
}: {
  projectId: string;
  role?: Role;
  projectName?: string;
  sheets: DrawingSheetDto[];
  docs: DocumentDto[];
  canEdit: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [discipline, setDiscipline] = useState("all");
  const [versions, setVersions] = useState<"latest" | "all">("latest");
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState<File[] | null>(null);
  const [drag, setDrag] = useState(false);
  const [revisionFor, setRevisionFor] = useState<DrawingSheetDto | null>(null);
  // Drawings open in the same viewer as Plans & drawings, over this page.
  const [viewing, setViewing] = useState<DrawingDto | null>(null);

  const disciplines = useMemo(() => Array.from(new Set(sheets.map((s) => s.discipline || "Other"))).sort(), [sheets]);
  const filtered = useMemo(
    () => sheets.filter((s) => discipline === "all" || (s.discipline || "Other") === discipline),
    [sheets, discipline],
  );
  const rows = useMemo(() => {
    const list = versions === "latest"
      ? filtered.map((s) => ({ sheet: s, d: s.latest, isLatest: true }))
      : filtered.flatMap((s) => s.versions.map((d, i) => ({ sheet: s, d, isLatest: i === 0 })));
    return list;
  }, [filtered, versions]);
  const visible = showAll ? rows : rows.slice(0, PAGE);

  const setStatus = async (d: DrawingDto, status: string) => {
    try { await api.updateDrawing(d.id, { status }); await onChanged(); }
    catch (e: any) { toast.error(e?.message || "Could not update the drawing"); }
  };
  const remove = async (d: DrawingDto) => {
    if (!confirm(`Delete ${d.number} V${d.rev}? Other versions are kept.`)) return;
    try { await api.deleteDrawing(d.id); await onChanged(); toast.success("Version deleted"); }
    catch (e: any) { toast.error(e?.message || "Could not delete"); }
  };
  const dropProps = canEdit ? {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDrag(true); },
    onDragLeave: () => setDrag(false),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setDrag(false); const f = Array.from(e.dataTransfer.files || []); if (f.length) setAdding(f); },
  } : {};

  return (
    <>
      <section className="ws-card" aria-labelledby="dwg-title" {...dropProps}>
        <div className="ws-card-head">
          <div className="min-w-0">
            <h2 id="dwg-title" className="ws-h2">Drawing sheets</h2>
            <div className="ws-sub">{sheets.length} sheet{sheets.length === 1 ? "" : "s"} · revisions stack as V2, V3… under one sheet number</div>
          </div>
          <div className="ws-toolbar">
            {sheets.length > 0 && (
              <>
                <label className="sr-only" htmlFor="dwg-discipline">Discipline</label>
                <select id="dwg-discipline" className="ws-select" value={discipline} onChange={(e) => { setDiscipline(e.target.value); setShowAll(false); }}>
                  <option value="all">All disciplines</option>
                  {disciplines.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <label className="sr-only" htmlFor="dwg-versions">Versions</label>
                <select id="dwg-versions" className="ws-select" value={versions} onChange={(e) => setVersions(e.target.value as "latest" | "all")}>
                  <option value="latest">Latest only</option>
                  <option value="all">All versions</option>
                </select>
              </>
            )}
            {canEdit && <button type="button" onClick={() => setAdding([])} className="ws-btn-primary"><UploadCloud aria-hidden /> Upload drawings</button>}
          </div>
        </div>

        {sheets.length === 0 ? (
          <div className="ws-card-body">
            <div className={`ws-dropzone ${drag ? "ws-drag" : ""}`}>
              <FileStack className="w-7 h-7" style={{ color: "var(--ws-muted)" }} aria-hidden />
              <div className="ws-h2">Drop drawing sheets here</div>
              <div className="ws-sub max-w-md">PDF, DWG or images. Each file becomes a sheet at V1, and later revisions stack under the same number.</div>
              {canEdit && <button type="button" className="ws-btn mt-1" onClick={() => setAdding([])}>Browse files</button>}
            </div>
          </div>
        ) : (
          <>
            <div className="ws-table-wrap">
              <table className="ws-table">
                <thead>
                  <tr><th scope="col">Sheet</th><th scope="col">Title</th><th scope="col">Discipline</th><th scope="col">{versions === "latest" ? "Latest" : "Version"}</th><th scope="col">Updated</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  {visible.map(({ sheet, d, isLatest }) => (
                    <tr key={d.id}>
                      <td className="ws-mono ws-nowrap" style={{ fontSize: 12.5 }}>{sheet.number}</td>
                      <td style={{ maxWidth: 260 }}>
                        <button type="button" className="text-left truncate max-w-full hover:underline" style={{ color: "var(--ws-text)", fontWeight: 500 }} onClick={() => setViewing(d)}>{d.title || sheet.title}</button>
                      </td>
                      <td style={{ color: "var(--ws-text-2)" }}>{sheet.discipline || "Other"}</td>
                      <td className="whitespace-nowrap">
                        <strong style={{ fontWeight: 600 }}>V{d.rev}</strong>
                        {versions === "latest" && sheet.versions.length > 1 && <span style={{ color: "var(--ws-muted)" }}> ({sheet.versions.length} versions)</span>}
                        {versions === "all" && !isLatest && <span style={{ color: "var(--ws-muted)" }}> (older)</span>}
                      </td>
                      <td className="whitespace-nowrap" style={{ color: "var(--ws-muted)" }}>{fmtDate(d.createdAt, { day: "numeric", month: "short" })}{d.uploadedBy ? ` · ${d.uploadedBy}` : ""}</td>
                      <td>
                        {canEdit ? (
                          <>
                            <label className="sr-only" htmlFor={`st-${d.id}`}>Status of {sheet.number} V{d.rev}</label>
                            <select id={`st-${d.id}`} value={d.status} onChange={(e) => setStatus(d, e.target.value)} className="ws-select" style={{ height: 30, fontSize: 12.5 }}>
                              {STATUSES.map((st) => <option key={st}>{st}</option>)}
                            </select>
                          </>
                        ) : <SheetStatus status={d.status} />}
                      </td>
                      <td className="whitespace-nowrap text-right">
                        {canEdit && isLatest && <button type="button" onClick={() => setRevisionFor(sheet)} className="ws-icon-btn ws-ghost" style={{ width: 30, height: 30 }} aria-label={`Upload a new version of ${sheet.number}`} title="New version"><History /></button>}
                        {canEdit && <button type="button" onClick={() => remove(d)} className="ws-icon-btn ws-ghost" style={{ width: 30, height: 30 }} aria-label={`Delete ${sheet.number} V${d.rev}`} title="Delete this version"><Trash2 /></button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > PAGE && (
              <div className="flex items-center justify-between gap-3 px-[18px] py-3" style={{ borderTop: "1px solid var(--ws-divider)", fontSize: 13, color: "var(--ws-muted)" }}>
                <span>Showing {visible.length} of {rows.length}</span>
                <button type="button" className="ws-link" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show fewer" : `Show all ${versions === "latest" ? "sheets" : "versions"}`}</button>
              </div>
            )}
          </>
        )}
      </section>

      <DocumentFolder projectId={projectId} category="drawing" docs={docs} onChanged={onChanged} canEdit={canEdit} title="Design documents" blurb="reports, specifications and approvals" tiles />

      {adding && <UploadDrawingModal projectId={projectId} initialFiles={adding} onClose={() => setAdding(null)} onDone={async () => { setAdding(null); await onChanged(); }} />}
      {viewing && (
        <DrawingViewer
          seed={{ id: viewing.id, sheetNumber: viewing.number, title: viewing.title, projectName, discipline: viewing.discipline, fileUrl: absoluteFileUrl(viewing.fileUrl), rev: viewing.rev }}
          role={toViewerRole(canEdit, true)}
          appRole={role}
          onClose={() => setViewing(null)}
        />
      )}
      {revisionFor && <NewRevisionModal projectId={projectId} sheet={revisionFor} onClose={() => setRevisionFor(null)} onDone={async () => { setRevisionFor(null); await onChanged(); }} />}
    </>
  );
}

// ----------------------------------------------------------------------------

function UploadDrawingModal({ projectId, initialFiles = [], onClose, onDone }: { projectId: string; initialFiles?: File[]; onClose: () => void; onDone: () => Promise<void> }) {
  const uploader = useFileUpload();
  const [files, setFiles] = useState<File[]>([]);
  const [discipline, setDiscipline] = useState("Architectural");
  const [status, setStatus] = useState("Draft");
  // One title/number per file, prefilled from the filename so a batch of twelve
  // sheets does not need twelve rounds of typing.
  const [meta, setMeta] = useState<Record<string, { number: string; title: string }>>({});
  const [saving, setSaving] = useState(false);

  const pick = async (dropped?: File[]) => {
    const picked = dropped ?? await pickFiles({ multiple: true, accept: ".pdf,.dwg,.dxf,.png,.jpg,.jpeg,.webp" });
    if (!picked.length) return;
    setFiles((f) => [...f, ...picked]);
    setMeta((m) => {
      const next = { ...m };
      for (const f of picked) {
        const base = f.name.replace(/\.[^.]+$/, "");
        // "A-101 Ground floor plan" → number A-101, title the rest.
        const match = base.match(/^([A-Za-z]{1,3}[- ]?\d{2,4}[A-Za-z]?)\s*[-–_ ]*\s*(.*)$/);
        next[f.name] = { number: match ? match[1].toUpperCase() : base.slice(0, 20), title: match && match[2] ? match[2] : base };
      }
      return next;
    });
  };

  // Files dropped on the drawings card arrive here pre-picked.
  useEffect(() => { if (initialFiles.length) pick(initialFiles); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!files.length) return toast.error("Choose at least one file");
    setSaving(true);
    let ok = 0;
    try {
      for (const f of files) {
        const [url] = await uploader.upload([f]);
        if (!url) continue;
        const m = meta[f.name] || { number: f.name, title: f.name };
        try {
          await api.createDrawing(projectId, { number: m.number.trim() || m.title, title: m.title.trim() || m.number, discipline, status, fileUrl: url, fileName: f.name, fileSize: f.size, rev: 1 });
          ok += 1;
        } catch (e: any) { toast.error(`${f.name}: ${e?.message || "could not save the drawing"}`); }
      }
      if (ok) { toast.success(`${ok} drawing${ok === 1 ? "" : "s"} added as V1`); await onDone(); }
    } finally { setSaving(false); }
  };

  return (
    <Modal title="Upload drawings" subtitle="Each file becomes a sheet at V1. Upload later revisions from the sheet's “New version” button." onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Discipline"><select value={discipline} onChange={(e) => setDiscipline(e.target.value)} className={input}>{DISCIPLINES.map((d) => <option key={d}>{d}</option>)}</select></Field>
          <Field label="Status"><select value={status} onChange={(e) => setStatus(e.target.value)} className={input}>{STATUSES.map((d) => <option key={d}>{d}</option>)}</select></Field>
        </div>
        <button onClick={() => pick()} className="w-full h-20 border-2 border-dashed border-[#222A35] rounded-xl flex flex-col items-center justify-center gap-1 text-[#8A95A5] hover:border-[#FF6B1A] hover:text-white transition">
          <UploadCloud className="w-5 h-5" /><span className="text-[12px]">Choose files — PDF, DWG, images</span>
        </button>
        {files.length > 0 && (
          <div className="rounded-lg border border-[#222A35] divide-y divide-[#222A35]">
            <div className="hidden sm:grid grid-cols-[110px_1fr_1fr_28px] gap-2 px-3 py-2 text-[10px] uppercase tracking-wider text-[#5B6675]"><span>Sheet no.</span><span>Title</span><span>File</span><span /></div>
            {files.map((f) => (
              <div key={f.name} className="grid grid-cols-1 sm:grid-cols-[110px_1fr_1fr_28px] gap-2 px-3 py-2 items-center">
                <input value={meta[f.name]?.number || ""} onChange={(e) => setMeta((m) => ({ ...m, [f.name]: { ...(m[f.name] || { number: "", title: "" }), number: e.target.value } }))} placeholder="A-101" className={`${input} h-8 font-mono`} />
                <input value={meta[f.name]?.title || ""} onChange={(e) => setMeta((m) => ({ ...m, [f.name]: { ...(m[f.name] || { number: "", title: "" }), title: e.target.value } }))} placeholder="Ground floor plan" className={`${input} h-8`} />
                <div className="text-[11px] text-[#8A95A5] truncate">{f.name} · {fileSizeLabel(f.size)}</div>
                <button onClick={() => setFiles((l) => l.filter((x) => x !== f))} className="text-[#5B6675] hover:text-[#EF4444] flex justify-center"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        )}
        {uploader.pending.length > 0 && <UploadTray state={uploader} />}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnGhost}>Cancel</button>
          <button onClick={save} disabled={saving || !files.length} className={btnPrimary}>{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />} Upload {files.length || ""}</button>
        </div>
      </div>
    </Modal>
  );
}

function NewRevisionModal({ projectId, sheet, onClose, onDone }: { projectId: string; sheet: DrawingSheetDto; onClose: () => void; onDone: () => Promise<void> }) {
  const uploader = useFileUpload();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(sheet.title);
  const [status, setStatus] = useState("For Review");
  const [supersede, setSupersede] = useState(true);
  const [saving, setSaving] = useState(false);
  const next = (sheet.latest?.rev || 0) + 1;

  const save = async () => {
    if (!file) return toast.error("Choose the revised file");
    setSaving(true);
    try {
      const [url] = await uploader.upload([file]);
      if (!url) return;
      await api.addDrawingRevision(projectId, sheet.number, { fileUrl: url, fileName: file.name, fileSize: file.size, title: title.trim() || sheet.title, status });
      // Mark the old current revision as superseded so the status column tells the
      // truth at a glance. Optional — some teams keep the old status for the record.
      if (supersede && sheet.latest && sheet.latest.status !== "Superseded") {
        await api.updateDrawing(sheet.latest.id, { status: "Superseded" }).catch(() => {});
      }
      toast.success(`${sheet.number} is now at V${next}`);
      await onDone();
    } catch (e: any) { toast.error(e?.message || "Could not add the revision"); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={`New version of ${sheet.number}`} subtitle={`Currently V${sheet.latest?.rev}. The new file becomes V${next}; V${sheet.latest?.rev} stays on record.`} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Title"><input placeholder="e.g. Ground floor plan" value={title} onChange={(e) => setTitle(e.target.value)} className={input} /></Field>
        <Field label="Status of the new version"><select value={status} onChange={(e) => setStatus(e.target.value)} className={input}>{STATUSES.filter((s) => s !== "Superseded").map((d) => <option key={d}>{d}</option>)}</select></Field>
        <button onClick={async () => { const [f] = await pickFiles({ accept: ".pdf,.dwg,.dxf,.png,.jpg,.jpeg,.webp" }); if (f) setFile(f); }} className="w-full h-20 border-2 border-dashed border-[#222A35] rounded-xl flex flex-col items-center justify-center gap-1 text-[#8A95A5] hover:border-[#FF6B1A] hover:text-white transition">
          <UploadCloud className="w-5 h-5" /><span className="text-[12px]">{file ? `${file.name} · ${fileSizeLabel(file.size)}` : "Choose the revised file"}</span>
        </button>
        <label className="flex items-center gap-2 text-[12px] text-[#C2CAD6]"><input type="checkbox" checked={supersede} onChange={(e) => setSupersede(e.target.checked)} className="accent-[#FF6B1A]" /> Mark V{sheet.latest?.rev} as superseded</label>
        {uploader.pending.length > 0 && <UploadTray state={uploader} />}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnGhost}>Cancel</button>
          <button onClick={save} disabled={saving || !file} className={btnPrimary}>{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <History className="w-3.5 h-3.5" />} Save as V{next}</button>
        </div>
      </div>
    </Modal>
  );
}
