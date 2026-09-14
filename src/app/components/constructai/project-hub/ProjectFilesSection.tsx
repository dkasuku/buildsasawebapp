// ============================================================================
// "Documents & drawings" section of the New / Edit project dialog.
//
// Files are queued locally while the form is open and only uploaded + filed
// once the project exists (a new project has no id until it is saved). Each
// queue maps to a hub folder: contract documents, drawings (each becomes a
// sheet at V1), and BOQ / quotations.
// ============================================================================

import { FileStack, FileText, Calculator, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import api from "../../../services/api";
import { pickFiles, MAX_DOCUMENT_MB, rejectReason } from "../useFileUpload";
import { fileSizeLabel } from "./shared";

export type PendingProjectFiles = { contract: File[]; drawings: File[]; boq: File[] };
export const EMPTY_PROJECT_FILES: PendingProjectFiles = { contract: [], drawings: [], boq: [] };
export const pendingFileCount = (f: PendingProjectFiles) => f.contract.length + f.drawings.length + f.boq.length;

const QUEUES: { key: keyof PendingProjectFiles; label: string; hint: string; icon: any; accept: string }[] = [
  { key: "contract", label: "Contract documents", hint: "Signed contract, letter of award, works programme, bonds…", icon: FileText, accept: ".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg" },
  { key: "drawings", label: "Drawings & designs", hint: "Each file becomes a sheet at V1 — name files like “A-101 Ground floor plan”", icon: FileStack, accept: ".pdf,.dwg,.dxf,.png,.jpg,.jpeg,.webp" },
  { key: "boq", label: "BOQ & quotations", hint: "Tender BOQ, supplier and subcontractor quotes", icon: Calculator, accept: ".pdf,.xls,.xlsx,.csv,.doc,.docx" },
];

export function ProjectFilesSection({ value, onChange }: { value: PendingProjectFiles; onChange: (v: PendingProjectFiles) => void }) {
  const add = async (key: keyof PendingProjectFiles, accept: string) => {
    const picked = await pickFiles({ multiple: true, accept });
    if (!picked.length) return;
    const ok: File[] = [];
    for (const f of picked) { const why = rejectReason(f); if (why) toast.error(why, { duration: 8000 }); else ok.push(f); }
    onChange({ ...value, [key]: [...value[key], ...ok] });
  };
  const remove = (key: keyof PendingProjectFiles, i: number) => onChange({ ...value, [key]: value[key].filter((_, idx) => idx !== i) });
  return (
    <div className="space-y-3">
      <div className="text-[10.5px] text-[#5B6675]">Pick as many files as you like — up to {MAX_DOCUMENT_MB} MB each. They are filed into the project's folders when you save.</div>
      {QUEUES.map((q) => (
        <div key={q.key} className="rounded-lg border border-[#222A35] bg-[#0A0E14] p-3">
          <div className="flex items-center gap-2">
            <q.icon className="w-3.5 h-3.5 text-[#FF6B1A] shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-[12px] text-white">{q.label}{value[q.key].length ? <span className="text-[#8A95A5]"> · {value[q.key].length}</span> : null}</div>
              <div className="text-[10.5px] text-[#5B6675] truncate">{q.hint}</div>
            </div>
            <button type="button" onClick={() => add(q.key, q.accept)} className="h-8 px-2.5 rounded-md border border-[#222A35] text-[11px] text-[#C2CAD6] hover:text-white hover:border-[#FF6B1A]/50 flex items-center gap-1 shrink-0"><UploadCloud className="w-3.5 h-3.5" /> Add files</button>
          </div>
          {value[q.key].length > 0 && (
            <div className="mt-2 space-y-1">
              {value[q.key].map((f, i) => (
                <div key={`${f.name}-${i}`} className="flex items-center gap-2 text-[11px] px-2 py-1 rounded bg-[#11161D] border border-[#222A35]">
                  <span className="text-[#C2CAD6] truncate flex-1">{f.name}</span>
                  <span className="text-[#5B6675] shrink-0">{fileSizeLabel(f.size)}</span>
                  <button type="button" onClick={() => remove(q.key, i)} className="text-[#5B6675] hover:text-[#EF4444]"><X className="w-3 h-3" /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// "A-101 Ground floor plan.pdf" → { number: "A-101", title: "Ground floor plan" }
const sheetFromName = (name: string) => {
  const base = name.replace(/\.[^.]+$/, "");
  const m = base.match(/^([A-Za-z]{1,3}[- ]?\d{2,4}[A-Za-z]?)\s*[-–_ ]*\s*(.*)$/);
  return { number: m ? m[1].toUpperCase() : base.slice(0, 20), title: m && m[2] ? m[2] : base };
};

/**
 * Upload every queued file and file it against the project. Reports per-file
 * failures and never throws — the project itself is already saved by the time
 * this runs, so a bad PDF must not read as "the project wasn't created".
 */
export async function commitProjectFiles(projectId: string, files: PendingProjectFiles): Promise<{ saved: number; failed: number }> {
  let saved = 0, failed = 0;
  const fileDoc = async (f: File, category: "contract" | "boq") => {
    try {
      const url = await api.uploadFile(f);
      await api.createProjectDocument(projectId, { name: f.name, url, size: fileSizeLabel(f.size), updated: "Just now", category });
      saved += 1;
    } catch (e: any) { failed += 1; toast.error(e?.message || `${f.name} could not be uploaded`, { duration: 8000 }); }
  };
  for (const f of files.contract) await fileDoc(f, "contract");
  for (const f of files.boq) await fileDoc(f, "boq");
  for (const f of files.drawings) {
    try {
      const url = await api.uploadFile(f);
      const { number, title } = sheetFromName(f.name);
      await api.createDrawing(projectId, { number, title, discipline: "Architectural", status: "Draft", fileUrl: url, fileName: f.name, fileSize: f.size, rev: 1 });
      saved += 1;
    } catch (e: any) { failed += 1; toast.error(e?.message || `${f.name} could not be uploaded`, { duration: 8000 }); }
  }
  return { saved, failed };
}
