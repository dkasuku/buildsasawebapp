// A one-time welcome on an account's first sign-in, so the first moment in
// Buildsasa feels like arriving somewhere. "Seen" lives on the account
// (user.welcomed, from the server), so it never comes back on a new browser,
// a new device, or after storage is cleared.
import { useState } from "react";
import { ArrowRight, Camera, ClipboardCheck, MessageCircle, PartyPopper, ShieldCheck } from "lucide-react";
import api from "../../services/api";

// Contractors are welcomed by the AI itself (AiWorkspace first run); only
// clients, who follow a site rather than run one, get this card.
type Kind = "client";

export function storedUser(): any {
  try { return JSON.parse(localStorage.getItem("constructai-user") || "null"); } catch { return null; }
}

/** True only for an account the server says has never been welcomed. A
 *  session cached before this flag existed has no `welcomed` field and is
 *  treated as already welcomed, so existing customers are never re-shown it. */
export function isFirstSignIn(): boolean {
  return storedUser()?.welcomed === false;
}

/** Record that the welcome was seen: locally right away, then on the account. */
export function markWelcomed() {
  try {
    const u = storedUser();
    if (u) localStorage.setItem("constructai-user", JSON.stringify({ ...u, welcomed: true }));
  } catch { /* noop */ }
  api.markWelcomed().catch(() => { /* worst case it shows once more */ });
}

export function useWelcome(ready: boolean) {
  const [done, setDone] = useState(false);
  const show = ready && !done && isFirstSignIn();
  const close = () => { setDone(true); markWelcomed(); };
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
