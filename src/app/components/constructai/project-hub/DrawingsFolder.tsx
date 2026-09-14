// ============================================================================
// Drawings & Designs — one card per sheet, every revision inside it.
//
// A "version" is another Drawing row with the same sheet number and a higher
// rev, so V1 is never overwritten by V2 and the Plans module sees exactly the
// same rows. Non-sheet design documents (reports, specs) go in the linked
// document folder underneath.
// ============================================================================

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { FileStack, UploadCloud, Loader2, History, ExternalLink, ChevronDown, ChevronRight, Trash2, Search } from "lucide-react";
import api, { absoluteFileUrl, type DocumentDto, type DrawingDto, type DrawingSheetDto } from "../../../services/api";
import { pickFiles, useFileUpload } from "../useFileUpload";
import { UploadTray } from "../UploadTray";
import { DocumentFolder } from "./DocumentFolder";
import { Empty, Field, Modal, Panel, Pill, btnGhost, btnPrimary, fileSizeLabel, fmtDate, input, statusLabel, statusTone } from "./shared";

const DISCIPLINES = ["Architectural", "Structural", "Civil", "Mechanical", "Electrical", "Plumbing", "Landscape", "Interior", "Other"];
const STATUSES = ["Draft", "For Review", "Approved", "For Construction", "Superseded"];

export function DrawingsFolder({
  projectId, sheets, docs, canEdit, onChanged,
}: {
  projectId: string;
  sheets: DrawingSheetDto[];
  docs: DocumentDto[];
  canEdit: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState(false);
  const [revisionFor, setRevisionFor] = useState<DrawingSheetDto | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? sheets.filter((s) => `${s.number} ${s.title} ${s.discipline}`.toLowerCase().includes(needle)) : sheets;
  }, [sheets, q]);

  const byDiscipline = useMemo(() => {
    const groups: Record<string, DrawingSheetDto[]> = {};
    for (const s of filtered) (groups[s.discipline || "Other"] = groups[s.discipline || "Other"] || []).push(s);
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const totalVersions = sheets.reduce((n, s) => n + s.versions.length, 0);

  const setStatus = async (d: DrawingDto, status: string) => {
    try { await api.updateDrawing(d.id, { status }); await onChanged(); }
    catch (e: any) { toast.error(e?.message || "Could not update the drawing"); }
  };
  const remove = async (d: DrawingDto) => {
    if (!confirm(`Delete ${d.number} Rev ${d.rev}? Other revisions are kept.`)) return;
    try { await api.deleteDrawing(d.id); await onChanged(); toast.success("Revision deleted"); }
    catch (e: any) { toast.error(e?.message || "Could not delete"); }
  };

  return (
    <div className="space-y-4">
      <Panel
        title="Drawings & Designs"
        subtitle={`${sheets.length} sheet${sheets.length === 1 ? "" : "s"} · ${totalVersions} version${totalVersions === 1 ? "" : "s"} in total`}
        action={canEdit && (
          <button onClick={() => setAdding(true)} className={btnPrimary}><UploadCloud className="w-3.5 h-3.5" /> Upload drawing</button>
        )}
      >
        {sheets.length > 3 && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-[#222A35]">
            <Search className="w-3.5 h-3.5 text-[#5B6675]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by sheet number, title or discipline" className={`${input} border-0 bg-transparent h-8 px-0`} />
          </div>
        )}
        {filtered.length === 0 ? (
          <Empty icon={FileStack} title={q ? "No sheets match" : "No drawings uploaded yet"} hint={q ? undefined : "Upload the architectural, structural and services sheets. Each later revision is added as V2, V3… under the same sheet number, so nothing is lost."}>
            {canEdit && !q && <button onClick={() => setAdding(true)} className={btnPrimary}><UploadCloud className="w-3.5 h-3.5" /> Upload the first drawing</button>}
          </Empty>
        ) : (
          <div className="divide-y divide-[#222A35]">
            {byDiscipline.map(([discipline, list]) => (
              <div key={discipline}>
                <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-[#5B6675] bg-[#0A0E14]/60">{discipline} · {list.length}</div>
                {list.map((s) => {
                  const key = s.number.toLowerCase();
                  const expanded = !!open[key];
                  const latest = s.latest;
                  return (
                    <div key={key} className="border-t border-[#222A35]/60">
                      <div className="px-4 py-3 flex items-center gap-3">
                        <button onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))} className="text-[#8A95A5] hover:text-white shrink-0" title="Show versions">
                          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                        <div className="w-10 h-10 rounded-md bg-[#FF6B1A]/10 border border-[#FF6B1A]/20 flex items-center justify-center shrink-0"><FileStack className="w-4 h-4 text-[#FF6B1A]" /></div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[11px] font-mono text-[#8A95A5]">{s.number}</span>
                            <a href={absoluteFileUrl(latest.fileUrl)} target="_blank" rel="noreferrer" className="text-[12.5px] text-white hover:underline truncate">{s.title}</a>
                            <Pill tone="brand">V{latest.rev}</Pill>
                            <Pill tone={statusTone(latest.status)}>{statusLabel(latest.status)}</Pill>
                          </div>
                          <div className="text-[10.5px] text-[#5B6675] mt-0.5">
                            {s.versions.length} version{s.versions.length === 1 ? "" : "s"} · latest {fmtDate(latest.createdAt)}{latest.uploadedBy ? ` by ${latest.uploadedBy}` : ""}
                          </div>
                        </div>
                        <a href={absoluteFileUrl(latest.fileUrl)} target="_blank" rel="noreferrer" className={`${btnGhost} h-8 px-2.5`}><ExternalLink className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Open latest</span></a>
                        {canEdit && (
                          <button onClick={() => setRevisionFor(s)} className={`${btnGhost} h-8 px-2.5`} title="Upload a new revision of this sheet"><History className="w-3.5 h-3.5" /> <span className="hidden sm:inline">New version</span></button>
                        )}
                      </div>
                      {expanded && (
                        <div className="px-4 pb-3 pl-[4.25rem]">
                          <div className="rounded-lg border border-[#222A35] bg-[#0A0E14] divide-y divide-[#222A35]">
                            {s.versions.map((v, i) => (
                              <div key={v.id} className="px-3 py-2 flex items-center gap-3 text-[12px]">
                                <Pill tone={i === 0 ? "brand" : "neutral"}>V{v.rev}</Pill>
                                <div className="flex-1 min-w-0">
                                  <a href={absoluteFileUrl(v.fileUrl)} target="_blank" rel="noreferrer" className="text-white hover:underline truncate block">{v.fileName || v.title}</a>
                                  <div className="text-[10.5px] text-[#5B6675]">{fmtDate(v.createdAt)}{v.uploadedBy ? ` · ${v.uploadedBy}` : ""}{v.fileSize ? ` · ${fileSizeLabel(v.fileSize)}` : ""}{i > 0 ? " · superseded" : " · current"}</div>
                                </div>
                                {canEdit ? (
                                  <select value={v.status} onChange={(e) => setStatus(v, e.target.value)} className="h-7 bg-[#11161D] border border-[#222A35] rounded px-1.5 text-[11px] text-[#C2CAD6]">
                                    {STATUSES.map((st) => <option key={st}>{st}</option>)}
                                  </select>
                                ) : <Pill tone={statusTone(v.status)}>{statusLabel(v.status)}</Pill>}
                                <a href={absoluteFileUrl(v.fileUrl)} target="_blank" rel="noreferrer" className="w-7 h-7 rounded flex items-center justify-center text-[#8A95A5] hover:text-white"><ExternalLink className="w-3.5 h-3.5" /></a>
                                {canEdit && <button onClick={() => remove(v)} className="w-7 h-7 rounded flex items-center justify-center text-[#5B6675] hover:text-[#EF4444]"><Trash2 className="w-3.5 h-3.5" /></button>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </Panel>

      <DocumentFolder projectId={projectId} category="drawing" docs={docs} onChanged={onChanged} canEdit={canEdit} title="Design documents" blurb="Reports, specifications and approvals that go with the drawings." />

      {adding && <UploadDrawingModal projectId={projectId} onClose={() => setAdding(false)} onDone={async () => { setAdding(false); await onChanged(); }} />}
      {revisionFor && <NewRevisionModal projectId={projectId} sheet={revisionFor} onClose={() => setRevisionFor(null)} onDone={async () => { setRevisionFor(null); await onChanged(); }} />}
    </div>
  );
}

// ----------------------------------------------------------------------------

function UploadDrawingModal({ projectId, onClose, onDone }: { projectId: string; onClose: () => void; onDone: () => Promise<void> }) {
  const uploader = useFileUpload();
  const [files, setFiles] = useState<File[]>([]);
  const [discipline, setDiscipline] = useState("Architectural");
  const [status, setStatus] = useState("Draft");
  // One title/number per file, prefilled from the filename so a batch of twelve
  // sheets does not need twelve rounds of typing.
  const [meta, setMeta] = useState<Record<string, { number: string; title: string }>>({});
  const [saving, setSaving] = useState(false);

  const pick = async () => {
    const picked = await pickFiles({ multiple: true, accept: ".pdf,.dwg,.dxf,.png,.jpg,.jpeg,.webp" });
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
        <button onClick={pick} className="w-full h-20 border-2 border-dashed border-[#222A35] rounded-xl flex flex-col items-center justify-center gap-1 text-[#8A95A5] hover:border-[#FF6B1A] hover:text-white transition">
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
        <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} className={input} /></Field>
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
