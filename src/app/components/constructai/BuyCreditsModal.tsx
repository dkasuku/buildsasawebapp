// Out of Sasa Credits or past today's AI allowance: instead of "come back
// tomorrow", offer a credit pack right there (M-Pesa or card through Paystack).
// Opens on its own when any API call answers 402 (see NEED_CREDITS_EVENT in
// services/api), and confirms the payment when Paystack sends the user back.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Clock, Loader2, Sparkles, X, Zap } from "lucide-react";
import api, { NEED_CREDITS_EVENT } from "../../services/api";

type Need = { code: "DAILY_LIMIT" | "NO_CREDITS" | "TOPUP"; error: string; kind?: string; limit?: number; perExtra?: number; topup?: number; balance?: number; resetsAt?: string; packs?: { id: string; name: string; credits: number; kes: number }[]; payments?: boolean };
const KIND = { image: "AI images", document: "documents", upload: "uploads", voice: "voice messages" } as Record<string, string>;

export function BuyCreditsModal() {
  const [need, setNeed] = useState<Need | null>(null);
  const [packs, setPacks] = useState<Need["packs"]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let last = 0;
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as Need;
      // One prompt at a time, and not again straight after it was closed.
      if (Date.now() - last < 1500) return;
      last = Date.now();
      setNeed(d);
      if (d.packs?.length) setPacks(d.packs);
      else api.getCredits().then((c) => setPacks(c.packs)).catch(() => {});
    };
    window.addEventListener(NEED_CREDITS_EVENT, on);
    return () => window.removeEventListener(NEED_CREDITS_EVENT, on);
  }, []);

  // Back from Paystack after buying from this prompt (?credits=ai&reference=…).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const ref = q.get("reference") || q.get("trxref");
    if (q.get("credits") !== "ai" || !ref) return;
    window.history.replaceState({}, "", window.location.pathname);
    api.verifyCredits(ref)
      .then((r) => {
        if (r.ok) { toast.success(r.credited ? `${r.credited} Sasa Credits added. Carry on.` : "Credits already added."); window.dispatchEvent(new Event("buildsasa:credits-updated")); }
        else toast("Payment wasn't completed. You haven't been charged.", { duration: 5000 });
      })
      .catch(() => toast.error("We couldn't confirm that payment. If you were charged, contact support."));
  }, []);

  if (!need) return null;
  const buy = async (id: string) => {
    setBusy(id);
    try { const r = await api.buyCredits(id, "ai"); if (r.authorizationUrl) { window.location.href = r.authorizationUrl; return; } }
    catch (e: any) { toast.error(e?.message || "The payment couldn't be started."); }
    setBusy(null);
  };
  const daily = need.code === "DAILY_LIMIT";
  const what = KIND[need.kind || ""] || "AI";
  const resets = need.resetsAt ? new Date(need.resetsAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "midnight";

  return (
    <div className="fixed inset-0 z-[90] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setNeed(null)} role="dialog" aria-modal="true" aria-label="Buy Sasa Credits">
      <div onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-[#222A35] bg-[#11161D] shadow-2xl p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#FF6B1A]/15 border border-[#FF6B1A]/30 flex items-center justify-center shrink-0"><Zap className="w-5 h-5 text-[#FF6B1A]" /></div>
          <div className="min-w-0 flex-1">
            <div className="text-[16px] text-white font-display">{daily ? `Today's ${what} are used up` : need.code === "TOPUP" ? "Top up Sasa Credits" : "You're out of Sasa Credits"}</div>
            <p className="text-[12.5px] text-[#8A95A5] mt-1 leading-relaxed">{need.error}</p>
          </div>
          <button onClick={() => setNeed(null)} className="text-[#8A95A5] hover:text-white" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        {daily && <div className="mt-3 text-[12px] text-[#C2CAD6] flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-[#8A95A5]" /> Free again at {resets}{need.perExtra ? ` · or ${need.perExtra} credit${need.perExtra === 1 ? "" : "s"} each now` : ""}</div>}
        <div className="mt-4 space-y-2">
          {(packs || []).map((p) => (
            <button key={p.id} onClick={() => buy(p.id)} disabled={!!busy || need.payments === false}
              className="w-full flex items-center gap-3 rounded-xl border border-[#222A35] bg-[#0A0E14] hover:border-[#FF6B1A]/60 px-3.5 py-3 text-left disabled:opacity-60">
              <Sparkles className="w-4 h-4 text-[#FF8A47] shrink-0" />
              <span className="flex-1 min-w-0"><span className="block text-[13.5px] text-white">{p.credits.toLocaleString()} credits <span className="text-[11.5px] text-[#8A95A5]">· {p.name}</span></span>
                <span className="block text-[11px] text-[#5B6675]">Never expire{daily && need.perExtra ? ` · about ${Math.floor(p.credits / need.perExtra).toLocaleString()} more ${what}` : ""}</span></span>
              <span className="text-[13px] text-white tabular-nums">{busy === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : `KES ${p.kes.toLocaleString()}`}</span>
            </button>
          ))}
          {!packs?.length && <div className="text-[12px] text-[#5B6675] flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading packs…</div>}
        </div>
        <div className="mt-3 text-[11px] text-[#5B6675]">{need.payments === false ? "Online payments aren't switched on yet. Contact Buildsasa support to add credits." : "Pay by M-Pesa or card. Credits are added as soon as the payment goes through, and you come straight back here."}</div>
      </div>
    </div>
  );
}
