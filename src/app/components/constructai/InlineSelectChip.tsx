// ============================================================================
// A chip that is also the control that changes it.
//
// Setting a checklist's project or trade used to mean opening the Assign dialog,
// and after the first assignment there was no route back to it at all — so a
// board full of "No project" chips showed you the problem while giving you no way
// to fix it. The chip that reports the value now sets it.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check, Loader2 } from "lucide-react";

export type ChipOption = { value: string; label: string };

export function InlineSelectChip({
  value, options, placeholder, onChange, disabled, tone = "neutral", title,
}: {
  value?: string | null;
  options: ChipOption[];
  /** Shown when nothing is set — say what is MISSING, not "none". */
  placeholder: string;
  onChange: (value: string) => Promise<void> | void;
  disabled?: boolean;
  /** "warn" marks a value whose absence has consequences elsewhere. */
  tone?: "neutral" | "warn";
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape, so the menu never strands the user.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const current = options.find((o) => o.value === value);
  const isSet = !!current;
  const label = current?.label ?? placeholder;

  const pick = async (v: string) => {
    setOpen(false);
    if (v === value) return;
    setSaving(true);
    try { await onChange(v); } finally { setSaving(false); }
  };

  const base = "text-[10px] px-1.5 py-0.5 rounded inline-flex items-center gap-1 max-w-[180px]";
  const skin = isSet
    ? "bg-[#222A35] text-[#8A95A5]"
    : tone === "warn"
      ? "bg-[#F5A623]/15 text-[#F5A623] border border-[#F5A623]/30"
      : "bg-[#222A35] text-[#5B6675]";

  if (disabled) {
    return <span className={`${base} ${skin}`} title={title}><span className="truncate">{label}</span></span>;
  }

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        title={title || `Change ${placeholder.toLowerCase()}`}
        className={`${base} ${skin} hover:brightness-125 transition cursor-pointer`}
      >
        <span className="truncate">{label}</span>
        {saving ? <Loader2 className="w-2.5 h-2.5 animate-spin shrink-0" /> : <ChevronDown className="w-2.5 h-2.5 shrink-0 opacity-70" />}
      </button>
      {open && (
        <div className="absolute z-30 mt-1 left-0 w-52 max-h-64 overflow-y-auto rounded-md border border-[#222A35] bg-[#0F141B] shadow-2xl py-1">
          {options.length === 0 && <div className="px-3 py-2 text-[11px] text-[#5B6675]">Nothing to choose from yet.</div>}
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={(e) => { e.stopPropagation(); void pick(o.value); }}
              className="w-full px-3 py-1.5 text-left text-[11.5px] text-[#C2CAD6] hover:bg-[#161C24] hover:text-white flex items-center gap-2"
            >
              {o.value === value ? <Check className="w-3 h-3 text-[#FF6B1A] shrink-0" /> : <span className="w-3 shrink-0" />}
              <span className="truncate">{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
