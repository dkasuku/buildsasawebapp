// ============================================================================
// Payment certificates — interim certificates on the main contract with a
// cumulative valuation history: certificate 1, 2, 3… each showing this period,
// certified to date and the share of the (revised) contract sum that represents.
// A scanned certificate can sit on each row.
// ============================================================================

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, ExternalLink, Loader2, Paperclip, Plus, Receipt, UploadCloud } from "lucide-react";
import api, { absoluteFileUrl, type CertificateDto } from "../../../services/api";
import { pickFiles, useFileUpload } from "../useFileUpload";
import { UploadTray } from "../UploadTray";
import { Bar, Empty, Field, Kpi, Modal, Panel, Pill, btnGhost, btnPrimary, fmtDate, input, statusLabel, statusTone, useMoney } from "./shared";

const STATUSES = [
  { value: "submitted", label: "Submitted" },
  { value: "under_review", label: "Under review" },
  { value: "approved", label: "Certified" },
  { value: "paid", label: "Paid" },
  { value: "rejected", label: "Rejected" },
];

export function CertificatesFolder({
  projectId, certificates, contractSum, revisedContractSum, canEdit, onChanged, onSetContractSum,
}: {
  projectId: string;
  certificates: CertificateDto[];
  contractSum: number | null;
  revisedContractSum: number | null;
  canEdit: boolean;
  onChanged: () => void | Promise<void>;
  onSetContractSum: () => void;
}) {
  const { fmt } = useMoney();
  const [adding, setAdding] = useState(false);
  const totals = useMemo(() => {
    const certified = certificates.reduce((s, c) => s + (Number(c.requestedAmount) || 0), 0);
    const retention = certificates.reduce((s, c) => s + (Number(c.retentionAmount) || 0), 0);
    const paid = certificates.filter((c) => c.status === "paid").reduce((s, c) => s + (Number(c.netPayable) || 0), 0);
    const awaiting = certificates.filter((c) => c.status !== "paid" && c.status !== "rejected").reduce((s, c) => s + (Number(c.netPayable) || 0), 0);
    const base = revisedContractSum ?? contractSum;
    return { certified, retention, paid, awaiting, pct: base ? Math.round((certified / base) * 1000) / 10 : null, remaining: base != null ? base - certified : null };
  }, [certificates, contractSum, revisedContractSum]);

  const setStatus = async (c: CertificateDto, status: string) => {
    try { await api.updateCertificate(projectId, c.id, { status }); await onChanged(); }
    catch (e: any) { toast.error(e?.message || "Could not update"); }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Certified to date" value={fmt(totals.certified)} sub={totals.pct != null ? `${totals.pct}% of the ${revisedContractSum != null && revisedContractSum !== contractSum ? "revised " : ""}contract sum` : <button onClick={onSetContractSum} className="text-[#FF6B1A] hover:underline">Set a contract sum to see the %</button>} />
        <Kpi label="Paid" value={fmt(totals.paid)} tone="good" sub={totals.awaiting ? `${fmt(totals.awaiting)} certified, awaiting payment` : "nothing outstanding"} />
        <Kpi label="Retention held" value={fmt(totals.retention)} tone="warn" sub="deducted across certificates" />
        <Kpi label="Still to certify" value={totals.remaining != null ? fmt(Math.max(0, totals.remaining)) : "—"} sub={totals.remaining != null && totals.remaining < 0 ? `certified ${fmt(-totals.remaining)} beyond the contract sum` : "balance of the contract"} />
      </div>
      {totals.pct != null && (
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-4">
          <div className="flex items-center justify-between text-[11.5px] mb-2"><span className="text-[#C2CAD6]">Cumulative valuation against contract</span><span className="text-white font-display">{totals.pct}%</span></div>
          <Bar pct={totals.pct} tone={totals.pct > 100 ? "bad" : "brand"} className="h-2.5" />
        </div>
      )}

      <Panel
        title="Certificate history"
        subtitle={`${certificates.length} certificate${certificates.length === 1 ? "" : "s"} · running totals against the contract sum`}
        action={canEdit && <button onClick={() => setAdding(true)} className={btnPrimary}><Plus className="w-3.5 h-3.5" /> Record certificate</button>}
      >
        {certificates.length === 0 ? (
          <Empty icon={Receipt} title="No payment certificates yet" hint="Record each interim certificate as it is issued. The cumulative valuation, retention and balance are worked out for you.">
            {canEdit && <button onClick={() => setAdding(true)} className={btnPrimary}><Plus className="w-3.5 h-3.5" /> Record the first certificate</button>}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-[12px]">
              <thead>
                <tr className="text-[10px] text-[#5B6675] uppercase tracking-wider border-b border-[#222A35]">
                  <th className="text-left px-4 py-2">Cert.</th>
                  <th className="text-left px-3 py-2">Period</th>
                  <th className="text-right px-3 py-2">This period</th>
                  <th className="text-right px-3 py-2">Certified to date</th>
                  <th className="text-right px-3 py-2">% of contract</th>
                  <th className="text-right px-3 py-2">Retention</th>
                  <th className="text-right px-3 py-2">Net payable</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="px-3 py-2">File</th>
                </tr>
              </thead>
              <tbody>
                {certificates.map((c) => (
                  <CertRow key={c.id} c={c} projectId={projectId} canEdit={canEdit} onChanged={onChanged} onStatus={(s) => setStatus(c, s)} fmt={fmt} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {adding && <CertificateForm projectId={projectId} previousCertified={totals.certified} nextNumber={`IPC-${String(certificates.length + 1).padStart(2, "0")}`} onClose={() => setAdding(false)} onDone={async () => { setAdding(false); await onChanged(); }} />}
    </div>
  );
}

function CertRow({ c, projectId, canEdit, onChanged, onStatus, fmt }: { c: CertificateDto; projectId: string; canEdit: boolean; onChanged: () => void | Promise<void>; onStatus: (s: string) => void; fmt: (n: number | null | undefined) => string }) {
  const uploader = useFileUpload();
  const [busy, setBusy] = useState(false);
  const attach = async () => {
    const [f] = await pickFiles({ accept: ".pdf,.png,.jpg,.jpeg" });
    if (!f) return;
    setBusy(true);
    try {
      const [url] = await uploader.upload([f]);
      if (url) { await api.updateCertificate(projectId, c.id, { fileUrl: url }); await onChanged(); }
    } catch (e: any) { toast.error(e?.message || "Could not attach"); }
    finally { setBusy(false); uploader.reset(); }
  };
  return (
    <tr className="border-b border-[#222A35]/60 hover:bg-[#161C24]/40">
      <td className="px-4 py-2.5 font-mono text-[11px] text-white whitespace-nowrap">{c.number}</td>
      <td className="px-3 py-2.5 text-[#C2CAD6] whitespace-nowrap">{c.period || (c.periodEnd ? fmtDate(c.periodEnd, { month: "short", year: "numeric" }) : fmtDate(c.createdAt))}</td>
      <td className="px-3 py-2.5 text-right text-white tabular-nums">{fmt(c.requestedAmount)}</td>
      <td className="px-3 py-2.5 text-right text-white tabular-nums">{fmt(c.cumulative)}</td>
      <td className="px-3 py-2.5 text-right text-[#8A95A5] tabular-nums">{c.pctOfContract != null ? `${c.pctOfContract}%` : "—"}</td>
      <td className="px-3 py-2.5 text-right text-[#F5A623] tabular-nums">{c.retentionAmount ? fmt(c.retentionAmount) : "—"}</td>
      <td className="px-3 py-2.5 text-right text-white tabular-nums">{fmt(c.netPayable)}</td>
      <td className="px-3 py-2.5">
        {canEdit ? (
          <select value={c.status} onChange={(e) => onStatus(e.target.value)} className="h-7 bg-[#0A0E14] border border-[#222A35] rounded px-1.5 text-[11px] text-[#C2CAD6]">
            {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        ) : <Pill tone={statusTone(c.status)}>{STATUSES.find((s) => s.value === c.status)?.label || statusLabel(c.status)}</Pill>}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        {c.fileUrl ? (
          <a href={absoluteFileUrl(c.fileUrl)} target="_blank" rel="noreferrer" className="text-[11px] text-[#FF6B1A] hover:underline inline-flex items-center gap-1"><ExternalLink className="w-3 h-3" /> Open</a>
        ) : canEdit ? (
          <button onClick={attach} disabled={busy} className="text-[11px] text-[#8A95A5] hover:text-white inline-flex items-center gap-1">{busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Paperclip className="w-3 h-3" />} Attach</button>
        ) : <span className="text-[11px] text-[#5B6675]">—</span>}
        {uploader.pending.length > 0 && <div className="mt-1 w-48"><UploadTray state={uploader} /></div>}
      </td>
    </tr>
  );
}

function CertificateForm({ projectId, previousCertified, nextNumber, onClose, onDone }: { projectId: string; previousCertified: number; nextNumber: string; onClose: () => void; onDone: () => Promise<void> }) {
  const money = useMoney();
  const { fmt } = money;
  const uploader = useFileUpload();
  const [f, setF] = useState({ number: nextNumber, period: "", periodEnd: "", mode: "period" as "period" | "todate", amount: "", retentionPct: "5", advanceRecovery: "0", status: "submitted", comments: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  // Typed in the chosen currency; everything below is in the KES base.
  const amountKES = money.toBase(f.amount);
  const advanceKES = money.toBase(f.advanceRecovery);
  const thisPeriod = f.mode === "todate" ? amountKES - previousCertified : amountKES;
  const retention = Math.round(thisPeriod * (Number(f.retentionPct) || 0)) / 100;
  const net = thisPeriod - retention - advanceKES;

  const save = async () => {
    if (!(amountKES > 0)) return toast.error("Enter the certified amount");
    if (thisPeriod <= 0) return toast.error(`The valuation to date must be more than the ${fmt(previousCertified)} already certified`);
    setBusy(true);
    try {
      let fileUrl: string | undefined;
      if (file) { const [u] = await uploader.upload([file]); fileUrl = u; }
      await api.createCertificate(projectId, {
        number: f.number || undefined, period: f.period || undefined, periodEnd: f.periodEnd || undefined,
        ...(f.mode === "todate" ? { valuationToDate: amountKES } : { amount: amountKES }),
        retentionPct: Number(f.retentionPct) || 0, advanceRecovery: advanceKES, status: f.status, fileUrl, comments: f.comments || undefined,
      });
      toast.success(`${f.number || "Certificate"} recorded`);
      await onDone();
    } catch (e: any) { toast.error(e?.message || "Could not record the certificate"); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Record a payment certificate" subtitle={`Previously certified: ${fmt(previousCertified)}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Certificate no."><input value={f.number} onChange={set("number")} className={`${input} font-mono`} /></Field>
          <Field label="Period"><input value={f.period} onChange={set("period")} placeholder="Aug 2026" className={input} /></Field>
          <Field label="Valuation date"><input type="date" value={f.periodEnd} onChange={set("periodEnd")} className={input} /></Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="The certificate states">
            <select value={f.mode} onChange={set("mode")} className={input}>
              <option value="period">Amount for this period</option>
              <option value="todate">Gross valuation to date</option>
            </select>
          </Field>
          <Field label={money.unit("Amount")}><input type="number" min={0} value={f.amount} onChange={set("amount")} className={input} /></Field>
          <Field label="Retention %"><input type="number" min={0} max={20} step={0.5} value={f.retentionPct} onChange={set("retentionPct")} className={input} /></Field>
          <Field label={money.unit("Advance recovered")}><input type="number" min={0} value={f.advanceRecovery} onChange={set("advanceRecovery")} className={input} /></Field>
        </div>
        <div className="rounded-lg border border-[#222A35] bg-[#0A0E14] p-3 grid grid-cols-3 gap-2 text-center">
          <div><div className="text-[10px] text-[#5B6675] uppercase">This period</div><div className="text-[13px] text-white tabular-nums">{fmt(Math.max(0, thisPeriod))}</div></div>
          <div><div className="text-[10px] text-[#5B6675] uppercase">Retention</div><div className="text-[13px] text-[#F5A623] tabular-nums">{fmt(retention)}</div></div>
          <div><div className="text-[10px] text-[#5B6675] uppercase">Net payable</div><div className="text-[13px] text-[#22C55E] tabular-nums">{fmt(Math.max(0, net))}</div></div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Status"><select value={f.status} onChange={set("status")} className={input}>{STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></Field>
          <Field label="Scanned certificate">
            <button onClick={async () => { const [x] = await pickFiles({ accept: ".pdf,.png,.jpg,.jpeg" }); if (x) setFile(x); }} className={`${btnGhost} w-full justify-start truncate`}><UploadCloud className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">{file ? file.name : "Attach PDF or photo (optional)"}</span></button>
          </Field>
        </div>
        {uploader.pending.length > 0 && <UploadTray state={uploader} />}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className={btnGhost}>Cancel</button>
          <button onClick={save} disabled={busy} className={btnPrimary}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Record certificate</button>
        </div>
      </div>
    </Modal>
  );
}
