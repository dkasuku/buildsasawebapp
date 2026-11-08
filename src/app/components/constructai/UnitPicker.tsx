// "Who is this for?" on daily logs, inspections, 360° tours and snags, for
// apartment blocks and estates. Nothing picked = the whole project (every
// client sees it); pick units and only those units' clients see it. Renders
// nothing on projects without units.
import { useEffect, useMemo, useState } from "react";
import { Building2, X } from "lucide-react";
import api, { type UnitDto } from "../../services/api";

const cache = new Map<string, Promise<UnitDto[]>>();
export const loadUnits = (projectId: string, fresh = false) => {
  if (fresh) cache.delete(projectId);
  if (!cache.has(projectId)) cache.set(projectId, api.getUnits(projectId).catch(() => { cache.delete(projectId); return []; }));
  return cache.get(projectId)!;
};
export const parseUnitIds = (v: unknown): string[] => { if (Array.isArray(v)) return v as string[]; try { const a = JSON.parse(String(v || "[]")); return Array.isArray(a) ? a : []; } catch { return []; } };

export function useUnits(projectId?: string | null) {
  const [units, setUnits] = useState<UnitDto[]>([]);
  useEffect(() => { if (projectId) loadUnits(projectId).then(setUnits); else setUnits([]); }, [projectId]);
  return units;
}

/** Several units (logs, inspections, tours). */
export function UnitPicker({ projectId, value, onChange, what = "this" }: { projectId?: string | null; value: string[]; onChange: (ids: string[]) => void; what?: string }) {
  const units = useUnits(projectId);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const shown = useMemo(() => units.filter((u) => !q.trim() || `${u.code} ${u.clientName || ""}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 60), [units, q]);
  if (!units.length) return null;
  const picked = units.filter((u) => value.includes(u.id));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="rounded-lg border border-[#222A35] bg-[#0A0E14] px-3 py-2.5">
      <div className="flex items-center gap-2 text-[12px] text-[#C2CAD6]"><Building2 className="w-3.5 h-3.5 text-[#FF8A47]" /> Which units is {what} for?</div>
      <div className="text-[10.5px] text-[#5B6675] mt-0.5">{picked.length ? `Only the client${picked.length > 1 ? "s" : ""} of ${picked.map((u) => u.code).join(", ")} will see it.` : "The whole building: every client on this project sees it."}</div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        <button type="button" onClick={() => onChange([])} className={`h-7 px-2.5 rounded-full text-[11.5px] border ${!picked.length ? "border-[#FF6B1A]/60 bg-[#FF6B1A]/10 text-[#FF8A47]" : "border-[#222A35] text-[#8A95A5]"}`}>Whole building</button>
        {picked.map((u) => <span key={u.id} className="h-7 pl-2.5 pr-1.5 rounded-full text-[11.5px] border border-[#FF6B1A]/60 bg-[#FF6B1A]/10 text-[#FF8A47] inline-flex items-center gap-1">{u.code}<button type="button" onClick={() => toggle(u.id)} aria-label={`Remove ${u.code}`}><X className="w-3 h-3" /></button></span>)}
        <button type="button" onClick={() => setOpen((o) => !o)} className="h-7 px-2.5 rounded-full text-[11.5px] border border-dashed border-[#2C3744] text-[#C2CAD6]">{open ? "Done" : "+ Pick units"}</button>
      </div>
      {open && (
        <div className="mt-2">
          {units.length > 12 && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a unit or client" aria-label="Find a unit" className="w-full h-8 mb-2 rounded-md bg-[#11161D] border border-[#222A35] px-2.5 text-[12px] text-white focus:outline-none" />}
          <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
            {shown.map((u) => <button type="button" key={u.id} onClick={() => toggle(u.id)} aria-pressed={value.includes(u.id)} className={`h-7 px-2.5 rounded-md text-[11.5px] border ${value.includes(u.id) ? "border-[#FF6B1A] text-white bg-[#FF6B1A]/15" : "border-[#222A35] text-[#C2CAD6] hover:text-white"}`}>{u.code}</button>)}
          </div>
        </div>
      )}
    </div>
  );
}

/** One unit (a snag). */
export function UnitSelect({ projectId, value, onChange, className = "" }: { projectId?: string | null; value?: string | null; onChange: (id: string | null) => void; className?: string }) {
  const units = useUnits(projectId);
  if (!units.length) return null;
  return (
    <label className={`block ${className}`}>
      <span className="text-[11px] text-[#8A95A5]">Unit</span>
      <select aria-label="Unit" value={value || ""} onChange={(e) => onChange(e.target.value || null)} className="mt-1 w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2.5 text-[12.5px] text-white focus:outline-none focus:border-[#FF6B1A]/60">
        <option value="">Common areas (no unit)</option>
        {units.map((u) => <option key={u.id} value={u.id}>{u.code}{u.clientName ? ` · ${u.clientName}` : ""}</option>)}
      </select>
    </label>
  );
}

/** "A-101" for a unit id, for badges in lists. */
export function UnitBadge({ projectId, id }: { projectId?: string | null; id?: string | null }) {
  const units = useUnits(id ? projectId : null);
  const u = units.find((x) => x.id === id);
  return u ? <span className="text-[10.5px] px-1.5 py-0.5 rounded border border-[#FF6B1A]/40 text-[#FF8A47] whitespace-nowrap">Unit {u.code}</span> : null;
}
