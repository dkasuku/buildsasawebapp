// The tab strip across the top of a module: every page that used to be its
// own sidebar row, one click apart. Hidden when a module has a single page.
import { Lock, Sparkles } from "lucide-react";
import type { View } from "./Sidebar";
import { moduleOf } from "./modules";
import { BUSINESS_VIEWS } from "./planTier";

export function ModuleTabs({ view, allowed, starter, onNavigate, onAskAi }: {
  view: View; allowed: (v: View) => boolean; starter?: boolean;
  onNavigate: (v: View) => void; onAskAi?: () => void;
}) {
  const m = moduleOf(view);
  if (!m || view === "project-detail") return null;
  const tabs = m.tabs.filter((t) => allowed(t.key));
  if (tabs.length < 2) return null;
  return (
    <div className="ws-moduletabs sticky top-0 z-20 border-b border-[#222A35] bg-[#0A0E14]/95 backdrop-blur px-4 sm:px-7">
      <div className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] -mb-px" role="tablist" aria-label={`${m.label} pages`}>
        {tabs.map((t) => {
          const on = t.key === view;
          return (
            <button key={t.key} role="tab" aria-selected={on} onClick={() => onNavigate(t.key)}
              className={`shrink-0 h-11 px-3 text-[12.5px] border-b-2 inline-flex items-center gap-1.5 transition-colors ${on ? "border-[#FF6B1A] text-white" : "border-transparent text-[#8A95A5] hover:text-white"}`}>
              {t.label}
              {starter && BUSINESS_VIEWS.includes(t.key) && <Lock className="w-3 h-3 text-[#5B6675]" aria-label="Business plan" />}
            </button>
          );
        })}
        {onAskAi && (
          <button onClick={onAskAi} className="ml-auto shrink-0 h-8 px-3 rounded-full border border-[#FF6B1A]/30 bg-[#FF6B1A]/10 text-[#FF8A47] text-[12px] inline-flex items-center gap-1.5 hover:bg-[#FF6B1A]/20">
            <Sparkles className="w-3.5 h-3.5" /> Ask AI about {m.label.toLowerCase()}
          </button>
        )}
      </div>
    </div>
  );
}
