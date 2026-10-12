// Sasa Credits — the company's AI allowance. Shows the balance (monthly plan
// credits + top-ups that never expire), what each AI action costs, top-up packs
// paid through Paystack (M-Pesa or card), and recent usage.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Loader2, CreditCard, Clock } from "lucide-react";
import api, { type CreditsDto } from "../../services/api";

export function CreditsPanel() {
  const [data, setData] = useState<CreditsDto | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => api.getCredits().then(setData).catch(() => {});
  useEffect(() => {
    load();
    const refresh = () => load();
    window.addEventListener("buildsasa:credits-updated", refresh);
    return () => window.removeEventListener("buildsasa:credits-updated", refresh);
  }, []);

  const buy = async (packId: string) => {
    setBusy(packId);
    try {
      const r = await api.buyCredits(packId);
      if (r.authorizationUrl) { window.location.href = r.authorizationUrl; return; }
    } catch (e: any) { toast.error(e.message || "The payment couldn't be started"); }
    setBusy(null);
  };

  if (!data) return <div className="mt-7 rounded-xl border border-[#222A35] bg-[#11161D] p-5 text-[12px] text-[#5B6675] flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading Sasa Credits…</div>;
  const low = data.allowance ? data.balance <= Math.max(5, Math.round(data.allowance * 0.1)) : data.balance < 10;
  const costRows = Object.entries(data.costs || {}).filter(([, v]) => v > 0);

  return (
    <div className="mt-7" id="sasa-credits">
      <div className="text-[14px] text-white font-display mb-3 flex items-center gap-2"><Sparkles className="w-4 h-4 text-[#FF6B1A]" /> Sasa Credits <span className="text-[11px] text-[#8A95A5] font-sans">· for AI features</span></div>
      <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr]">
        <div className={`rounded-xl border p-5 ${low ? "border-[#F59E0B]/50 bg-[#F59E0B]/5" : "border-[#222A35] bg-[#11161D]"}`}>
          <div className="text-[11px] uppercase tracking-wider text-[#5B6675]">Credits available</div>
          <div className={`text-[34px] font-display leading-tight mt-1 ${low ? "text-[#FBBF24]" : "text-white"}`}>{data.balance.toLocaleString()}</div>
          <div className="text-[12px] text-[#8A95A5] mt-1">{data.plan.toLocaleString()} from your monthly allowance{data.topup ? ` · ${data.topup.toLocaleString()} top-up (never expire)` : ""}</div>
          {data.resetsAt && <div className="text-[11.5px] text-[#8A95A5] mt-1 flex items-center gap-1"><Clock className="w-3 h-3" />{data.allowance?.toLocaleString()} new credits on {new Date(data.resetsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}. Unused monthly credits don't carry over.</div>}
          {low && <div className="text-[12px] text-[#FBBF24] mt-3">You're running low. Top up below so your team can keep using AI.</div>}
          <div className="mt-4 border-t border-[#222A35] pt-3">
            <div className="text-[11px] uppercase tracking-wider text-[#5B6675] mb-1.5">What uses credits</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
              {costRows.map(([k, v]) => <div key={k} className="flex justify-between text-[12px]"><span className="text-[#C2CAD6]">{data.labels?.[k] || k}</span><span className="text-white tabular-nums">{v}</span></div>)}
              <div className="flex justify-between text-[12px]"><span className="text-[#C2CAD6]">Suzy & support chat</span><span className="text-[#22C55E]">Free</span></div>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-5">
          <div className="text-[12.5px] text-white mb-3">Top up</div>
          <div className="space-y-2">
            {data.packs.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-lg border border-[#222A35] bg-[#0A0E14] px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-white">{p.credits.toLocaleString()} credits <span className="text-[11px] text-[#8A95A5]">· {p.name}</span></div>
                  <div className="text-[11px] text-[#5B6675]">KES {(p.kes / p.credits).toFixed(2)} per credit</div>
                </div>
                <button onClick={() => buy(p.id)} disabled={!!busy || !data.payments} className="h-9 px-3 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] disabled:opacity-50 text-white text-[12px] flex items-center gap-1.5 shrink-0">
                  {busy === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CreditCard className="w-3.5 h-3.5" />} KES {p.kes.toLocaleString()}
                </button>
              </div>
            ))}
          </div>
          <div className="text-[11px] text-[#5B6675] mt-3">{data.payments ? "Pay with M-Pesa or card through Paystack. Credits are added as soon as the payment is confirmed." : "Online payment isn't available right now. Contact Buildsasa support to buy credits."}</div>
        </div>
      </div>
      {data.history.length > 0 && (
        <div className="mt-3 rounded-xl border border-[#222A35] bg-[#11161D] divide-y divide-[#222A35]">
          <div className="px-4 py-2.5 text-[11px] uppercase tracking-wider text-[#5B6675]">Recent activity</div>
          {data.history.slice(0, 12).map((h) => (
            <div key={h.id} className="px-4 py-2 flex items-center gap-3 text-[12px]">
              <span className={`tabular-nums w-14 text-right ${h.delta > 0 ? "text-[#22C55E]" : "text-[#C2CAD6]"}`}>{h.delta > 0 ? "+" : ""}{h.delta}</span>
              <span className="flex-1 min-w-0 truncate text-[#C2CAD6]">{h.note || h.kind}{h.userName ? <span className="text-[#5B6675]"> · {h.userName}</span> : null}</span>
              <span className="text-[11px] text-[#5B6675] shrink-0">{new Date(h.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
