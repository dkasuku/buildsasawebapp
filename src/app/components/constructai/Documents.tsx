// ============================================================================
// Unfiled Documents.
//
// Every project's files now live in that project's own folders (Contract
// Documents, Drawings, BOQ, Variations, Certificates, Site records) — open the
// project to reach them. This page used to be a second, flat list of the SAME
// rows with no project scoping, which meant two competing answers to "where are
// the documents?".
//
// What survives here is the one thing the hub cannot show: documents uploaded
// before files were filed per project, which carry no projectId and therefore
// appear in no project's folders. This is the queue for clearing them — file
// each into a project and folder, and it moves into that project's hub. Once
// the queue is empty this page disappears from the sidebar.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { FileText, FolderInput, Loader2, Search, Trash2, ExternalLink, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import api, { absoluteFileUrl, type DocCategory, type DocumentDto, type ProjectDto } from "../../services/api";
import { EmptyState } from "./EmptyState";

const FOLDERS: { value: DocCategory; label: string }[] = [
  { value: "contract", label: "Contract Documents" },
  { value: "drawing", label: "Drawings & Designs" },
  { value: "boq", label: "BOQ & Quotations" },
  { value: "variation", label: "Variation support" },
  { value: "certificate", label: "Payment Certificates" },
  { value: "site", label: "Site records" },
  { value: "general", label: "Other documents" },
];

export function Documents() {
  const [docs, setDocs] = useState<DocumentDto[]>([]);
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  // Per-row filing choice, so several documents can be sent to different places.
  const [choice, setChoice] = useState<Record<string, { projectId: string; category: DocCategory }>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, p] = await Promise.all([
        api.getUnfiledDocuments(),
        api.getProjects().catch(() => [] as ProjectDto[]),
      ]);
      setDocs(d);
      setProjects(p);
    } catch (e: any) {
      toast.error(e?.message || "Could not load documents");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const choiceFor = (id: string) => choice[id] || { projectId: projects[0]?.id || "", category: "general" as DocCategory };

  const file = async (d: DocumentDto) => {
    const c = choiceFor(d.id);
    if (!c.projectId) return toast.error("Create a project first — there is nowhere to file this yet");
    setBusyId(d.id);
    try {
      await api.updateDocument(d.id, { projectId: c.projectId, category: c.category });
      const project = projects.find((p) => p.id === c.projectId);
      const folder = FOLDERS.find((f) => f.value === c.category)?.label;
      setDocs((prev) => prev.filter((x) => x.id !== d.id));
      window.dispatchEvent(new Event("buildsasa:documents-filed"));
      toast.success(`${d.name} filed under ${folder} in ${project?.name ?? "the project"}`);
    } catch (e: any) {
      toast.error(e?.message || "Could not file that document");
    } finally {
      setBusyId(null);
    }
  };

  const del = async (d: DocumentDto) => {
    if (!confirm(`Delete "${d.name}"? This cannot be undone.`)) return;
    setBusyId(d.id);
    try {
      await api.deleteDocument(d.id);
      setDocs((prev) => prev.filter((x) => x.id !== d.id));
      window.dispatchEvent(new Event("buildsasa:documents-filed"));
      toast.success("Deleted");
    } catch (e: any) {
      toast.error(e?.message || "Could not delete");
    } finally {
      setBusyId(null);
    }
  };

  const filtered = docs.filter((d) => d.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div className="px-4 sm:px-7 py-5 space-y-4">
      <div className="rounded-xl border border-[#222A35] bg-[#0A0E14] px-4 py-3 text-[12px] text-[#8A95A5] leading-relaxed">
        <span className="text-[#C2CAD6]">Project files live inside each project.</span> Open a project and use its
        Contract Documents, Drawings, BOQ, Variations, Certificates or Site folders. Listed below are only documents
        uploaded without a project, which is why they appear in no project's folders — file each one and it moves there.
      </div>

      {loading ? (
        <div className="py-16 flex justify-center text-[#8A95A5]"><Loader2 className="w-4 h-4 animate-spin" /></div>
      ) : docs.length === 0 ? (
        <div className="rounded-xl border border-[#222A35] bg-[#11161D]">
          <EmptyState
            icon={CheckCircle2}
            title="Nothing left to file"
            description="Every document belongs to a project. Open any project to see its folders — this page is only here while something needs filing."
          />
        </div>
      ) : (
        <div className="rounded-xl border border-[#222A35] bg-[#11161D]">
          <div className="px-4 py-3 border-b border-[#222A35] flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-[13px] text-white font-display">Unfiled documents</div>
              <div className="text-[11px] text-[#8A95A5]">{docs.length} file{docs.length === 1 ? "" : "s"} with no project</div>
            </div>
            {docs.length > 4 && (
              <div className="flex items-center gap-2">
                <Search className="w-3.5 h-3.5 text-[#5B6675]" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" className="h-8 bg-transparent outline-none text-[12px] text-white placeholder:text-[#3A4350]" />
              </div>
            )}
          </div>
          <div className="divide-y divide-[#222A35]">
            {filtered.map((d) => {
              const c = choiceFor(d.id);
              const busy = busyId === d.id;
              return (
                <div key={d.id} className="px-4 py-3 space-y-2.5">
                  <div className="flex items-center gap-3">
                    <FileText className="w-4 h-4 text-[#FF6B1A] shrink-0" />
                    <div className="min-w-0 flex-1">
                      <a href={absoluteFileUrl(d.url)} target="_blank" rel="noreferrer" className="text-[12.5px] text-white hover:underline truncate block">{d.name}</a>
                      <div className="text-[10.5px] text-[#5B6675]">{d.size}{d.updated ? ` · ${d.updated}` : ""}{d.uploadedBy ? ` · ${d.uploadedBy}` : ""}</div>
                    </div>
                    <a href={absoluteFileUrl(d.url)} target="_blank" rel="noreferrer" title="Open" className="w-8 h-8 rounded-md flex items-center justify-center text-[#8A95A5] hover:text-white hover:bg-[#161C24] shrink-0"><ExternalLink className="w-3.5 h-3.5" /></a>
                    <button onClick={() => del(d)} disabled={busy} title="Delete" className="w-8 h-8 rounded-md flex items-center justify-center text-[#5B6675] hover:text-[#EF4444] hover:bg-[#EF4444]/10 disabled:opacity-50 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2 sm:pl-7">
                    <select
                      value={c.projectId}
                      onChange={(e) => setChoice((s) => ({ ...s, [d.id]: { ...c, projectId: e.target.value } }))}
                      className="flex-1 min-w-0 h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]"
                    >
                      {projects.length === 0 && <option value="">No projects yet</option>}
                      {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <select
                      value={c.category}
                      onChange={(e) => setChoice((s) => ({ ...s, [d.id]: { ...c, category: e.target.value as DocCategory } }))}
                      className="flex-1 min-w-0 h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]"
                    >
                      {FOLDERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                    <button onClick={() => file(d)} disabled={busy || !projects.length} className="h-9 px-3.5 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[12px] flex items-center justify-center gap-1.5 disabled:opacity-60 shrink-0">
                      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderInput className="w-3.5 h-3.5" />} File into project
                    </button>
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && <div className="px-4 py-8 text-center text-[12px] text-[#5B6675]">Nothing matches that search.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
