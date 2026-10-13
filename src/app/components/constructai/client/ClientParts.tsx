// Building blocks shared by the client app and the contractor's Client tab:
// picking photos/videos (one or many), showing them, the stage-by-stage
// progress feed, and the chat thread.
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, CheckCircle2, ClipboardCheck, Flag, AlertTriangle, FileText, Loader2, MessageSquare, Paperclip, Play, Send, Trash2, X } from "lucide-react";
import api from "../../../services/api";
import { ImageLightbox } from "../ImageLightbox";
import { MAX_VIDEO_MB } from "../../../services/uploadPolicy";
import { STAGES, stageLabel, toMedia, when, type ClientComment, type ClientMessage, type ClientUpdate, type Media } from "./clientData";

/** Pick one or many photos and short videos; uploads them and reports the URLs. */
export function MediaPicker({ value, onChange, compact, docs }: { value: Media[]; onChange: (m: Media[]) => void; compact?: boolean; /** Also allow PDFs and Office documents (reports, drawings, proposals). */ docs?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const pick = async (files: FileList | null) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    setBusy(0.01);
    try {
      const { urls, failed } = await api.uploadFiles(list, (p) => setBusy(Math.max(0.01, p)));
      const ok = list.filter((f) => !failed.some((x) => x.name === f.name)).map((f) => f.name);
      if (urls.length) onChange([...value, ...toMedia(urls, ok)]);
      failed.forEach((f) => toast.error(`${f.name}: ${f.error}`));
    } catch (e: any) { toast.error(e?.message || "Upload failed. Check your connection and try again."); }
    finally { setBusy(0); if (ref.current) ref.current.value = ""; }
  };
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
          {value.map((m, i) => (
            <div key={m.url} className="relative aspect-square rounded-md overflow-hidden bg-[#0A0E14] border border-[#222A35]">
              {m.type === "file" ? <div className="w-full h-full flex flex-col items-center justify-center p-1 text-[9px] text-[#C2CAD6] text-center"><FileText className="w-5 h-5 text-[#FF6B1A] mb-0.5" /><span className="line-clamp-2 break-all">{m.name || "Document"}</span></div>
                : m.type === "video" ? <video src={m.url} className="w-full h-full object-cover" muted /> : <img src={m.url} alt="" className="w-full h-full object-cover" />}
              {m.type === "video" && <Play className="absolute inset-0 m-auto w-5 h-5 text-white drop-shadow" />}
              <button type="button" onClick={() => onChange(value.filter((_, k) => k !== i))} className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center" aria-label="Remove"><X className="w-3 h-3" /></button>
            </div>
          ))}
        </div>
      )}
      <input ref={ref} type="file" accept={docs ? "image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.dwg,.dxf" : "image/*,video/*"} multiple className="hidden" onChange={(e) => pick(e.target.files)} />
      <button type="button" disabled={!!busy} onClick={() => ref.current?.click()}
        className={`${compact ? "h-9 w-9 justify-center" : "h-9 px-3"} rounded-md border border-[#222A35] bg-[#0A0E14] text-[12px] text-[#C2CAD6] hover:text-white hover:border-[#2C3744] inline-flex items-center gap-1.5 disabled:opacity-60`}
        title={`Attach ${docs ? "photos, short videos or documents" : "photos or short videos"} (one or many; videos up to ${MAX_VIDEO_MB} MB, photos 15 MB, documents 25 MB)`}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : compact ? <Paperclip className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
        {!compact && (busy ? `Uploading ${Math.round(busy * 100)}%` : docs ? "Add photos, videos or files" : "Add photos / videos")}
      </button>
    </div>
  );
}

/** Thumbnails that open full screen; videos play inline in the viewer. */
export function MediaGrid({ media: all, max = 12 }: { media: Media[]; max?: number }) {
  const [open, setOpen] = useState<number | null>(null);
  const files = all.filter((m) => m.type === "file");
  const media = all.filter((m) => m.type !== "file");
  const chips = files.length > 0 && (
    <div className="flex flex-wrap gap-1.5 mt-1.5">{files.map((f) => (
      <a key={f.url} href={f.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-[#222A35] bg-[#0A0E14] text-[11.5px] text-[#C2CAD6] hover:text-white max-w-full"><FileText className="w-4 h-4 text-[#FF6B1A] shrink-0" /><span className="truncate">{f.name || decodeURIComponent(f.url.split("/").pop() || "Document").replace(/^\d+-\w+-?/, "")}</span></a>
    ))}</div>
  );
  if (!media.length) return chips || null;
  const shown = media.slice(0, max);
  return (
    <>
      <div className={`grid gap-1.5 ${media.length === 1 ? "grid-cols-1 max-w-md" : media.length === 2 ? "grid-cols-2 max-w-lg" : "grid-cols-3 sm:grid-cols-4"}`}>
        {shown.map((m, i) => (
          <button key={m.url + i} type="button" onClick={() => setOpen(i)} className={`relative rounded-lg overflow-hidden bg-[#0A0E14] border border-[#222A35] ${media.length === 1 ? "aspect-video" : "aspect-square"}`}>
            {m.type === "video" ? <video src={m.url} className="w-full h-full object-cover" muted preload="metadata" /> : <img src={m.url} alt="" loading="lazy" className="w-full h-full object-cover" />}
            {m.type === "video" && <span className="absolute inset-0 flex items-center justify-center"><span className="w-9 h-9 rounded-full bg-black/60 flex items-center justify-center"><Play className="w-4 h-4 text-white" /></span></span>}
            {i === max - 1 && media.length > max && <span className="absolute inset-0 bg-black/60 text-white text-[15px] flex items-center justify-center">+{media.length - max}</span>}
          </button>
        ))}
      </div>
      {open !== null && <ImageLightbox images={media.map((m) => m.url)} videoUrls={media.filter((m) => m.type === "video").map((m) => m.url)} startIndex={open} onClose={() => setOpen(null)} />}
      {chips}
    </>
  );
}

const KIND_ICON: Record<string, any> = { progress: Camera, inspection: ClipboardCheck, milestone: Flag, issue: AlertTriangle, report: FileText, document: FileText };
const KIND_TONE: Record<string, string> = { progress: "text-[#3B82F6] bg-[#3B82F6]/10", inspection: "text-[#8B5CF6] bg-[#8B5CF6]/10", milestone: "text-[#22C55E] bg-[#22C55E]/10", issue: "text-[#F59E0B] bg-[#F59E0B]/10", report: "text-[#FF6B1A] bg-[#FF6B1A]/10", document: "text-[#8A95A5] bg-[#8A95A5]/10" };

/** Stage chips with counts, then the updates newest first. */
export function UpdateFeed({ updates, onDelete, empty, renderComments }: { updates: ClientUpdate[]; onDelete?: (u: ClientUpdate) => void; empty?: string; renderComments?: (u: ClientUpdate) => React.ReactNode }) {
  const [stage, setStage] = useState("all");
  const counts = useMemo(() => updates.reduce<Record<string, number>>((m, u) => ((m[u.stage] = (m[u.stage] || 0) + 1), m), {}), [updates]);
  const list = stage === "all" ? updates : updates.filter((u) => u.stage === stage);
  if (!updates.length) return <div className="rounded-xl border border-dashed border-[#2C3744] bg-[#11161D] p-8 text-center text-[12.5px] text-[#8A95A5]">{empty || "No updates shared yet."}</div>;
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        <Chip on={stage === "all"} onClick={() => setStage("all")}>All stages · {updates.length}</Chip>
        {STAGES.filter((s) => counts[s.key]).map((s) => <Chip key={s.key} on={stage === s.key} onClick={() => setStage(s.key)}>{s.label} · {counts[s.key]}</Chip>)}
      </div>
      {list.map((u) => {
        const Icon = KIND_ICON[u.kind] || Camera;
        return (
          <article key={u.id} className="rounded-xl border border-[#222A35] bg-[#11161D] p-4">
            <div className="flex items-start gap-3">
              <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${KIND_TONE[u.kind] || KIND_TONE.progress}`}><Icon className="w-4 h-4" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-[13.5px] text-white font-medium">{u.title}</span>
                  <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-[#FF6B1A]/10 text-[#FF6B1A]">{stageLabel(u.stage)}</span>
                </div>
                <div className="text-[11px] text-[#5B6675] mt-0.5">{u.authorName || "Site team"}{u.authorRole ? ` · ${u.authorRole}` : ""} · {when(u.createdAt)}</div>
              </div>
              {onDelete && <button onClick={() => onDelete(u)} className="text-[#5B6675] hover:text-[#EF4444] p-1" title="Remove this update"><Trash2 className="w-4 h-4" /></button>}
            </div>
            {u.body && <p className="text-[12.5px] text-[#C2CAD6] mt-2.5 whitespace-pre-wrap leading-relaxed">{u.body}</p>}
            {u.media.length > 0 && <div className="mt-3"><MediaGrid media={u.media} /></div>}
            {renderComments && renderComments(u)}
          </article>
        );
      })}
    </div>
  );
}

/** Comments under any shared item. The client asks for a change or an improvement
 *  (with photos); the team replies. Collapsed to a count until opened. */
export function CommentThread({ comments, onSend, mineType, prompt }: { comments: ClientComment[]; onSend: (body: string, media: Media[]) => Promise<unknown>; mineType: "client" | "team"; prompt?: string }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [media, setMedia] = useState<Media[]>([]);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!body.trim() && !media.length) return;
    setBusy(true);
    try { await onSend(body.trim(), media); setBody(""); setMedia([]); }
    catch (e: any) { toast.error(e?.message || "Comment not sent."); }
    finally { setBusy(false); }
  };
  return (
    <div className="mt-3 border-t border-[#222A35] pt-2">
      <button type="button" onClick={() => setOpen(!open)} className="inline-flex items-center gap-1.5 text-[12px] text-[#8A95A5] hover:text-white">
        <MessageSquare className="w-4 h-4" /> {comments.length ? `${comments.length} comment${comments.length > 1 ? "s" : ""}` : mineType === "client" ? "Comment or ask for a change" : "Comments"}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {comments.map((c) => (
            <div key={c.id} className={`rounded-lg px-3 py-2 text-[12.5px] ${c.authorType === mineType ? "bg-[#FF6B1A]/10" : "bg-[#161C24]"}`}>
              <div className="text-[10.5px] text-[#8A95A5]">{c.authorName}{c.authorType === "client" ? " · Client" : ""} · {when(c.createdAt)}</div>
              {c.body && <div className="text-[#E5E9F0] whitespace-pre-wrap mt-0.5">{c.body}</div>}
              {c.media.length > 0 && <div className="mt-1.5"><MediaGrid media={c.media} max={6} /></div>}
            </div>
          ))}
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder={prompt || (mineType === "client" ? "e.g. Please move the gate 2 metres to the left, see my photo." : "e.g. Noted, we'll move it on Monday.")} className="w-full bg-[#0A0E14] border border-[#222A35] rounded-md px-3 py-2 text-[12.5px] text-white placeholder:text-[#5B6675] focus:outline-none" />
          <div className="flex flex-wrap items-start gap-2">
            <MediaPicker value={media} onChange={setMedia} />
            <button type="button" onClick={send} disabled={busy || (!body.trim() && !media.length)} className="h-9 px-3 rounded-md bg-[#FF6B1A] text-white text-[12px] inline-flex items-center gap-1.5 disabled:opacity-50">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={`shrink-0 h-8 px-3 rounded-full text-[11.5px] border ${on ? "bg-[#FF6B1A] border-[#FF6B1A] text-white" : "border-[#222A35] bg-[#11161D] text-[#8A95A5] hover:text-white"}`}>{children}</button>;
}

/** A chat thread that polls every 8 seconds while open. `mine` decides which side a message sits on. */
export function ChatThread({ load, send, mine, placeholder, height = "h-[60vh]" }: {
  load: () => Promise<ClientMessage[]>; send: (body: string, media: Media[]) => Promise<ClientMessage>;
  mine: (m: ClientMessage) => boolean; placeholder?: string; height?: string;
}) {
  const [msgs, setMsgs] = useState<ClientMessage[] | null>(null);
  const [body, setBody] = useState("");
  const [media, setMedia] = useState<Media[]>([]);
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const loadRef = useRef(load); loadRef.current = load;
  useEffect(() => {
    let alive = true;
    const tick = () => loadRef.current().then((m) => alive && setMsgs(m)).catch(() => alive && setMsgs((x) => x || []));
    tick();
    const t = setInterval(tick, 8000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const count = msgs?.length || 0;
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [count]);
  const submit = async () => {
    if (!body.trim() && !media.length) return;
    setSending(true);
    try { const m = await send(body.trim(), media); setMsgs((x) => [...(x || []), m]); setBody(""); setMedia([]); }
    catch (e: any) { toast.error(e?.message || "Message not sent. Try again."); }
    finally { setSending(false); }
  };
  return (
    <div className={`rounded-xl border border-[#222A35] bg-[#11161D] flex flex-col ${height} min-h-[360px]`}>
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {msgs === null && <div className="text-center text-[12px] text-[#5B6675] py-8"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Loading messages…</div>}
        {msgs && msgs.length === 0 && <div className="text-center text-[12px] text-[#5B6675] py-8">No messages yet. Say hello, ask a question, or send photos.</div>}
        {msgs?.map((m) => {
          const me = mine(m);
          return (
            <div key={m.id} className={`flex ${me ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-3 py-2 ${me ? "bg-[#FF6B1A] text-white rounded-br-md" : "bg-[#161C24] text-[#E5E9F0] rounded-bl-md"}`}>
                {!me && <div className="text-[10.5px] font-medium text-[#FF8A47] mb-0.5">{m.senderName}{m.senderType === "buildsasa" ? " · Buildsasa" : ""}</div>}
                {m.body && <div className="text-[12.5px] whitespace-pre-wrap break-words">{m.body}</div>}
                {m.media.length > 0 && <div className="mt-1.5 min-w-[180px]"><MediaGrid media={m.media} max={9} /></div>}
                <div className={`text-[9.5px] mt-1 ${me ? "text-white/70" : "text-[#5B6675]"}`}>{when(m.createdAt)}</div>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <div className="border-t border-[#222A35] p-2 space-y-2">
        {media.length > 0 && <MediaPicker value={media} onChange={setMedia} />}
        <div className="flex items-end gap-2">
          {media.length === 0 && <MediaPicker value={media} onChange={setMedia} compact />}
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={1} placeholder={placeholder || "Write a message…"}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            className="flex-1 min-h-9 max-h-32 resize-y bg-[#0A0E14] border border-[#222A35] rounded-md px-3 py-2 text-[12.5px] text-white focus:outline-none focus:border-[#FF6B1A]/50" />
          <button onClick={submit} disabled={sending || (!body.trim() && !media.length)} className="h-9 w-9 rounded-md bg-[#FF6B1A] text-white flex items-center justify-center disabled:opacity-50" aria-label="Send">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Done({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-1.5 text-[12px] text-[#22C55E]"><CheckCircle2 className="w-4 h-4" />{children}</div>;
}
