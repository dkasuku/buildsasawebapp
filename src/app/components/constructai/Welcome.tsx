// A one-time welcome after a client signs up, or once a company's subscription
// is active, so the first moment in Buildsasa feels like arriving somewhere.
// Remembered per account in localStorage; if storage is blocked it simply shows
// again next time, which is harmless.
import { useEffect, useState } from "react";
import { ArrowRight, Camera, ClipboardCheck, MessageCircle, PartyPopper, ShieldCheck, Users, Briefcase, CalendarDays, UserCheck } from "lucide-react";

type Kind = "client" | "contractor";
const key = (kind: Kind, who: string) => `buildsasa-welcomed-${kind}-${who.toLowerCase()}`;

export function useWelcome(kind: Kind, who: string | null | undefined, ready: boolean) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!ready || !who) return;
    try { if (!localStorage.getItem(key(kind, who))) setShow(true); } catch { setShow(true); }
  }, [kind, who, ready]);
  const close = () => { setShow(false); try { if (who) localStorage.setItem(key(kind, who), new Date().toISOString()); } catch { /* noop */ } };
  return { show, close };
}

const COPY: Record<Kind, { title: (n: string) => string; sub: string; points: { icon: any; t: string; d: string }[]; cta: string }> = {
  client: {
    title: (n) => `Karibu, ${n}!`,
    sub: "Welcome to Buildsasa. From here you can watch every stage of your site, from wherever you are in the world.",
    points: [
      { icon: Camera, t: "See the real progress", d: "Photos and short videos of each stage, shared by your contractor, from land clearing and fencing to handover." },
      { icon: ClipboardCheck, t: "Approve and pay with confidence", d: "Change orders, finish choices and invoices wait for you on Home." },
      { icon: MessageCircle, t: "Talk to your team", d: "Chat with your contractor and send photos or videos any time." },
      { icon: ShieldCheck, t: "Independent eyes on site", d: "Ask Buildsasa for neutral site reporting when you want an honest second opinion." },
    ],
    cta: "Let's go",
  },
  contractor: {
    title: (n) => `Welcome aboard, ${n}!`,
    sub: "Your Buildsasa subscription is active. Here's how to get the most from it in your first week.",
    points: [
      { icon: CalendarDays, t: "Log site work daily", d: "Daily logs with photos keep your team, and your clients, in the loop." },
      { icon: UserCheck, t: "Invite your clients", d: "Open a project's Client tab and invite the owner. They follow progress free, and trust grows." },
      { icon: Users, t: "Bring your team", d: "Add site managers, foremen and inspectors from Team, each with the right access." },
      { icon: Briefcase, t: "Send professional quotes", d: "Price jobs from templates and send a link your client accepts online." },
    ],
    cta: "Start building",
  },
};

export function WelcomeModal({ kind, name, onClose }: { kind: Kind; name: string; onClose: () => void }) {
  const c = COPY[kind];
  return (
    <div className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true">
      <div className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-[#222A35] bg-[#11161D] shadow-2xl">
        <div className="relative px-6 pt-7 pb-5 bg-gradient-to-br from-[#FF6B1A]/20 via-transparent to-transparent">
          <div className="w-12 h-12 rounded-xl bg-[#FF6B1A] text-white flex items-center justify-center shadow-lg shadow-[#FF6B1A]/30"><PartyPopper className="w-6 h-6" /></div>
          <h2 className="mt-4 text-[22px] font-display text-white leading-tight">{c.title(name.split(" ")[0] || "there")}</h2>
          <p className="mt-1.5 text-[13px] text-[#C2CAD6]">{c.sub}</p>
        </div>
        <div className="px-6 pb-2 space-y-3">
          {c.points.map((p) => (
            <div key={p.t} className="flex gap-3">
              <span className="w-9 h-9 shrink-0 rounded-lg bg-[#161C24] text-[#FF6B1A] flex items-center justify-center"><p.icon className="w-4 h-4" /></span>
              <div><div className="text-[13px] text-white">{p.t}</div><div className="text-[12px] text-[#8A95A5]">{p.d}</div></div>
            </div>
          ))}
        </div>
        <div className="p-6 pt-4">
          <button onClick={onClose} className="w-full h-11 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[13.5px] inline-flex items-center justify-center gap-2">{c.cta} <ArrowRight className="w-4 h-4" /></button>
        </div>
      </div>
    </div>
  );
}
