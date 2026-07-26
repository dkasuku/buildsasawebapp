import { useEffect, useRef, useState } from "react";
import { FileText, UploadCloud, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import api from "../../services/api";

type DocRow = { id?: string; name: string; url: string; size: string; updated: string };

export function Documents() {
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    api.getDocuments().then(setDocs).catch(() => {});
  }, []);

  const onUpload = async (file: File) => {
    setUploading(true);
    try {
      // Was a direct browser PUT to a presigned URL whose result was never
      // checked — a blocked upload still recorded a document pointing at a file
      // that was never stored. uploadFile goes through the API and throws.
      const url = await api.uploadFile(file);
      const doc = await api.createDocument({ name: file.name, url, size: `${Math.round(file.size / 1024)} KB`, updated: "Just now" });
      setDocs((prev) => [doc, ...prev]);
    } catch (e: any) {
      toast.error(`Upload failed — ${e?.message || "unknown error"}`, { duration: 8000 });
    } finally {
      setUploading(false);
    }
  };

  const del = async (id?: string) => {
    if (!id) return;
    setDocs((prev) => prev.filter((d) => d.id !== id));
    try { await api.deleteDocument(id); } catch { /* ignore */ }
  };

  const filtered = docs.filter((d) => d.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="px-4 sm:px-7 py-5 space-y-4">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div>
          <div className="text-[13px] text-white font-display">Company Documents</div>
          <div className="text-[11px] text-[#8A95A5]">Centralized docs for all projects</div>
        </div>
        <div className="flex gap-2">
          <input type="file" ref={fileInputRef} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); }} />
          <button disabled={uploading} onClick={() => fileInputRef.current?.click()} className="h-9 px-3 rounded-md bg-[#0A0E14] border border-[#222A35] text-[12px] text-white flex items-center gap-1.5 disabled:opacity-60">
            <UploadCloud className="w-4 h-4" /> {uploading ? "Uploading..." : "Upload"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-[#222A35] bg-[#11161D]">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#222A35]">
          <Search className="w-4 h-4 text-[#5B6675]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} className="flex-1 bg-transparent outline-none text-[12px] text-white" placeholder="Search documents" />
        </div>
        <div className="divide-y divide-[#222A35]">
          {filtered.map((d) => (
            <div key={d.id || d.url} className="px-4 py-3 flex items-center justify-between text-[12px] text-white">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#5B6675]" />
                <div>
                  <div>{d.name}</div>
                  <div className="text-[11px] text-[#8A95A5]">{d.updated} · {d.size}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <a href={d.url} target="_blank" rel="noreferrer" className="text-[11px] text-[#FF6B1A] hover:underline">Open</a>
                {d.id && <button onClick={() => del(d.id)} className="text-[11px] text-[#FF6B1A] hover:underline flex items-center gap-1"><Trash2 className="w-3 h-3" /> Delete</button>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
