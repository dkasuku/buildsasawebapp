// ============================================================================
// Bill of Quantities — the priced breakdown of the works.
//
// Until now the product could tender a job and manage it, but never PRICE one, so
// the budget had no origin: expense categories carried a figure typed from nowhere
// and "budget vs actual" compared actuals against a guess. This is where the
// estimate is built, and where it becomes the budget.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, ChevronDown, ChevronRight, Calculator, AlertTriangle, Check } from "lucide-react";
import api, { type BoqDto, type BoqSectionDto } from "../../services/api";
import { useCurrency } from "./CurrencyContext";
import { formatCurrency } from "./currency";
import { EmptyState } from "./EmptyState";

// The units a bill is actually priced in on site here.
const UNITS = ["m", "m2", "m3", "kg", "tonne", "no", "item", "sum", "days", "hours"];

export function BoqEditor({ projectId, canEdit }: { projectId?: string; canEdit: boolean }) {
  const { currency } = useCurrency();
  // BOQ rates are entered and stored in the KES base, like every other figure the
  // estimator works with.
  const fmt = (kes: number) => formatCurrency(Math.round(Number(kes) || 0), currency);

  const [boq, setBoq] = useState<BoqDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [newSection, setNewSection] = useState({ code: "", title: "" });
  const [draft, setDraft] = useState<Record<string, { code: string; description: string; unit: string; quantity: string; rate: string }>>({});

  const load = useCallback(async () => {
    if (!projectId) { setBoq(null); return; }
    setLoading(true);
    try { setBoq(await api.getBoq(projectId)); }
    catch (e: any) { toast.error(e?.message || "Could not load the bill of quantities"); setBoq(null); }
    finally { setLoading(false); }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const blankDraft = { code: "", description: "", unit: "m3", quantity: "", rate: "" };
  const draftFor = (sectionId: string) => draft[sectionId] || blankDraft;
  const setDraftFor = (sectionId: string, patch: Partial<typeof blankDraft>) =>
    setDraft((d) => ({ ...d, [sectionId]: { ...draftFor(sectionId), ...patch } }));

  // Shown live as the estimator types, so a mis-keyed rate is obvious before the
  // line is saved rather than after it has moved the total.
  const draftAmount = (sectionId: string) => {
    const d = draftFor(sectionId);
    return (Number(d.quantity) || 0) * (Number(d.rate) || 0);
  };

  const addSection = async () => {
    if (!projectId) return;
    if (!newSection.title.trim()) return toast.error("Give the section a title, e.g. Substructure");
    setBusy(true);
    try {
      await api.addBoqSection(projectId, { title: newSection.title.trim(), code: newSection.code.trim() || undefined });
      setNewSection({ code: "", title: "" });
      await load();
    } catch (e: any) { toast.error(e?.message || "Could not add that section"); }
    finally { setBusy(false); }
  };

  const addItem = async (sectionId: string) => {
    const d = draftFor(sectionId);
    if (!d.description.trim()) return toast.error("Describe the item being priced");
    setBusy(true);
    try {
      await api.addBoqItem(sectionId, {
        code: d.code.trim() || undefined,
        description: d.description.trim(),
        unit: d.unit,
        quantity: Number(d.quantity) || 0,
        rate: Number(d.rate) || 0,
      });
      setDraft((x) => ({ ...x, [sectionId]: blankDraft }));
      await load();
    } catch (e: any) { toast.error(e?.message || "Could not add that item"); }
    finally { setBusy(false); }
  };

  const removeItem = async (id: string) => {
    setBusy(true);
    try { await api.deleteBoqItem(id); await load(); }
    catch (e: any) { toast.error(e?.message || "Could not remove that item"); }
    finally { setBusy(false); }
  };

  const removeSection = async (s: BoqSectionDto) => {
    if (!confirm(`Delete "${s.title}" and its ${s.items.length} priced item${s.items.length === 1 ? "" : "s"}?`)) return;
    setBusy(true);
    try { await api.deleteBoqSection(s.id); await load(); }
    catch (e: any) { toast.error(e?.message || "Could not delete that section"); }
    finally { setBusy(false); }
  };

  const applyBudget = async () => {
    if (!projectId || !boq) return;
    if (boq.unpricedItems > 0 &&
      !confirm(`${boq.unpricedItems} item${boq.unpricedItems === 1 ? " has" : "s have"} no rate and will contribute nothing. Apply the budget anyway?`)) return;
    setBusy(true);
    try {
      const r = await api.applyBoqBudget(projectId);
      toast.success(`Budget set from the bill — ${r.created} categor${r.created === 1 ? "y" : "ies"} created, ${r.updated} updated`);
    } catch (e: any) { toast.error(e?.message || "Could not apply the budget"); }
    finally { setBusy(false); }
  };

  const total = boq?.total ?? 0;
  const priced = useMemo(() => (boq?.itemCount ?? 0) - (boq?.unpricedItems ?? 0), [boq]);

  if (!projectId) {
    return <EmptyState icon={Calculator} title="No project selected" description="Choose a project to build or view its bill of quantities." />;
  }
  if (loading) {
    return <div className="text-[12px] text-[#8A95A5] flex items-center gap-2 py-16 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading the bill…</div>;
  }

  return (
    <div className="space-y-4">
      {/* Headline: the total is the number that becomes the budget, so it leads. */}
      <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex-1">
          <div className="text-[11px] text-[#8A95A5]">Bill total</div>
          <div className="text-[24px] text-white font-display mt-0.5">{fmt(total)}</div>
          <div className="text-[11px] text-[#5B6675] mt-1">
            {priced} priced item{priced === 1 ? "" : "s"}
            {(boq?.unpricedItems ?? 0) > 0 && (
              <span className="text-[#F5A623]"> · {boq!.unpricedItems} with no rate</span>
            )}
          </div>
        </div>
        {canEdit && (boq?.sections.length ?? 0) > 0 && (
          <button onClick={applyBudget} disabled={busy} className="h-9 px-4 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[12px] flex items-center gap-1.5 disabled:opacity-60 shrink-0">
            <Check className="w-3.5 h-3.5" /> Use as project budget
          </button>
        )}
      </div>

      {/* An unpriced line adds nothing to the total, so a bill can look finished
          while money is still missing from it. Say so rather than let the total
          imply more certainty than it has. */}
      {(boq?.unpricedItems ?? 0) > 0 && (
        <div className="rounded-xl border border-[#F5A623]/40 bg-[#F5A623]/10 px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-[#F5A623] shrink-0 mt-0.5" />
          <div className="text-[12px] text-[#E6EAF0]">
            {boq!.unpricedItems} item{boq!.unpricedItems === 1 ? " has" : "s have"} no rate. {boq!.unpricedItems === 1 ? "It contributes" : "They contribute"} nothing to the {fmt(total)} above, so the bill is not yet complete.
          </div>
        </div>
      )}

      {(boq?.sections.length ?? 0) === 0 ? (
        <div className="rounded-xl border border-[#222A35] bg-[#11161D]">
          <EmptyState
            icon={Calculator}
            title="No bill of quantities yet"
            description="Break the works into sections — Substructure, Superstructure, Finishes — then price the items under each. The total becomes this project's budget."
          />
        </div>
      ) : (
        <div className="space-y-3">
          {boq!.sections.map((s) => {
            const isCollapsed = collapsed[s.id];
            const d = draftFor(s.id);
            return (
              <div key={s.id} className="rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
                <div className="flex items-center gap-2 px-4 h-12 border-b border-[#222A35]">
                  <button onClick={() => setCollapsed((c) => ({ ...c, [s.id]: !c[s.id] }))} className="text-[#8A95A5] hover:text-white">
                    {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {s.code && <span className="text-[11px] font-mono text-[#5B6675]">{s.code}</span>}
                  <span className="text-[13px] text-white font-display truncate">{s.title}</span>
                  <span className="text-[10px] text-[#5B6675]">{s.items.length} item{s.items.length === 1 ? "" : "s"}</span>
                  <span className="ml-auto text-[13px] text-white tabular-nums">{fmt(s.total)}</span>
                  {canEdit && (
                    <button onClick={() => removeSection(s)} className="w-7 h-7 rounded flex items-center justify-center text-[#5B6675] hover:text-[#EF4444] hover:bg-[#EF4444]/10 shrink-0" title="Delete section">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {!isCollapsed && (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[760px] text-[12px]">
                        <thead>
                          <tr className="text-[10px] text-[#5B6675] uppercase tracking-wider border-b border-[#222A35]">
                            <th className="text-left px-4 py-2">Ref</th>
                            <th className="text-left px-3 py-2">Description</th>
                            <th className="text-left px-3 py-2">Unit</th>
                            <th className="text-right px-3 py-2">Qty</th>
                            <th className="text-right px-3 py-2">Rate</th>
                            <th className="text-right px-3 py-2">Amount</th>
                            {canEdit && <th className="px-3 py-2" />}
                          </tr>
                        </thead>
                        <tbody>
                          {s.items.length === 0 && (
                            <tr><td colSpan={canEdit ? 7 : 6} className="px-4 py-4 text-[11px] text-[#5B6675]">Nothing priced under this section yet.</td></tr>
                          )}
                          {s.items.map((it) => (
                            <tr key={it.id} className="border-b border-[#222A35]/60">
                              <td className="px-4 py-2 font-mono text-[11px] text-[#8A95A5]">{it.code || "—"}</td>
                              <td className="px-3 py-2 text-white">{it.description}</td>
                              <td className="px-3 py-2 text-[#8A95A5]">{it.unit}</td>
                              <td className="px-3 py-2 text-right text-[#C2CAD6] tabular-nums">{it.quantity}</td>
                              {/* A rate of zero is called out rather than shown as a
                                  plausible-looking dash, because it silently removes
                                  the line from the total. */}
                              <td className={`px-3 py-2 text-right tabular-nums ${it.rate ? "text-[#C2CAD6]" : "text-[#F5A623]"}`}>
                                {it.rate ? fmt(it.rate) : "not priced"}
                              </td>
                              <td className="px-3 py-2 text-right text-white tabular-nums">{fmt(it.amount)}</td>
                              {canEdit && (
                                <td className="px-3 py-2 text-right">
                                  <button onClick={() => removeItem(it.id)} className="w-7 h-7 rounded inline-flex items-center justify-center text-[#5B6675] hover:text-[#EF4444] hover:bg-[#EF4444]/10">
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {canEdit && (
                      <div className="p-3 border-t border-[#222A35] grid grid-cols-2 sm:grid-cols-7 gap-2 text-[12px]">
                        <input value={d.code} onChange={(e) => setDraftFor(s.id, { code: e.target.value })} placeholder="2.1" className="h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white placeholder:text-[#3A4350] focus:outline-none focus:border-[#FF6B1A]" />
                        <input value={d.description} onChange={(e) => setDraftFor(s.id, { description: e.target.value })} placeholder="Description of the work" className="sm:col-span-2 h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white placeholder:text-[#3A4350] focus:outline-none focus:border-[#FF6B1A]" />
                        <select value={d.unit} onChange={(e) => setDraftFor(s.id, { unit: e.target.value })} className="h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white focus:outline-none focus:border-[#FF6B1A]">
                          {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                        </select>
                        <input value={d.quantity} onChange={(e) => setDraftFor(s.id, { quantity: e.target.value })} type="number" placeholder="Qty" className="h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white text-right placeholder:text-[#3A4350] focus:outline-none focus:border-[#FF6B1A]" />
                        <input value={d.rate} onChange={(e) => setDraftFor(s.id, { rate: e.target.value })} type="number" placeholder="Rate" className="h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white text-right placeholder:text-[#3A4350] focus:outline-none focus:border-[#FF6B1A]" />
                        <div className="flex items-center gap-2">
                          <span className="flex-1 text-right text-[11px] text-[#8A95A5] tabular-nums">{draftAmount(s.id) > 0 ? fmt(draftAmount(s.id)) : ""}</span>
                          <button onClick={() => addItem(s.id)} disabled={busy} className="h-9 px-3 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white disabled:opacity-60 shrink-0">Add</button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {canEdit && (
        <div className="rounded-xl border border-dashed border-[#222A35] bg-[#0A0E14] p-3 flex flex-col sm:flex-row gap-2 text-[12px]">
          <input value={newSection.code} onChange={(e) => setNewSection((s) => ({ ...s, code: e.target.value }))} placeholder="Ref" className="sm:w-20 h-9 bg-[#11161D] border border-[#222A35] rounded-md px-2 text-white placeholder:text-[#3A4350] focus:outline-none focus:border-[#FF6B1A]" />
          <input value={newSection.title} onChange={(e) => setNewSection((s) => ({ ...s, title: e.target.value }))} placeholder="New section — e.g. Substructure" className="flex-1 h-9 bg-[#11161D] border border-[#222A35] rounded-md px-2 text-white placeholder:text-[#3A4350] focus:outline-none focus:border-[#FF6B1A]" />
          <button onClick={addSection} disabled={busy} className="h-9 px-4 rounded-md border border-[#222A35] text-white hover:border-[#FF6B1A]/60 flex items-center justify-center gap-1.5 disabled:opacity-60">
            <Plus className="w-3.5 h-3.5" /> Add section
          </button>
        </div>
      )}
    </div>
  );
}
