// ============================================================================
// FeatureTour — a lightweight, non-blocking walkthrough for NEW users. It floats
// bottom-right and only shows the steps relevant to the person's role: each step
// is filtered against ROLES[role].views, so a Worker is guided to Tasks/Checklists
// while an Owner also sees Team/Billing. Shown once after first-run setup, and
// re-launchable anytime from the profile menu ("Take a tour").
// ============================================================================

import { useState } from "react";
import { LayoutDashboard, FolderKanban, ClipboardList, ClipboardCheck, Sparkles, Users, CreditCard, ArrowRight, ArrowLeft, X } from "lucide-react";
import type { View } from "./Sidebar";
import type { Role } from "./roles";
import { ROLES } from "./roles";
import { isViewVisible } from "../../config/features";

type Step = { key: View; icon: any; title: string; body: string };

// Full catalogue — filtered per role below so people are only guided to places
// they can actually open.
const CATALOG: Step[] = [
  { key: "dashboard", icon: LayoutDashboard, title: "Your dashboard", body: "Your daily overview — projects, change orders, and key numbers. Start here each day." },
  { key: "projects", icon: FolderKanban, title: "Projects", body: "Each site or job is a project. Open one to see its details, team, drawings, and progress." },
  { key: "tasks", icon: ClipboardCheck, title: "Tasks & Trades", body: "Your assigned forms and checklists live here, grouped by trade. Update your field % as work advances and submit when done." },
  { key: "checklists", icon: ClipboardList, title: "Checklists & forms", body: "Build a digital checklist (or generate one with AI), then assign it to your team and review submissions." },
  { key: "buildflex-ai", icon: Sparkles, title: "Buildsasa AI", body: "Ask for reports or insights on your projects, finances, and change orders — in plain language." },
  { key: "team", icon: Users, title: "Your team", body: "Invite teammates and give each a role. The people you invite are who you assign work to." },
  { key: "billing", icon: CreditCard, title: "Billing & plan", body: "Manage your subscription and payments here. That's the tour — you're ready to build." },
];

export function FeatureTour({ onClose, onNavigate, role }: { onClose: () => void; onNavigate: (v: View) => void; role: Role }) {
  // Keep only steps this role can actually reach.
  const allowed = ROLES[role]?.views || [];
  const steps = CATALOG.filter((s) => allowed.includes(s.key) && isViewVisible(s.key));
  const [i, setI] = useState(0);

  if (steps.length === 0) return null;
  const idx = Math.min(i, steps.length - 1);
  const step = steps[idx];
  const last = idx === steps.length - 1;
  const Icon = step.icon;

  return (
    <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-[75] w-auto sm:w-[360px] rounded-2xl border border-[#222A35] bg-[#11161D] shadow-2xl">
      <div className="px-5 pt-4 pb-3 flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-[#FF6B1A]/15 flex items-center justify-center shrink-0">
            <Icon className="w-[18px] h-[18px] text-[#FF6B1A]" />
          </div>
          <div>
            <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">Tour · {idx + 1} of {steps.length}</div>
            <div className="text-[14px] text-white font-display">{step.title}</div>
          </div>
        </div>
        <button onClick={onClose} className="text-[#5B6675] hover:text-white" title="Skip tour"><X className="w-4 h-4" /></button>
      </div>

      <p className="px-5 text-[12.5px] text-[#C2CAD6] leading-relaxed">{step.body}</p>

      <div className="px-5 pt-3">
        <button onClick={() => onNavigate(step.key)} className="text-[11px] text-[#FF6B1A] hover:underline flex items-center gap-1">
          Take me there <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      <div className="px-5 pb-4 pt-3 flex items-center gap-2">
        <div className="flex-1 flex items-center gap-1">
          {steps.map((_, k) => (
            <span key={k} className={`h-1 flex-1 rounded-full ${k <= idx ? "bg-[#FF6B1A]" : "bg-[#222A35]"}`} />
          ))}
        </div>
      </div>

      <div className="px-5 pb-5 flex gap-2">
        {idx > 0 && (
          <button onClick={() => setI(idx - 1)} className="h-9 px-3 rounded-md border border-[#222A35] text-[12px] text-[#8A95A5] hover:text-white flex items-center gap-1.5">
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
        )}
        <button
          onClick={() => (last ? onClose() : setI(idx + 1))}
          className="flex-1 h-9 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[12px] flex items-center justify-center gap-1.5"
        >
          {last ? "Finish" : "Next"} {!last && <ArrowRight className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}

export default FeatureTour;
