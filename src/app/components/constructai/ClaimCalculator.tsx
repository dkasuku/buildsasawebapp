// ============================================================================
// Certify a claim against a subcontract.
//
// A claim is never worth what is claimed. Retention is held back, and any
// mobilisation advance is repaid out of it. Both used to be worked out on paper
// and typed in as a single figure, so the advance quietly went unrecovered and the
// subcontract balance was overstated for the life of the job.
//
// The breakdown is fetched from the server before anything is saved, so what is
// previewed and what is recorded are produced by the same arithmetic — a
// calculator that agrees with itself but not with the books is worse than none.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Calculator, AlertTriangle } from "lucide-react";
import api, { type CommitmentDto, type ClaimPreviewDto } from "../../services/api";
import { useCurrency } from "./CurrencyContext";
import { CURRENCIES, formatCurrency } from "./currency";

export function ClaimCalculator({
  commitment, onClose, onRecorded,
}: {
  commitment: CommitmentDto;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const { currency } = useCurrency();
  const fmt = (kes: number) => formatCurrency(Math.round(Number(kes) || 0), currency);

  const [gross, setGross] = useState("");
  const [retentionPct, setRetentionPct] = useState(String(Number(commitment.retentionPct) || 0));
  const [preview, setPreview] = useState<ClaimPreviewDto | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);

  const advance = Number(commitment.advanceAmount) || 0;
  const recovered = Number(commitment.advanceRecovered) || 0;
  const advanceOutstanding = Math.max(0, advance - recovered);

  // Debounced so a preview is not fired on every keystroke, and cancelled on
  // unmount so a late response cannot overwrite a newer one.
  const refresh = useCallback(() => {
    const amount = Number(gross) || 0;
    if (amount <= 0) { setPreview(null); return () => {}; }
    let alive = true;
    setPreviewing(true);
    const t = setTimeout(() => {
      api.previewClaim(commitment.id, { grossClaim: amount, retentionPct: Number(retentionPct) || 0 })
        .then((p) => { if (alive) setPreview(p); })
        .catch(() => { if (alive) setPreview(null); })
        .finally(() => { if (alive) setPreviewing(false); });
    }, 350);
    return () => { alive = false; clearTimeout(t); setPreviewing(false); };
  }, [gross, retentionPct, commitment.id]);
  useEffect(() => refresh(), [refresh]);

  const record = async () => {
    const amount = Number(gross) || 0;
    if (amount <= 0) return toast.error("Enter the amount being claimed");
    setSaving(true);
    try {
      await api.recordClaim(commitment.id, { grossClaim: amount, retentionPct: Number(retentionPct) || 0 });
      toast.success(`Claim certified — ${fmt(preview?.netPayable ?? 0)} payable`);
      onRecorded();
      onClose();
    } catch (e: any) { toast.error(e?.message || "Could not certify that claim"); }
    finally { setSaving(false); }
  };

  const Row = ({ label, value, tone, strong }: { label: string; value: string; tone?: string; strong?: boolean }) => (
    <div className="flex items-center justify-between py-1.5">
      <span className={`text-[12px] ${strong ? "text-white" : "text-[#8A95A5]"}`}>{label}</span>
      <span className={`text-[13px] tabular-nums ${tone || (strong ? "text-white" : "text-[#C2CAD6]")} ${strong ? "font-display" : ""}`}>{value}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-[#222A35] bg-[#11161D] max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#222A35] flex items-center gap-2">
          <Calculator className="w-4 h-4 text-[#FF6B1A]" />
          <div className="min-w-0">
            <div className="text-[14px] text-white font-display truncate">Certify a claim</div>
            <div className="text-[11px] text-[#8A95A5] truncate">{commitment.vendor} · {commitment.scope}</div>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {advance > 0 && (
            <div className="rounded-md border border-[#3B82F6]/30 bg-[#3B82F6]/10 px-3 py-2.5 text-[11px] text-[#C2CAD6]">
              Advance of {fmt(advance)} paid up front · {fmt(advanceOutstanding)} still to recover
              {Number(commitment.advanceRecoveryPct) > 0
                ? ` at ${commitment.advanceRecoveryPct}% of each claim.`
                : <span className="text-[#F5A623]"> — no recovery rate set, so nothing will be repaid.</span>}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[#8A95A5] block mb-1">Claimed ({CURRENCIES[currency].code})</label>
              <input type="number" value={gross} onChange={(e) => setGross(e.target.value)} placeholder="0" autoFocus className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[13px] text-white placeholder:text-[#3A4350] focus:outline-none focus:border-[#FF6B1A]" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[#8A95A5] block mb-1">Retention %</label>
              <input type="number" value={retentionPct} onChange={(e) => setRetentionPct(e.target.value)} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
            </div>
          </div>

          {/* The breakdown, straight from the server. Nothing here is computed in
              the browser, so the figure shown is the figure that will be written. */}
          <div className="rounded-md border border-[#222A35] bg-[#0A0E14] px-3 py-2">
            {previewing && !preview ? (
              <div className="text-[12px] text-[#5B6675] py-3 text-center"><Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1.5" /> Working it out…</div>
            ) : !preview ? (
              <div className="text-[12px] text-[#5B6675] py-3 text-center">Enter an amount to see what it pays.</div>
            ) : (
              <>
                <Row label="Claimed" value={fmt(preview.gross)} />
                <Row label={`Less retention (${preview.retentionPct}%)`} value={`− ${fmt(preview.retentionAmount)}`} tone="text-[#F5A623]" />
                <Row label="Less advance recovered" value={`− ${fmt(preview.advanceRecovery)}`} tone="text-[#3B82F6]" />
                <div className="border-t border-[#222A35] mt-1 pt-1">
                  <Row label="Net payable" value={fmt(preview.netPayable)} strong tone="text-[#22C55E]" />
                </div>
                {advance > 0 && (
                  <div className="text-[10.5px] text-[#5B6675] mt-1.5 pt-1.5 border-t border-[#222A35]">
                    Advance outstanding after this claim: {fmt(preview.advanceOutstandingAfter)}
                    {preview.advanceOutstandingAfter === 0 && <span className="text-[#22C55E]"> — fully recovered</span>}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Recovering nothing when an advance is outstanding is almost always a
              missing recovery rate rather than a decision. */}
          {preview && advanceOutstanding > 0 && preview.advanceRecovery === 0 && (
            <div className="flex items-start gap-2 text-[11px] text-[#F5A623]">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{fmt(advanceOutstanding)} of advance is outstanding but nothing is being recovered from this claim. Check the recovery rate on the subcontract.</span>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 h-10 rounded-md border border-[#222A35] text-[12px] text-white">Cancel</button>
            <button onClick={record} disabled={saving || !preview} className="flex-1 h-10 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[12px] disabled:opacity-50 flex items-center justify-center gap-1.5">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {preview ? `Certify ${fmt(preview.netPayable)}` : "Certify"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
