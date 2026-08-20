// ============================================================================
// Project closeout — handover, defects liability, final account.
//
// A project's recorded life used to end at "Archived", which skipped the phase
// that carries the most liability: the works are handed over, the client is
// occupying the building, and the contractor is still answerable for defects. None
// of it was recorded, so nobody could answer "are we still on the hook for this
// job?" — or notice that retention was still sitting uncollected.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, CheckCircle2, Clock, AlertTriangle, ShieldCheck, Flag } from "lucide-react";
import api, { type CloseoutDto } from "../../services/api";
import { useCurrency } from "./CurrencyContext";
import { formatCurrency } from "./currency";

const PHASES: { key: string; label: string; hint: string }[] = [
  { key: "in_progress", label: "In progress", hint: "Works are still under construction" },
  { key: "handed_over", label: "Handed over", hint: "Practical completion recorded" },
  { key: "defects_liability", label: "Defects liability", hint: "Client in occupation, you remain liable" },
  { key: "defects_expired", label: "Defects expired", hint: "Liability period has run out" },
  { key: "closed", label: "Closed", hint: "Final account settled" },
];

const asDateInput = (v?: string | null) => (v ? String(v).slice(0, 10) : "");
const asHuman = (v?: string | null) => (v ? new Date(v).toLocaleDateString() : "—");

export function ProjectCloseout({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const { currency } = useCurrency();
  const [data, setData] = useState<CloseoutDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ practicalCompletionAt: "", defectsLiabilityMonths: "", finalAccountAt: "", closeoutNotes: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.getCloseout(projectId);
      setData(d);
      setForm({
        practicalCompletionAt: asDateInput(d.practicalCompletionAt),
        defectsLiabilityMonths: d.defectsLiabilityMonths == null ? "" : String(d.defectsLiabilityMonths),
        finalAccountAt: asDateInput(d.finalAccountAt),
        closeoutNotes: d.closeoutNotes || "",
      });
    } catch (e: any) { toast.error(e?.message || "Could not load closeout"); setData(null); }
    finally { setLoading(false); }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      await api.updateCloseout(projectId, {
        practicalCompletionAt: form.practicalCompletionAt || null,
        defectsLiabilityMonths: form.defectsLiabilityMonths === "" ? null : Number(form.defectsLiabilityMonths),
        finalAccountAt: form.finalAccountAt || null,
        closeoutNotes: form.closeoutNotes || null,
      });
      // Recording practical completion writes the retention release schedule, so
      // say so — the money becoming payable is the consequence that matters.
      toast.success(form.practicalCompletionAt && !data?.practicalCompletionAt
        ? "Handover recorded — retention release scheduled"
        : "Closeout updated");
      await load();
    } catch (e: any) { toast.error(e?.message || "Could not save closeout"); }
    finally { setSaving(false); }
  };

  if (loading) {
    return <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-8 text-center text-[12px] text-[#8A95A5]"><Loader2 className="w-4 h-4 animate-spin inline mr-1.5" /> Loading closeout…</div>;
  }
  if (!data) return null;

  const currentIndex = PHASES.findIndex((p) => p.key === data.phase);

  return (
    <div className="rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
      <div className="px-5 py-4 border-b border-[#222A35] flex items-center gap-2">
        <Flag className="w-4 h-4 text-[#FF6B1A]" />
        <div className="text-[13px] text-white font-display">Handover &amp; closeout</div>
        <div className="text-[11px] text-[#5B6675] ml-auto">{PHASES[currentIndex]?.hint}</div>
      </div>

      {/* Where this job stands. Derived from the dates, so it cannot drift out of
          step with them the way a separately-stored status would. */}
      <div className="px-5 py-4 border-b border-[#222A35]">
        <div className="flex flex-wrap gap-1.5">
          {PHASES.map((p, i) => {
            const done = i < currentIndex;
            const active = i === currentIndex;
            return (
              <div key={p.key} className={`px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider border ${
                active ? "bg-[#FF6B1A]/15 text-[#FF6B1A] border-[#FF6B1A]/40"
                : done ? "bg-[#22C55E]/10 text-[#22C55E] border-[#22C55E]/30"
                : "bg-[#222A35]/40 text-[#5B6675] border-[#222A35]"}`}>
                {done && <CheckCircle2 className="w-3 h-3 inline mr-1 -mt-0.5" />}
                {p.label}
              </div>
            );
          })}
        </div>
      </div>

      {/* What stands between here and a closed job. Naming it is more use than a
          status, because each line is something somebody can go and do. */}
      {data.blockers.length > 0 && (
        <div className="px-5 py-3 border-b border-[#222A35] bg-[#F5A623]/[0.06]">
          <div className="text-[10px] uppercase tracking-wider text-[#F5A623] mb-1.5 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> Before this job can be closed
          </div>
          <ul className="space-y-1">
            {data.blockers.map((b, i) => (
              <li key={i} className="text-[12px] text-[#E6EAF0] flex items-start gap-2">
                <span className="text-[#F5A623] mt-0.5">•</span>{b}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="px-5 py-4 grid grid-cols-2 sm:grid-cols-4 gap-4 border-b border-[#222A35]">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[#5B6675]">Practical completion</div>
          <div className="text-[13px] text-white mt-1">{asHuman(data.practicalCompletionAt)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[#5B6675]">Defects period ends</div>
          <div className="text-[13px] text-white mt-1 flex items-center gap-1.5">
            {asHuman(data.defectsEndAt)}
            {data.phase === "defects_liability" && <Clock className="w-3 h-3 text-[#F5A623]" />}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[#5B6675]">Open punch items</div>
          <div className={`text-[13px] mt-1 ${data.openPunchItems > 0 ? "text-[#F5A623]" : "text-white"}`}>{data.openPunchItems}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[#5B6675] flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> Retention held</div>
          <div className={`text-[13px] mt-1 ${data.retentionStillHeld > 0 ? "text-[#3B82F6]" : "text-white"}`}>
            {formatCurrency(Math.round(data.retentionStillHeld), currency)}
          </div>
        </div>
      </div>

      {canEdit ? (
        <div className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[12px]">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[#8A95A5] block mb-1">Practical completion</label>
              <input type="date" value={form.practicalCompletionAt} onChange={(e) => setForm((f) => ({ ...f, practicalCompletionAt: e.target.value }))} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white focus:outline-none focus:border-[#FF6B1A]" />
              <div className="text-[10px] text-[#5B6675] mt-1">Recording this schedules the retention release.</div>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[#8A95A5] block mb-1">Defects liability (months)</label>
              <input type="number" value={form.defectsLiabilityMonths} onChange={(e) => setForm((f) => ({ ...f, defectsLiabilityMonths: e.target.value }))} placeholder="6" className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white placeholder:text-[#3A4350] focus:outline-none focus:border-[#FF6B1A]" />
              <div className="text-[10px] text-[#5B6675] mt-1">How long you remain liable after handover. Usually 6 or 12.</div>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[#8A95A5] block mb-1">Final account settled</label>
              <input type="date" value={form.finalAccountAt} onChange={(e) => setForm((f) => ({ ...f, finalAccountAt: e.target.value }))} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white focus:outline-none focus:border-[#FF6B1A]" />
              <div className="text-[10px] text-[#5B6675] mt-1">The last money in. This closes the job.</div>
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-[#8A95A5] block mb-1">Closeout notes</label>
            <textarea value={form.closeoutNotes} onChange={(e) => setForm((f) => ({ ...f, closeoutNotes: e.target.value }))} rows={2} placeholder="Outstanding items, agreed deductions, anything the next person needs to know" className="w-full bg-[#0A0E14] border border-[#222A35] rounded-md px-2 py-1.5 text-[12px] text-white placeholder:text-[#3A4350] focus:outline-none focus:border-[#FF6B1A] resize-none" />
          </div>
          <button onClick={save} disabled={saving} className="h-9 px-4 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[12px] flex items-center gap-1.5 disabled:opacity-60">
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save closeout
          </button>
        </div>
      ) : (
        <div className="px-5 py-3 text-[11px] text-[#5B6675]">Closeout dates are set by a project manager or the account owner.</div>
      )}
    </div>
  );
}
