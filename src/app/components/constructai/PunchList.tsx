import { useEffect, useState, useRef } from "react";
import { toast } from "sonner";
import { CheckCircle, AlertCircle, Plus, Trash2, Camera, Video, MapPin, Paperclip, X, Bell, User } from "lucide-react";
import api from "../../services/api";
import type { PunchDto } from "../../services/api";

type PunchRow = PunchDto & { _localPhotos?: string[]; _localVideos?: string[]; _expanded?: boolean };
const USERS = ["Alice", "Bob", "Carlos", "Diana"];

export function PunchList() {
  const [items, setItems] = useState<PunchRow[]>([]);
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [form, setForm] = useState<Partial<PunchRow>>({ code: "", area: "", desc: "", status: "Open", photos: null, videos: null, assignedTo: null, location: null, drawingRef: null, linkedTaskId: null });
  const [uploading, setUploading] = useState<string | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.getProjects().then((ps) => {
      const pid = ps[0]?.id || ps[0]?.code;
      if (!pid) return;
      setProjectId(pid);
      api.getPunch(pid).then(setItems).catch(() => {});
    });
  }, []);

  const parsePhotos = (row: PunchRow) => { try { return JSON.parse(row.photos || "[]") as string[]; } catch { return []; } };
  const parseVideos = (row: PunchRow) => { try { return JSON.parse(row.videos || "[]") as string[]; } catch { return []; } };

  const uploadFile = async (file: File, itemId?: string) => {
    setUploading(itemId || "new");
    try {
      const { url, publicUrl } = await api.presignUpload(file.name, file.type);
      await fetch(url, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      return publicUrl;
    } catch (e: any) {
      toast.error("Upload failed: " + (e.message || "Unknown"));
      return null;
    } finally {
      setUploading(null);
    }
  };

  const attachPhoto = async (file: File, itemId?: string) => {
    const url = await uploadFile(file, itemId);
    if (!url) return;
    if (!itemId) {
      setForm((s) => ({ ...s, photos: JSON.stringify([...(parsePhotos(s as any)), url]) }));
    } else {
      setItems((prev) => prev.map((r) => r.id === itemId ? { ...r, photos: JSON.stringify([...parsePhotos(r), url]) } : r));
    }
  };

  const attachVideo = async (file: File, itemId?: string) => {
    const url = await uploadFile(file, itemId);
    if (!url) return;
    if (!itemId) {
      setForm((s) => ({ ...s, videos: JSON.stringify([...(parseVideos(s as any)), url]) }));
    } else {
      setItems((prev) => prev.map((r) => r.id === itemId ? { ...r, videos: JSON.stringify([...parseVideos(r), url]) } : r));
    }
  };

  const removePhoto = (url: string, itemId?: string) => {
    if (!itemId) {
      const arr = parsePhotos(form as any).filter((u) => u !== url);
      setForm((s) => ({ ...s, photos: arr.length ? JSON.stringify(arr) : null }));
    } else {
      setItems((prev) => prev.map((r) => {
        if (r.id !== itemId) return r;
        const arr = parsePhotos(r).filter((u) => u !== url);
        return { ...r, photos: arr.length ? JSON.stringify(arr) : null };
      }));
    }
  };

  const removeVideo = (url: string, itemId?: string) => {
    if (!itemId) {
      const arr = parseVideos(form as any).filter((u) => u !== url);
      setForm((s) => ({ ...s, videos: arr.length ? JSON.stringify(arr) : null }));
    } else {
      setItems((prev) => prev.map((r) => {
        if (r.id !== itemId) return r;
        const arr = parseVideos(r).filter((u) => u !== url);
        return { ...r, videos: arr.length ? JSON.stringify(arr) : null };
      }));
    }
  };

  const sendAssigneeNotification = async (row: PunchRow) => {
    if (!projectId || !row.assignedTo) return;
    try {
      await api.createTaskMessage(projectId, { text: `You were assigned to punch item ${row.code}: ${row.desc}`, taskType: "punch", taskId: row.id });
      toast.success(`Notification sent to ${row.assignedTo}`);
    } catch { /* ignore */ }
  };

  const add = async () => {
    if (!projectId) return;
    const payload = { ...form } as any;
    setForm({ code: "", area: "", desc: "", status: "Open", photos: null, videos: null, assignedTo: null, location: null, drawingRef: null, linkedTaskId: null });
    try {
      const row = await api.createPunch(projectId, payload);
      setItems((prev) => [{ ...row, _expanded: false } as PunchRow, ...prev]);
      if (row.assignedTo) sendAssigneeNotification(row as any);
    } catch {
      setItems((prev) => [{ ...payload, id: String(Date.now()), _expanded: false } as PunchRow, ...prev]);
    }
  };

  const del = async (id?: string) => {
    if (!projectId || !id) return;
    setItems((prev) => prev.filter((r) => r.id !== id));
    try { await api.deletePunch(projectId, id); } catch { /* ignore */ }
  };

  const save = async (row: PunchRow) => {
    if (!projectId || !row.id) return;
    try {
      await api.updatePunch(projectId, row.id, row);
      if (row.assignedTo) sendAssigneeNotification(row);
    } catch { /* ignore */ }
  };

  const toggleExpand = (id: string) => setItems((prev) => prev.map((r) => r.id === id ? { ...r, _expanded: !r._expanded } : r));

  const MediaThumb = ({ url, onRemove }: { url: string; onRemove: () => void }) => (
    <div className="relative group shrink-0">
      {url.match(/\.(mp4|webm|mov)$/i) ? (
        <video src={url} className="w-14 h-14 rounded border border-[#222A35] object-cover" muted />
      ) : (
        <img src={url} alt="" className="w-14 h-14 rounded border border-[#222A35] object-cover" />
      )}
      <button onClick={onRemove} className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#EF4444] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition"><X className="w-2.5 h-2.5" /></button>
    </div>
  );

  return (
    <div className="px-4 sm:px-7 py-5 space-y-4 max-w-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="text-[13px] text-white font-display">Punch List</div>
          <div className="text-[11px] text-[#8A95A5]">Deficiencies and closeouts</div>
        </div>
      </div>

      {/* Add form */}
      <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-3 space-y-2">
        <div className="flex flex-wrap gap-2">
          <input value={form.code || ""} onChange={(e) => setForm((s) => ({ ...s, code: e.target.value }))} placeholder="ID" className="h-9 w-24 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white" />
          <input value={form.area || ""} onChange={(e) => setForm((s) => ({ ...s, area: e.target.value }))} placeholder="Area" className="h-9 flex-1 min-w-[120px] bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white" />
          <input value={form.location || ""} onChange={(e) => setForm((s) => ({ ...s, location: e.target.value }))} placeholder="Location" className="h-9 flex-1 min-w-[120px] bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white" />
          <select value={form.status || "Open"} onChange={(e) => setForm((s) => ({ ...s, status: e.target.value }))} className="h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white">
            <option>Open</option><option>In Progress</option><option>Closed</option>
          </select>
          <select value={form.assignedTo || ""} onChange={(e) => setForm((s) => ({ ...s, assignedTo: e.target.value || null }))} className="h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white">
            <option value="">Assignee</option>
            {USERS.map((u) => (<option key={u} value={u}>{u}</option>))}
          </select>
        </div>
        <textarea value={form.desc || ""} onChange={(e) => setForm((s) => ({ ...s, desc: e.target.value }))} placeholder="Description" className="w-full bg-[#0A0E14] border border-[#222A35] rounded-md px-2 py-2 text-[12px] text-white" rows={2} />
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => photoRef.current?.click()} disabled={uploading === "new" || parsePhotos(form as any).length >= 10} className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] border border-[#222A35] text-[#8A95A5] hover:text-white disabled:opacity-40">
            <Camera className="w-3 h-3" /> Photo {parsePhotos(form as any).length}/10
          </button>
          <button onClick={() => videoRef.current?.click()} disabled={uploading === "new" || parseVideos(form as any).length >= 3} className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] border border-[#222A35] text-[#8A95A5] hover:text-white disabled:opacity-40">
            <Video className="w-3 h-3" /> Video {parseVideos(form as any).length}/3
          </button>
          <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) attachPhoto(f); e.currentTarget.value = ""; }} />
          <input ref={videoRef} type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) attachVideo(f); e.currentTarget.value = ""; }} />
          <div className="flex flex-wrap gap-1.5">
            {parsePhotos(form as any).map((url) => (<MediaThumb key={url} url={url} onRemove={() => removePhoto(url)} />))}
            {parseVideos(form as any).map((url) => (<MediaThumb key={url} url={url} onRemove={() => removeVideo(url)} />))}
          </div>
          <button onClick={add} className="ml-auto h-9 px-3 rounded-md bg-[#FF6B1A] text-white text-[12px] flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>
      </div>

      {/* List */}
      <div className="rounded-xl border border-[#222A35] bg-[#11161D] divide-y divide-[#222A35]">
        {items.map((i, idx) => (
          <div key={i.id || i.code} className="p-3 sm:p-4 text-[12px] text-white">
            <div className="flex items-start gap-3">
              <button onClick={() => toggleExpand(i.id!)} className="w-9 h-9 rounded-md bg-[#161C24] flex items-center justify-center shrink-0 mt-0.5">
                {i.status === "Closed" ? <CheckCircle className="w-4 h-4 text-[#22C55E]" /> : <AlertCircle className="w-4 h-4 text-[#F97316]" />}
              </button>
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex flex-wrap gap-2 items-center">
                  <input value={i.code} onChange={(e) => setItems((prev) => prev.map((r, j) => j === idx ? { ...r, code: e.target.value } : r))} className="bg-transparent border border-[#222A35] rounded px-2 py-1 text-[12px] text-white w-24" />
                  <input value={i.area} onChange={(e) => setItems((prev) => prev.map((r, j) => j === idx ? { ...r, area: e.target.value } : r))} className="bg-transparent border border-[#222A35] rounded px-2 py-1 text-[12px] text-white flex-1 min-w-[100px]" />
                  <select value={i.status} onChange={(e) => setItems((prev) => prev.map((r, j) => j === idx ? { ...r, status: e.target.value } : r))} className={`text-[11px] px-2 py-1 rounded-full border border-[#222A35] bg-[#0A0E14] ${i.status === "Closed" ? "text-[#22C55E]" : "text-[#F97316]"}`}>
                    <option>Open</option><option>In Progress</option><option>Closed</option>
                  </select>
                </div>
                <textarea value={i.desc} onChange={(e) => setItems((prev) => prev.map((r, j) => j === idx ? { ...r, desc: e.target.value } : r))} className="w-full bg-transparent border border-[#222A35] rounded px-2 py-1 text-[12px] text-white" rows={2} />
                {i._expanded && (
                  <div className="space-y-2 pt-1">
                    <div className="flex flex-wrap gap-2">
                      <input value={i.location || ""} onChange={(e) => setItems((prev) => prev.map((r, j) => j === idx ? { ...r, location: e.target.value || null } : r))} placeholder="Location" className="bg-[#0A0E14] border border-[#222A35] rounded px-2 py-1 text-[11px] text-white flex-1 min-w-[120px]" />
                      <select value={i.assignedTo || ""} onChange={(e) => setItems((prev) => prev.map((r, j) => j === idx ? { ...r, assignedTo: e.target.value || null } : r))} className="bg-[#0A0E14] border border-[#222A35] rounded px-2 py-1 text-[11px] text-white">
                        <option value="">Assignee</option>
                        {USERS.map((u) => (<option key={u} value={u}>{u}</option>))}
                      </select>
                      <input value={i.linkedTaskId || ""} onChange={(e) => setItems((prev) => prev.map((r, j) => j === idx ? { ...r, linkedTaskId: e.target.value || null } : r))} placeholder="Linked task ID" className="bg-[#0A0E14] border border-[#222A35] rounded px-2 py-1 text-[11px] text-white w-32" />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button onClick={() => photoRef.current?.click()} disabled={uploading === i.id || parsePhotos(i).length >= 10} className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] border border-[#222A35] text-[#8A95A5] hover:text-white disabled:opacity-40">
                        <Camera className="w-3 h-3" /> {parsePhotos(i).length}/10
                      </button>
                      <button onClick={() => videoRef.current?.click()} disabled={uploading === i.id || parseVideos(i).length >= 3} className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] border border-[#222A35] text-[#8A95A5] hover:text-white disabled:opacity-40">
                        <Video className="w-3 h-3" /> {parseVideos(i).length}/3
                      </button>
                      <div className="flex flex-wrap gap-1.5">
                        {parsePhotos(i).map((url) => (<MediaThumb key={url} url={url} onRemove={() => removePhoto(url, i.id)} />))}
                        {parseVideos(i).map((url) => (<MediaThumb key={url} url={url} onRemove={() => removeVideo(url, i.id)} />))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1.5 shrink-0">
                {i.id && projectId && (
                  <>
                    <button onClick={() => save(i)} className="text-[11px] text-[#8A95A5] hover:text-white px-2 py-1 rounded border border-[#222A35]">Save</button>
                    <button onClick={() => del(i.id)} className="text-[11px] text-[#FF6B1A] hover:underline flex items-center gap-1 px-2 py-1"><Trash2 className="w-3 h-3" /> Del</button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
