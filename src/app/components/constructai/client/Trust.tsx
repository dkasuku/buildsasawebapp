// Trust score shown to clients choosing a company, and the client's star rating.
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, ShieldCheck, Star, X } from "lucide-react";
import { clientApi, type Trust } from "./clientData";

const tone = (s: number) => (s >= 75 ? "text-[#22C55E] bg-[#22C55E]/10 border-[#22C55E]/30" : s >= 50 ? "text-[#F59E0B] bg-[#F59E0B]/10 border-[#F59E0B]/30" : "text-[#EF4444] bg-[#EF4444]/10 border-[#EF4444]/30");

/** "86% trusted" with the breakdown underneath when `detail` is set. */
export function TrustBadge({ t, detail }: { t?: Trust; detail?: boolean }) {
  if (!t || t.score === null) return <span className="text-[10.5px] px-2 py-0.5 rounded-full border border-[#222A35] text-[#8A95A5]" title="Not enough history on Buildsasa yet">New on Buildsasa</span>;
  const why = [
    t.parts.logs !== null && `Daily logs ${t.parts.logs}% (${t.logDays30} site-days logged in 30 days)`,
    t.parts.handover !== null && `Handovers ${t.parts.handover}% (${t.handedOver} handed over)`,
    t.parts.rating !== null && `Client rating ${t.ratingAvg}/5 from ${t.ratingCount} client${t.ratingCount > 1 ? "s" : ""}`,
  ].filter(Boolean) as string[];
  return (
    <span className="inline-flex flex-col gap-1">
      <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border w-max ${tone(t.score)}`} title={why.join(" · ")}>
        <ShieldCheck className="w-3.5 h-3.5" /> {t.score}% trusted
      </span>
      {detail && <span className="text-[10.5px] text-[#8A95A5] leading-snug">{why.join(" · ")}</span>}
    </span>
  );
}

export function Stars({ value, onChange, size = 5 }: { value: number; onChange?: (n: number) => void; size?: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" disabled={!onChange} onClick={() => onChange?.(n)} aria-label={`${n} star${n > 1 ? "s" : ""}`} className={onChange ? "cursor-pointer" : "cursor-default"}>
          <Star style={{ width: size * 4, height: size * 4 }} className={n <= value ? "fill-[#F59E0B] text-[#F59E0B]" : "text-[#2C3744]"} />
        </button>
      ))}
    </span>
  );
}

/** Rate a company the client worked with. Lower ratings lower its trust score. */
export function RateDialog({ companyId, companyName, initial, onClose, onDone }: { companyId: string; companyName: string; initial?: number | null; onClose: () => void; onDone?: () => void }) {
  const [stars, setStars] = useState(initial || 0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!stars) return toast.error("Choose 1 to 5 stars.");
    setBusy(true);
    try { await clientApi.rateCompany(companyId, stars, comment.trim() || undefined); toast.success("Thank you. Your rating helps other clients."); onDone?.(); onClose(); }
    catch (e: any) { toast.error(e?.message || "Couldn't save your rating."); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[70] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-[#222A35] bg-[#11161D] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between"><div className="text-[15px] font-display">Rate {companyName}</div><button onClick={onClose} className="text-[#8A95A5]"><X className="w-4 h-4" /></button></div>
        <p className="text-[12px] text-[#8A95A5] mt-1">How honest, timely and good was their work? Your rating counts toward the company's trust score that other clients see.</p>
        <div className="mt-4"><Stars value={stars} onChange={setStars} size={7} /></div>
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} placeholder="e.g. Sent photos every day and finished the fence on time." className="mt-3 w-full bg-[#0A0E14] border border-[#222A35] rounded-md px-3 py-2 text-[13px] text-white placeholder:text-[#5B6675] focus:outline-none" />
        <button onClick={save} disabled={busy} className="mt-3 w-full h-10 rounded-md bg-[#FF6B1A] text-white text-[13px] inline-flex items-center justify-center gap-1.5 disabled:opacity-60">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Save rating</button>
      </div>
    </div>
  );
}
