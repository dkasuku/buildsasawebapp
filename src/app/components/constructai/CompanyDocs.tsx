import { useState, useMemo, useRef, useEffect } from "react";
import { toast } from "sonner";
import { Plus, Search, X, FolderOpen, FileText, Download, Trash2, UploadCloud, File, FileSpreadsheet, FileImage, Shield, BookOpen, Award } from "lucide-react";
import type { Role } from "./roles";
import api, { absoluteFileUrl } from "../../services/api";
import { warnSaveFailed } from "./saveFeedback";
import { useFileUpload } from "./useFileUpload";
import { UploadTray } from "./UploadTray";

type Doc = {
  id: string;
  name: string;
  category: "Policies" | "Templates" | "Certifications" | "Insurance" | "HR" | "Legal";
  type: string;
  size: string;
  uploadedBy: string;
  date: string;
  /** Durable URL of the stored file. Older rows have none — they were recorded
   *  without the file ever being uploaded, so there is nothing to download. */
  url?: string | null;
};

const CATEGORIES: { key: Doc["category"]; icon: any }[] = [
  { key: "Policies", icon: Shield },
  { key: "Templates", icon: FileText },
  { key: "Certifications", icon: Award },
  { key: "Insurance", icon: BookOpen },
  { key: "HR", icon: FolderOpen },
  { key: "Legal", icon: FileText },
];

const fileIcon = (type: string) => {
  if (["xlsx", "xls", "csv"].includes(type)) return FileSpreadsheet;
  if (["png", "jpg", "jpeg"].includes(type)) return FileImage;
  return File;
};

export default function CompanyDocs({ role }: { role: Role }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [q, setQ] = useState("");
  const [catFilter, setCatFilter] = useState<string>("all");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploadCategory, setUploadCategory] = useState<Doc["category"]>("Policies");
  const [showUpload, setShowUpload] = useState(false);
  const uploader = useFileUpload();
  const me = (() => { try { return JSON.parse(localStorage.getItem("constructai-user") || "null")?.name || "You"; } catch { return "You"; } })();

  // Load persisted documents; the API response is authoritative (including empty)
  useEffect(() => {
    (async () => {
      try {
        const rows = await api.getCompanyDocs();
        setDocs((rows ?? []).map((r: any) => ({ id: r.id, name: r.name, category: r.category, type: r.type || "file", size: r.size || "", uploadedBy: r.uploadedBy || "", date: r.date || "", url: r.url || null })));
      } catch { /* offline — leave list empty */ }
    })();
  }, []);

  const filtered = useMemo(() => docs.filter((d) => {
    if (catFilter !== "all" && d.category !== catFilter) return false;
    if (q && !d.name.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [docs, q, catFilter]);

  const catCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    docs.forEach((d) => { counts[d.category] = (counts[d.category] || 0) + 1; });
    return counts;
  }, [docs]);

  // Upload the bytes first, then record the row with its URL — so every
  // document listed here can actually be opened and downloaded. This used to
  // record the name only and toast "Downloading…" on a file that was never stored.
  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    setShowUpload(false);
    const urls = await uploader.upload(list);
    let saved = 0;
    for (let i = 0; i < list.length; i++) {
      const f = list[i]; const url = urls[i];
      if (!url) continue;
      const row = {
        name: f.name, category: uploadCategory,
        type: f.name.split(".").pop()?.toLowerCase() || "file",
        size: f.size > 1024 * 1024 ? `${(f.size / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(f.size / 1024)} KB`,
        uploadedBy: me, date: new Date().toISOString().slice(0, 10), url,
      };
      try {
        const created: any = await api.createCompanyDoc(row);
        setDocs((prev) => [{ ...row, id: created.id }, ...prev]);
        saved += 1;
      } catch (e) { warnSaveFailed("company doc creation")(e); }
    }
    uploader.reset();
    if (saved) toast.success(`${saved} document${saved > 1 ? "s" : ""} uploaded`);
  };

  const remove = (id: string) => {
    setDocs((prev) => prev.filter((d) => d.id !== id));
    toast.success("Document deleted");
    api.deleteCompanyDoc(id).catch(warnSaveFailed("company doc deletion"));
  };

  return (
    <div className="px-4 sm:px-7 py-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-5">
        {CATEGORIES.map(({ key, icon: Icon }) => (
          <button key={key} onClick={() => setCatFilter(catFilter === key ? "all" : key)} className={`rounded-xl border p-3 text-left transition ${catFilter === key ? "border-[#FF6B1A] bg-[#FF6B1A]/5" : "border-[#222A35] bg-[#11161D] hover:border-[#2E3947]"}`}>
            <Icon className="w-4 h-4 text-[#FF6B1A]" />
            <div className="text-[11px] text-white mt-1.5">{key}</div>
            <div className="text-[10px] text-[#5B6675]">{catCounts[key] || 0} files</div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#5B6675]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company documents…" className="w-full h-9 bg-[#11161D] border border-[#222A35] rounded-lg pl-9 pr-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
        </div>
        <button onClick={() => setShowUpload(true)} className="h-9 px-4 bg-[#FF6B1A] text-black rounded-lg text-[12px] font-medium flex items-center gap-1.5"><UploadCloud className="w-3.5 h-3.5" /> Upload</button>
      </div>

      {uploader.pending.length > 0 && <div className="mb-3"><UploadTray state={uploader} /></div>}

      <div className="bg-[#11161D] border border-[#222A35] rounded-xl overflow-hidden">
        <div className="hidden sm:grid grid-cols-[1fr_120px_90px_120px_100px_40px] gap-2 px-4 py-2.5 border-b border-[#222A35] text-[10px] text-[#5B6675] uppercase tracking-wider">
          <span>Name</span><span>Category</span><span>Size</span><span>Uploaded by</span><span>Date</span><span></span>
        </div>
        {filtered.length === 0 && <div className="text-center text-[13px] text-[#5B6675] py-10">No documents match your filters.</div>}
        {filtered.map((d) => {
          const Icon = fileIcon(d.type);
          return (
            <div key={d.id} className="grid grid-cols-1 sm:grid-cols-[1fr_120px_90px_120px_100px_40px] gap-2 px-4 py-3 border-b border-[#222A35] last:border-0 hover:bg-[#161C24]/50 transition items-center group">
              {d.url ? (
                <a href={absoluteFileUrl(d.url)} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 text-left min-w-0">
                  <Icon className="w-4 h-4 text-[#FF6B1A] shrink-0" />
                  <span className="text-[12px] text-white truncate hover:underline">{d.name}</span>
                </a>
              ) : (
                <button onClick={() => toast.error("This entry was recorded without its file. Delete it and upload the document again.")} className="flex items-center gap-2.5 text-left min-w-0" title="No file stored">
                  <Icon className="w-4 h-4 text-[#5B6675] shrink-0" />
                  <span className="text-[12px] text-[#8A95A5] truncate">{d.name}</span>
                </button>
              )}
              <span className="text-[11px] text-[#8A95A5]">{d.category}</span>
              <span className="text-[11px] text-[#8A95A5]">{d.size}</span>
              <span className="text-[11px] text-[#8A95A5] truncate">{d.uploadedBy}</span>
              <span className="text-[11px] text-[#8A95A5]">{d.date}</span>
              <div className="flex items-center gap-1.5">
                {d.url
                  ? <a href={absoluteFileUrl(d.url)} download={d.name} target="_blank" rel="noreferrer" title="Download" className="text-[#5B6675] hover:text-white"><Download className="w-3.5 h-3.5" /></a>
                  : <span title="No file stored" className="text-[#3A4350]"><Download className="w-3.5 h-3.5" /></span>}
                <button onClick={() => remove(d.id)} className="text-[#5B6675] hover:text-[#EF4444]"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          );
        })}
      </div>

      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-[#11161D] border border-[#222A35] rounded-xl w-full max-w-md p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[15px] font-semibold text-white flex items-center gap-2"><UploadCloud className="w-4 h-4 text-[#FF6B1A]" /> Upload Document</h3>
              <button onClick={() => setShowUpload(false)} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <div className="text-[11px] text-[#8A95A5] mb-1.5">Category</div>
                <select value={uploadCategory} onChange={(e) => setUploadCategory(e.target.value as Doc["category"])} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-2 text-[13px] text-white">
                  {CATEGORIES.map((c) => <option key={c.key}>{c.key}</option>)}
                </select>
              </div>
              <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
              <button onClick={() => fileRef.current?.click()} className="w-full h-24 border-2 border-dashed border-[#222A35] rounded-xl flex flex-col items-center justify-center gap-1.5 text-[#8A95A5] hover:border-[#FF6B1A] hover:text-white transition">
                <UploadCloud className="w-6 h-6" />
                <span className="text-[12px]">Click to choose files</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
