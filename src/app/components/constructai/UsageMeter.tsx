// Today's AI allowances at a glance (images, documents, uploads, voice), under
// the AI composer, with a one-tap top-up so nobody has to wait for tomorrow.
import { useEffect, useState } from "react";
import { Zap } from "lucide-react";
import api, { NEED_CREDITS_EVENT, type AiLimitsDto } from "../../services/api";

const ORDER: [string, string][] = [["image", "images"], ["document", "documents"], ["upload", "uploads"], ["voice", "voice"]];

export function UsageMeter() {
  const [d, setD] = useState<AiLimitsDto | null>(null);
  useEffect(() => {
    const load = () => api.aiLimits().then(setD).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    window.addEventListener("buildsasa:credits-updated", load);
    window.addEventListener("focus", load);
    return () => { clearInterval(t); window.removeEventListener("buildsasa:credits-updated", load); window.removeEventListener("focus", load); };
  }, []);
  if (!d) return null;
  const topUp = () => window.dispatchEvent(new CustomEvent(NEED_CREDITS_EVENT, { detail: { code: "TOPUP", error: `Top-up credits never expire. Use them for AI answers and to keep going after today's allowances run out.${d.topup ? ` You have ${d.topup.toLocaleString()} top-up credits.` : ""}`, packs: d.packs, payments: d.payments } }));
  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-[#5B6675]" aria-label="Today's AI allowance">
      <span>Today:</span>
      {ORDER.map(([k, label]) => {
        const used = d.used[k] || 0, lim = d.limits[k] || 0, out = used >= lim;
        return <span key={k} className={out ? "text-[#FBBF24]" : used / Math.max(1, lim) > 0.7 ? "text-[#C2CAD6]" : ""}>{Math.min(used, lim)}/{lim} {label}</span>;
      })}
      <span>· {d.balance.toLocaleString()} credits</span>
      <button onClick={topUp} className="text-[#FF8A47] hover:underline inline-flex items-center gap-0.5"><Zap className="w-3 h-3" /> Top up</button>
    </div>
  );
}
