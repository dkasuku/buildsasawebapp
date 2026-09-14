// ============================================================================
// A folder of files on the project: upload (many at once), search, open,
// delete. Used as-is for Contract Documents, and embedded by the variation and
// certificate folders for the files that back a single record.
// ============================================================================

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { FolderOpen, Search, UploadCloud, Loader2 } from "lucide-react";
import api, { type DocCategory, type DocumentDto } from "../../../services/api";
import { pickFiles, useFileUpload } from "../useFileUpload";
import { UploadTray } from "../UploadTray";
import { DocRow, Empty, Panel, btnPrimary, fileSizeLabel, input } from "./shared";

export type UploadTarget = { category: DocCategory; linkedType?: string; linkedId?: string; note?: string };

/**
 * Upload picked files and file each one as a Document in the given folder.
 * Shared so every folder gets the same behaviour: real progress, real errors,
 * and only durable URLs ever saved.
 */
export function useDocumentUpload(projectId: string, onChanged: () => void | Promise<void>) {
  const uploader = useFileUpload();
  const [saving, setSaving] = useState(false);
  const upload = async (target: UploadTarget, accept?: string) => {
    const files = await pickFiles({ multiple: true, accept });
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
  projectId, category, docs, onChanged, canEdit, title, blurb, examples,
}: {
  projectId: string;
  category: DocCategory;
  docs: DocumentDto[];
  onChanged: () => void | Promise<void>;
  canEdit: boolean;
  title?: string; blurb?: string; examples?: string;
}) {
  const meta = FOLDER_META[category];
  const [q, setQ] = useState("");
  const { upload, uploader, pending, busy } = useDocumentUpload(projectId, onChanged);

  const rows = useMemo(() => {
    const mine = docs.filter((d) => (d.category || "general") === category);
    const needle = q.trim().toLowerCase();
    return needle ? mine.filter((d) => `${d.name} ${d.note || ""}`.toLowerCase().includes(needle)) : mine;
  }, [docs, category, q]);

  const del = async (d: DocumentDto) => {
    try { await api.deleteDocument(d.id); await onChanged(); toast.success("Deleted"); }
    catch (e: any) { toast.error(e?.message || "Could not delete that file"); }
  };

  return (
    <Panel
      title={title ?? meta.title}
      subtitle={`${rows.length} file${rows.length === 1 ? "" : "s"} · ${blurb ?? meta.blurb}`}
      action={canEdit && (
        <button onClick={() => upload({ category })} disabled={busy} className={btnPrimary}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />} Upload
        </button>
      )}
    >
      {docs.filter((d) => (d.category || "general") === category).length > 4 && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[#222A35]">
          <Search className="w-3.5 h-3.5 text-[#5B6675]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search this folder" className={`${input} border-0 bg-transparent h-8 px-0`} />
        </div>
      )}
      {pending.length > 0 && <div className="px-4 pt-3"><UploadTray state={uploader} /></div>}
      {rows.length === 0 ? (
        <Empty icon={FolderOpen} title={q ? "Nothing matches that search" : "This folder is empty"} hint={q ? undefined : `Upload ${examples ?? meta.examples}`}>
          {canEdit && !q && <button onClick={() => upload({ category })} disabled={busy} className={btnPrimary}><UploadCloud className="w-3.5 h-3.5" /> Upload files</button>}
        </Empty>
      ) : (
        <div className="divide-y divide-[#222A35]">
          {rows.map((d) => <DocRow key={d.id} doc={d} onDelete={canEdit ? del : undefined} />)}
        </div>
      )}
    </Panel>
  );
}
