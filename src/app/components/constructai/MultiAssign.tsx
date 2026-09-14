// ============================================================================
// MultiAssign — pick one or more teammates.
//
// Change Orders and the Punch List each carried an identical private copy of
// this, and every other form (inspections, defects, coordination issues) had a
// single-value <select> or a free-text box. One shared picker, so "assign to"
// means the same thing — and allows several people — everywhere.
// ============================================================================

import { useState } from "react";
import { CheckSquare, ChevronDown, Square, X } from "lucide-react";
import { useTeam, resolveName } from "./useTeam";

export function MultiAssign({ value, onChange, label = "Assignees", hint = "multiple allowed", compact }: {
  value: string[];
  onChange: (v: string[]) => void;
  label?: string;
  hint?: string;
  /** Tighter label style for forms that use the 11px sentence-case labels. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const people = useTeam();
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="relative">
      {label && (
        compact
          ? <div className="text-[11px] text-[#8A95A5] mb-1.5">{label}{hint ? <span className="text-[#5B6675]"> · {hint}</span> : null}</div>
          : <div className="text-[10px] uppercase tracking-wider text-[#8A95A5] mb-1">{label}{hint ? ` (${hint})` : ""}</div>
      )}
      <button type="button" onClick={() => setOpen(!open)} className="w-full min-h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 py-1.5 text-left flex flex-wrap gap-1 items-center focus:outline-none focus:border-[#FF6B1A]">
        {value.length === 0 && <span className="text-[12px] text-[#5B6675]">Select one or more…</span>}
        {value.map((id) => (
          <span key={id} className="text-[11px] px-1.5 py-0.5 rounded bg-[#FF6B1A]/15 text-[#FF6B1A] flex items-center gap-1">
            {resolveName(id)}
            <span role="button" onClick={(e) => { e.stopPropagation(); toggle(id); }}><X className="w-3 h-3" /></span>
          </span>
        ))}
        <ChevronDown className="w-3.5 h-3.5 text-[#5B6675] ml-auto" />
      </button>
      {open && (<>
        <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
        <div className="absolute z-20 mt-1 w-full max-h-52 overflow-y-auto rounded-md border border-[#222A35] bg-[#11161D] shadow-xl py-1">
          {people.length === 0 && <div className="px-3 py-2 text-[11px] text-[#5B6675]">No teammates yet — invite people on the Team page.</div>}
          {people.map((m) => (
            <button key={m.id} type="button" onClick={() => toggle(m.id)} className="w-full px-3 py-1.5 text-left text-[12px] flex items-center gap-2 hover:bg-[#161C24]">
              {value.includes(m.id) ? <CheckSquare className="w-3.5 h-3.5 text-[#FF6B1A]" /> : <Square className="w-3.5 h-3.5 text-[#5B6675]" />}
              <span className="text-white">{m.name}</span><span className="text-[10px] text-[#5B6675] ml-auto">{m.role}</span>
            </button>
          ))}
        </div>
      </>)}
    </div>
  );
}

/** Split a stored "id1,id2" / JSON-array / single-id string into ids. */
export function parseAssignees(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v !== "string" || !v.trim()) return [];
  try { const j = JSON.parse(v); if (Array.isArray(j)) return j.map(String).filter(Boolean); } catch { /* not JSON */ }
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Names for display, from whatever shape the record stores. */
export function assigneeNames(v: unknown): string {
  return parseAssignees(v).map((id) => resolveName(id)).join(", ");
}
