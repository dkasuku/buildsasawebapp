// Getting started: a short checklist on the AI home for new companies. Each step
// is ticked from their real data and starts the message that does it, so a new
// contractor learns the product by using it, not by reading a tour.
import { useEffect, useState } from "react";
import { Check, ChevronDown, Rocket, X } from "lucide-react";
import { http } from "../../services/api";

type Steps = { company: boolean; project: boolean; siteDay: boolean; quote: boolean; workers: boolean; invoice: boolean; client: boolean };
const STEPS: { k: keyof Steps; title: string; how: string; fill: string; money?: boolean }[] = [
  { k: "company", title: "Add your company name", how: "It goes at the top of every quote and payment request.", fill: "Our company is called " },
  { k: "project", title: "Set up your first site", how: "One sentence is enough: what, where, for whom, and the price.", fill: "New project: " },
  { k: "siteDay", title: "Tell it about a day on site", how: "Workers, work done, deliveries and snags, all in one message.", fill: "Today on site: " },
  { k: "workers", title: "Add your workers", how: "Name, trade and daily rate. Then the wage bill adds itself up.", fill: "Add worker: " },
  { k: "quote", title: "Write a quote", how: "Describe the job, or send a photo of a sketch or BOQ.", fill: "Write a quote for " },
  { k: "invoice", title: "Ask a client for payment", how: "A payment request for a finished stage, ready for WhatsApp.", fill: "Make a payment request for ", money: true },
  { k: "client", title: "Share the site with your client", how: "They follow progress on their phone, so they call you less.", fill: "Share my latest project with my client: " },
];
const HIDE_KEY = "buildsasa-getting-started-hidden";

export function GettingStarted({ onFill, canSeeMoney }: { onFill: (text: string) => void; canSeeMoney: boolean }) {
  const [steps, setSteps] = useState<Steps | null>(null);
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(HIDE_KEY) === "1"; } catch { return false; } });
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (hidden) return;
    const load = () => http<{ steps: Steps; createdAt: string | null }>("/api/onboarding/progress").then((r) => {
      // Only for new companies (first 30 days); older accounts already know their way.
      if (r.createdAt && Date.now() - new Date(r.createdAt).getTime() > 30 * 864e5) return setSteps(null);
      setSteps(r.steps);
    }).catch(() => {});
    load();
    window.addEventListener("buildsasa:company-updated", load);
    window.addEventListener("focus", load);
    return () => { window.removeEventListener("buildsasa:company-updated", load); window.removeEventListener("focus", load); };
  }, [hidden]);
  if (hidden || !steps) return null;
  const list = STEPS.filter((s) => canSeeMoney || !s.money);
  const done = list.filter((s) => steps[s.k]).length;
  if (done === list.length) return null;
  const hide = () => { try { localStorage.setItem(HIDE_KEY, "1"); } catch { /* noop */ } setHidden(true); };
  return (
    <div className="mt-6 rounded-2xl border border-[#222A35] bg-[#11161D] overflow-hidden" aria-label="Getting started">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="w-8 h-8 shrink-0 rounded-lg bg-[#FF6B1A]/10 flex items-center justify-center"><Rocket className="w-4 h-4 text-[#FF8A47]" /></span>
        <button onClick={() => setOpen((o) => !o)} className="min-w-0 flex-1 text-left">
          <span className="block text-[14px] text-white font-medium">Getting started</span>
          <span className="block text-[12px] text-[#8A95A5]">{done} of {list.length} done. Tap a step and I'll start it for you.</span>
        </button>
        <button onClick={() => setOpen((o) => !o)} aria-label={open ? "Fold" : "Unfold"} className="w-8 h-8 rounded-md text-[#8A95A5] hover:text-white flex items-center justify-center"><ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} /></button>
        <button onClick={hide} aria-label="Hide getting started" className="w-8 h-8 rounded-md text-[#5B6675] hover:text-white flex items-center justify-center"><X className="w-4 h-4" /></button>
      </div>
      <div className="h-1 bg-[#161C24]"><div className="h-full bg-[#FF6B1A] transition-[width] duration-500" style={{ width: `${(done / list.length) * 100}%` }} /></div>
      {open && (
        <div className="divide-y divide-[#222A35]">
          {list.map((s, i) => {
            const ok = steps[s.k];
            return (
              <button key={s.k} disabled={ok} onClick={() => onFill(s.fill)} className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-[#161C24] disabled:hover:bg-transparent">
                <span className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-[11px] ${ok ? "bg-[#22C55E] text-white" : "border border-[#2C3744] text-[#8A95A5]"}`}>{ok ? <Check className="w-3.5 h-3.5" /> : i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-[13.5px] ${ok ? "text-[#8A95A5] line-through" : "text-white"}`}>{s.title}</span>
                  {!ok && <span className="block text-[11.5px] text-[#8A95A5] leading-snug">{s.how}</span>}
                </span>
                {!ok && <span className="text-[12px] text-[#FF8A47] shrink-0">Start</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
