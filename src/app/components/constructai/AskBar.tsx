// The "ask AI" bar at the top of every module page. Typing here (or attaching
// a photo with +) opens the Buildsasa AI page with the question already sent.
import { useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowUp, Loader2, Mic, Plus, Sparkles, Square, X } from "lucide-react";
import api from "../../services/api";
import { useVoice } from "./MediaInputs";

export function AskBar({ title, hint, onAsk }: { title: string; hint: string; onAsk: (text: string, images: string[]) => void }) {
  const [q, setQ] = useState("");
  const [img, setImg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const attach = async (list: FileList | null) => {
    const f = Array.from(list || []).find((x) => x.type.startsWith("image/"));
    if (!f) return;
    setBusy(true);
    try {
      const { urls, failed } = await api.uploadFiles([f]);
      failed.forEach((x) => toast.error(`${x.name}: ${x.error}`));
      if (urls[0]) setImg(urls[0]);
    } catch (e: any) { toast.error(e?.message || "Upload failed. Try again."); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  // Talk instead of typing: the words go straight to the AI.
  const voice = useVoice((t) => onAsk(t, img ? [img] : []));
  const go = () => {
    const text = q.trim();
    if ((!text && !img) || busy) return;
    onAsk(text, img ? [img] : []);
    setQ(""); setImg(null);
  };
  return (
    <div className="px-4 sm:px-7 pt-5 pb-1">
      <div className="max-w-2xl mx-auto">
        <div className="text-center text-[17px] sm:text-[19px] text-white font-display mb-2.5">{title}</div>
        <div className="flex items-center gap-2 h-12 pl-2 pr-1.5 rounded-full border border-[#222A35] bg-[#11161D] shadow-[0_4px_18px_rgba(0,0,0,0.10)] focus-within:border-[#FF6B1A]/60 transition-colors">
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => attach(e.target.files)} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} title="Attach a photo (e.g. a raw room to redesign)" aria-label="Attach a photo"
            className="h-9 w-9 shrink-0 rounded-full text-[#8A95A5] hover:text-white hover:bg-[#161C24] flex items-center justify-center disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-[18px] h-[18px]" />}
          </button>
          {img && (
            <span className="relative w-8 h-8 shrink-0 rounded-md overflow-hidden border border-[#222A35]">
              <img src={img} alt="Attached" className="w-full h-full object-cover" />
              <button type="button" onClick={() => setImg(null)} className="absolute inset-0 bg-black/50 opacity-0 hover:opacity-100 flex items-center justify-center text-[#ffffff]" aria-label="Remove photo"><X className="w-3.5 h-3.5" /></button>
            </span>
          )}
          <Sparkles className="w-4 h-4 shrink-0 text-[#FF6B1A]" aria-hidden />
          {voice.state === "recording" ? (
            <span className="flex-1 min-w-0 text-[13.5px] text-white flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[#EF4444] animate-pulse" /> Listening… {voice.seconds}s</span>
          ) : (
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); go(); } }}
            placeholder={img ? "Describe the finish you want…" : hint} aria-label="Ask Buildsasa AI"
            className="flex-1 min-w-0 bg-transparent text-[16px] sm:text-[14px] text-white placeholder:text-[#5B6675] focus:outline-none" />
          )}
          {!q.trim() && (voice.state === "recording"
            ? <button type="button" onClick={voice.stop} aria-label="Stop and ask" className="h-9 px-3 shrink-0 rounded-full bg-[#FF6B1A] text-[#ffffff] text-[12px] inline-flex items-center gap-1.5"><Square className="w-3 h-3 fill-current" /> Ask</button>
            : <button type="button" onClick={voice.start} disabled={voice.state !== "idle" || busy} title="Ask by voice" aria-label="Ask by voice" className="h-9 w-9 shrink-0 rounded-full text-[#8A95A5] hover:text-white hover:bg-[#161C24] flex items-center justify-center disabled:opacity-50">{voice.state === "transcribing" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}</button>)}
          {(q.trim() || img || voice.state === "idle") && voice.state !== "recording" && <button type="button" onClick={go} disabled={(!q.trim() && !img) || busy} aria-label="Ask Buildsasa AI"
            className="h-9 w-9 shrink-0 rounded-full bg-[#FF6B1A] hover:bg-[#FF7E33] text-[#ffffff] flex items-center justify-center disabled:opacity-40">
            <ArrowUp className="w-4 h-4" />
          </button>}
        </div>
      </div>
    </div>
  );
}
