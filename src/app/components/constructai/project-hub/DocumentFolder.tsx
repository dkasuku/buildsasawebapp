// ============================================================================
// A folder of files on the project: upload (many at once), search, open,
// delete. Used as-is for Contract Documents, and embedded by the variation and
// certificate folders for the files that back a single record.
// ============================================================================

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Search, Plus, Loader2, ExternalLink, Trash2 } from "lucide-react";
import api, { absoluteFileUrl, type DocCategory, type DocumentDto } from "../../../services/api";
import { pickFiles, useFileUpload } from "../useFileUpload";
import { UploadTray } from "../UploadTray";
import { DocRow, fileSizeLabel, fmtDate } from "./shared";

export type UploadTarget = { category: DocCategory; linkedType?: string; linkedId?: string; note?: string };

/**
 * Upload picked files and file each one as a Document in the given folder.
 * Shared so every folder gets the same behaviour: real progress, real errors,
 * and only durable URLs ever saved.
 */
export function useDocumentUpload(projectId: string, onChanged: () => void | Promise<void>) {
  const uploader = useFileUpload();
  const [saving, setSaving] = useState(false);
  const upload = async (target: UploadTarget, accept?: string, dropped?: File[]) => {
    const files = dropped?.length ? dropped : await pickFiles({ multiple: true, accept });
    if (!files.length) return [] as DocumentDto[];
    setSaving(true);
    const created: DocumentDto[] = [];
    try {
      // Upload one at a time (see useFileUpload) and record each file as soon as
      // it lands, so a failure on file 4 does not lose files 1–3.
      for (const f of files) {
        const [url] = await uploader.upload([f]);
        if (!url) continue;
        try {
          created.push(await api.createProjectDocument(projectId, {
            name: f.name, url, size: fileSizeLabel(f.size), updated: "Just now",
            category: target.category, linkedType: target.linkedType, linkedId: target.linkedId, note: target.note,
          }));
        } catch (e: any) {
          toast.error(`${f.name} uploaded but could not be filed — ${e?.message || "unknown error"}`);
        }
      }
      if (created.length) await onChanged();
    } finally {
      setSaving(false);
      uploader.reset();
    }
    return created;
  };
  return { upload, uploader, pending: uploader.pending, busy: uploader.busy || saving };
}

export const FOLDER_META: Record<DocCategory, { title: string; blurb: string; examples: string }> = {
  contract: { title: "Contract Documents", blurb: "The agreement and everything that governs the job.", examples: "Signed contract, letter of award, conditions of contract, works programme, bonds & insurances, specifications." },
  drawing: { title: "Drawings & Designs", blurb: "Design documents that are not sheets.", examples: "Design reports, specifications, schedules, approvals." },
  boq: { title: "Bills & Quotations", blurb: "Priced documents received from others.", examples: "Tender BOQ, supplier quotations, subcontractor quotes." },
  variation: { title: "Variation Support", blurb: "Evidence behind a variation.", examples: "Instruction letters, revised drawings, site photographs, cost breakdowns." },
  certificate: { title: "Payment Certificates", blurb: "The certificates as issued.", examples: "Signed interim certificates, valuations, payment advices." },
  site: { title: "Site Records", blurb: "Records generated on site.", examples: "Method statements, permits, test certificates, delivery notes." },
  general: { title: "Other Documents", blurb: "Anything that does not fit a folder above.", examples: "Correspondence, minutes, reports." },
};

export function DocumentFolder({
  projectId, category, docs, onChanged, canEdit, title, blurb, examples, tiles = false,
}: {
  projectId: string;
  category: DocCategory;
  docs: DocumentDto[];
  onChanged: () => void | Promise<void>;
  canEdit: boolean;
  title?: string; blurb?: string; examples?: string;
  /** Show files as a grid of tiles rather than rows. */
  tiles?: boolean;
}) {
  const meta = FOLDER_META[category];
  const [q, setQ] = useState("");
  const [drag, setDrag] = useState(false);
  const { upload, uploader, pending, busy } = useDocumentUpload(projectId, onChanged);

  const all = useMemo(() => docs.filter((d) => (d.category || "general") === category), [docs, category]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((d) => `${d.name} ${d.note || ""}`.toLowerCase().includes(needle)) : all;
  }, [all, q]);

  const del = async (d: DocumentDto) => {
    if (!confirm(`Delete ${d.name}?`)) return;
    try { await api.deleteDocument(d.id); await onChanged(); toast.success("Deleted"); }
    catch (e: any) { toast.error(e?.message || "Could not delete that file"); }
  };
  const dropProps = canEdit ? {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDrag(true); },
    onDragLeave: () => setDrag(false),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setDrag(false); const files = Array.from(e.dataTransfer.files || []); if (files.length) upload({ category }, undefined, files); },
  } : {};

  return (
    <section className="ws-card" aria-label={title ?? meta.title} {...dropProps} style={drag ? { borderColor: "var(--ws-primary)" } : undefined}>
      <div className="ws-card-head">
        <div className="min-w-0">
          <h2 className="ws-h2">{title ?? meta.title}</h2>
          <div className="ws-sub">{all.length} file{all.length === 1 ? "" : "s"} · {blurb ?? meta.blurb}</div>
        </div>
        {canEdit && (
          <button type="button" onClick={() => upload({ category })} disabled={busy} className="ws-btn">
            {busy ? <Loader2 className="animate-spin" /> : <Plus />} Add document
          </button>
        )}
      </div>
      {all.length > 6 && (
        <div className="flex items-center gap-2 px-[18px] py-2" style={{ borderBottom: "1px solid var(--ws-divider)" }}>
          <Search className="w-4 h-4" style={{ color: "var(--ws-muted)" }} aria-hidden />
          <label className="sr-only" htmlFor={`search-${category}`}>Search this folder</label>
          <input id={`search-${category}`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search this folder" className="flex-1 h-8 bg-transparent outline-none text-[13.5px]" style={{ color: "var(--ws-text)" }} />
        </div>
      )}
      {pending.length > 0 && <div className="px-[18px] pt-3"><UploadTray state={uploader} /></div>}
      {rows.length > 0 && !tiles ? (
        <div>{rows.map((d) => <DocRow key={d.id} doc={d} onDelete={canEdit ? del : undefined} />)}</div>
      ) : (
        <div className="ws-card-body">
          {rows.length === 0 ? (
            <div className="ws-dashed-row" style={drag ? { borderColor: "var(--ws-primary)", background: "var(--ws-wash)" } : undefined}>
              {q ? "Nothing matches that search." : canEdit ? "Nothing here yet. Drop files or add a document." : "Nothing here yet."}
            </div>
          ) : (
            <div className="ws-grid-3">
              {rows.map((d) => <DocTile key={d.id} doc={d} onDelete={canEdit ? del : undefined} />)}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function DocTile({ doc, onDelete }: { doc: DocumentDto; onDelete?: (d: DocumentDto) => void }) {
  const ext = (doc.name.split(".").pop() || "file").slice(0, 4).toUpperCase();
  return (
    <div className="rounded-[10px] p-3 flex flex-col gap-2 min-w-0" style={{ border: "1px solid var(--ws-border)", background: "var(--ws-card)" }}>
      <div className="flex items-center justify-between gap-2">
        <span className="ws-pill ws-mono" style={{ height: 20, fontSize: 11 }}>{ext}</span>
        <span className="flex items-center gap-1">
          <a href={absoluteFileUrl(doc.url)} target="_blank" rel="noreferrer" className="ws-icon-btn ws-ghost" style={{ width: 28, height: 28 }} aria-label={`Open ${doc.name}`}><ExternalLink /></a>
          {onDelete && <button type="button" onClick={() => onDelete(doc)} className="ws-icon-btn ws-ghost" style={{ width: 28, height: 28 }} aria-label={`Delete ${doc.name}`}><Trash2 /></button>}
        </span>
      </div>
      <a href={absoluteFileUrl(doc.url)} target="_blank" rel="noreferrer" className="text-[13.5px] font-medium truncate hover:underline" style={{ color: "var(--ws-text)" }} title={doc.name}>{doc.name}</a>
      <div className="text-[12px] truncate" style={{ color: "var(--ws-muted)" }}>{doc.size} · {doc.createdAt ? fmtDate(doc.createdAt) : doc.updated}</div>
    </div>
  );
}
