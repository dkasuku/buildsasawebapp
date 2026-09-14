// ============================================================================
// Rate library — fair rates for common BOQ items, shared across the workspace.
//
// Opens as a drawer from the BOQ folder. In "pick" mode a row's "Use" button
// hands the rate back to the item being drafted; otherwise it is a plain
// reference the estimator can search, add to and correct.
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { BookOpen, Loader2, Plus, Search, Sparkles, Trash2, X, Check, Pencil } from "lucide-react";
import api, { type RateLibraryItemDto } from "../../../services/api";
import type { RatePick } from "../BoqEditor";
import { Empty, Field, btnGhost, btnPrimary, input, useEscape, useMoney } from "./shared";

const UNITS = ["m", "m2", "m3", "kg", "tonne", "no", "item", "sum", "days", "hours"];

export function RateLibraryDrawer({ onClose, onPick, canEdit }: { onClose: () => void; onPick?: (r: RatePick) => void; canEdit: boolean }) {
  const { fmt } = useMoney();
  useEscape(onClose);
  const [rows, setRows] = useState<RateLibraryItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RateLibraryItemDto | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setRows(await api.getRateLibrary()); }
    catch (e: any) { toast.error(e?.message || "Could not load the rate library"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? rows.filter((r) => `${r.code || ""} ${r.description} ${r.unit} ${r.category || ""}`.toLowerCase().includes(n)) : rows;
  }, [rows, q]);
  const groups = useMemo(() => {
    const g: Record<string, RateLibraryItemDto[]> = {};
    for (const r of filtered) (g[r.category || "Uncategorised"] = g[r.category || "Uncategorised"] || []).push(r);
    return Object.entries(g);
  }, [filtered]);

  const seed = async () => {
    setBusy(true);
    try { const r = await api.seedRateLibrary(); toast.success(`${r.created} starter rates loaded — edit them to your market`); await load(); }
    catch (e: any) { toast.error(e?.message || "Could not load the starter rates"); }
    finally { setBusy(false); }
  };
  const remove = async (r: RateLibraryItemDto) => {
    if (!confirm(`Remove "${r.description}" from the library?`)) return;
    try { await api.deleteRate(r.id); setRows((x) => x.filter((y) => y.id !== r.id)); }
    catch (e: any) { toast.error(e?.message || "Could not remove"); }
  };

  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/60" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-xl h-full bg-[#11161D] border-l border-[#222A35] flex flex-col">
        <div className="px-5 py-4 border-b border-[#222A35] flex items-start justify-between gap-3">
          <div>
            <div className="text-[15px] text-white font-display flex items-center gap-2"><BookOpen className="w-4 h-4 text-[#FF6B1A]" /> Rate library</div>
            <div className="text-[11.5px] text-[#8A95A5] mt-0.5">{onPick ? "Pick a rate to fill the item you are pricing." : "Fair rates for common items — a reference, not a price list."}</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-md text-[#8A95A5] hover:text-white hover:bg-[#161C24] flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-3 border-b border-[#222A35] flex gap-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#5B6675]" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search — e.g. plaster, excavate, Y12" className={`${input} pl-8`} />
          </div>
          {canEdit && <button onClick={() => setAdding(true)} className={btnGhost}><Plus className="w-3.5 h-3.5" /> Add</button>}
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="py-16 flex justify-center text-[#8A95A5]"><Loader2 className="w-4 h-4 animate-spin" /></div>
          ) : rows.length === 0 ? (
            <Empty icon={BookOpen} title="The library is empty" hint="Load a starter set of common items (indicative Nairobi-area rates you then correct), or add your own from quotes and past jobs.">
              {canEdit && <button onClick={seed} disabled={busy} className={btnPrimary}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Load starter rates</button>}
              {canEdit && <button onClick={() => setAdding(true)} className={btnGhost}><Plus className="w-3.5 h-3.5" /> Add a rate</button>}
            </Empty>
          ) : filtered.length === 0 ? (
            <Empty icon={Search} title="Nothing matches" hint="Try a shorter word, or add it to the library.">
              {canEdit && <button onClick={() => setAdding(true)} className={btnGhost}><Plus className="w-3.5 h-3.5" /> Add “{q.trim()}”</button>}
            </Empty>
          ) : (
            groups.map(([cat, list]) => (
              <div key={cat}>
                <div className="px-5 py-1.5 text-[10px] uppercase tracking-wider text-[#5B6675] bg-[#0A0E14]/60 sticky top-0">{cat}</div>
                {list.map((r) => (
                  <div key={r.id} className="px-5 py-2.5 border-b border-[#222A35]/60 flex items-center gap-3 hover:bg-[#161C24]/60">
                    <div className="flex-1 min-w-0">
                      <div className="text-[12.5px] text-white truncate">{r.code ? <span className="font-mono text-[#8A95A5] mr-1.5">{r.code}</span> : null}{r.description}</div>
                      <div className="text-[10.5px] text-[#5B6675] truncate">per {r.unit}{r.source ? ` · ${r.source}` : ""}{r.notes ? ` · ${r.notes}` : ""}</div>
                    </div>
                    <div className="text-[13px] text-white tabular-nums shrink-0">{fmt(r.rate)}</div>
                    {onPick && <button onClick={() => { onPick({ description: r.description, unit: r.unit, rate: r.rate, code: r.code }); onClose(); }} className={`${btnPrimary} h-8 px-2.5`}><Check className="w-3.5 h-3.5" /> Use</button>}
                    {canEdit && <button onClick={() => setEditing(r)} className="w-7 h-7 rounded flex items-center justify-center text-[#5B6675] hover:text-white"><Pencil className="w-3.5 h-3.5" /></button>}
                    {canEdit && <button onClick={() => remove(r)} className="w-7 h-7 rounded flex items-center justify-center text-[#5B6675] hover:text-[#EF4444]"><Trash2 className="w-3.5 h-3.5" /></button>}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
        {(adding || editing) && (
          <RateForm
            initial={editing || (q.trim() ? { description: q.trim() } : undefined)}
            onClose={() => { setAdding(false); setEditing(null); }}
            onSaved={(saved) => {
              setRows((x) => (x.some((y) => y.id === saved.id) ? x.map((y) => (y.id === saved.id ? saved : y)) : [...x, saved]));
              setAdding(false); setEditing(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

function RateForm({ initial, onClose, onSaved }: { initial?: Partial<RateLibraryItemDto>; onClose: () => void; onSaved: (r: RateLibraryItemDto) => void }) {
  const money = useMoney();
  const [f, setF] = useState({ code: initial?.code || "", description: initial?.description || "", unit: initial?.unit || "m2", rate: initial?.rate != null ? money.fromBase(initial.rate) : "", category: initial?.category || "", source: initial?.source || "", notes: initial?.notes || "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    if (!f.description.trim()) return toast.error("Describe the item");
    if (!(money.toBase(f.rate) > 0)) return toast.error("Enter the rate");
    setBusy(true);
    try {
      const payload = { ...f, rate: money.toBase(f.rate), code: f.code || null, category: f.category || null, source: f.source || null, notes: f.notes || null };
      onSaved(initial?.id ? await api.updateRate(initial.id, payload) : await api.createRate(payload));
      toast.success("Saved to the library");
    } catch (e: any) { toast.error(e?.message || "Could not save"); }
    finally { setBusy(false); }
  };
  return (
    <div className="border-t border-[#222A35] bg-[#0A0E14] p-5 space-y-3">
      <div className="text-[12.5px] text-white">{initial?.id ? "Edit rate" : "Add a rate"}</div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Field label="Description" className="sm:col-span-3"><input value={f.description} onChange={set("description")} placeholder="12mm cement/sand plaster to internal walls" className={input} /></Field>
        <Field label="Unit"><select value={f.unit} onChange={set("unit")} className={input}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select></Field>
        <Field label={money.unit("Rate")}><input type="number" value={f.rate} onChange={set("rate")} className={input} /></Field>
        <Field label="Category"><input value={f.category} onChange={set("category")} placeholder="Finishes" className={input} /></Field>
        <Field label="Ref code"><input value={f.code} onChange={set("code")} placeholder="F-12" className={input} /></Field>
        <Field label="Source" className="sm:col-span-2"><input value={f.source} onChange={set("source")} placeholder="Quote from ABC Ltd, Aug 2026" className={input} /></Field>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className={btnGhost}>Cancel</button>
        <button onClick={save} disabled={busy} className={btnPrimary}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Save</button>
      </div>
    </div>
  );
}
