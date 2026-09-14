// ============================================================================
// Variations / change orders, read like a ledger against the contract sum:
//
//   Original contract sum
//   + approved additions  − approved omissions
//   = Revised contract sum          (pending variations shown, not counted)
//
// Every variation names its cause and can carry the documents that justify it
// (instruction letter, revised drawing, photos). Rows are ordinary change orders
// — the Change Orders module shows the same records.
// ============================================================================

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, FileText, Loader2, Paperclip, Plus, Wrench, Check, X as XIcon, Pencil } from "lucide-react";
import api, { type DocumentDto, type VariationDto } from "../../../services/api";
import { UploadTray } from "../UploadTray";
import { useDocumentUpload } from "./DocumentFolder";
import { DocRow, Empty, Field, Kpi, Modal, Panel, Pill, btnGhost, btnPrimary, fmtDate, input, statusLabel, statusTone, textarea, useMoney } from "./shared";

export const CAUSES = [
  "Client instruction",
  "Design change",
  "Provisional sum adjustment",
  "Prime cost sum adjustment",
  "Unforeseen site condition",
  "Statutory / authority requirement",
  "Error or omission in documents",
  "Re-measurement",
  "Other",
];
const STATUSES: { value: string; label: string }[] = [
  { value: "drafted", label: "Drafted" },
  { value: "pm_review", label: "Under review" },
  { value: "owner_approval", label: "Awaiting client approval" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "void", label: "Void" },
];

export function VariationsFolder({
  projectId, variations, contractSum, canEdit, canApprove, onChanged, onSetContractSum,
}: {
  projectId: string;
  variations: VariationDto[];
  contractSum: number | null;
  canEdit: boolean;
  canApprove: boolean;
  onChanged: () => void | Promise<void>;
  onSetContractSum: () => void;
}) {
  const { fmt, signed } = useMoney();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<VariationDto | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const totals = useMemo(() => {
    const approved = variations.filter((v) => v.status === "approved");
    const additions = approved.filter((v) => v.amountKES > 0).reduce((s, v) => s + v.amountKES, 0);
    const omissions = approved.filter((v) => v.amountKES < 0).reduce((s, v) => s + v.amountKES, 0);
    const pending = variations.filter((v) => ["drafted", "pm_review", "owner_approval"].includes(v.status)).reduce((s, v) => s + v.amountKES, 0);
    const net = additions + omissions;
    return { additions, omissions, pending, net, revised: contractSum != null ? contractSum + net : null, pendingCount: variations.filter((v) => ["drafted", "pm_review", "owner_approval"].includes(v.status)).length };
  }, [variations, contractSum]);

  return (
    <div className="space-y-4">
      {/* The running total, as a QS would write it */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Original contract sum" value={contractSum != null ? fmt(contractSum) : <button onClick={onSetContractSum} className="text-[13px] text-[#FF6B1A] hover:underline">Set contract sum</button>} sub="as agreed" />
        <Kpi label="Approved variations" value={totals.net === 0 ? "—" : signed(totals.net)} tone={totals.net > 0 ? "warn" : totals.net < 0 ? "good" : undefined} sub={`${signed(totals.additions)} additions · ${totals.omissions ? signed(totals.omissions) : "no"} omissions`} />
        <Kpi label="Revised contract sum" value={totals.revised != null ? fmt(totals.revised) : "—"} tone="brand" sub={contractSum != null && totals.revised != null && contractSum > 0 ? `${totals.net >= 0 ? "+" : ""}${((totals.net / contractSum) * 100).toFixed(1)}% on the original` : "needs a contract sum"} />
        <Kpi label="Pending, not yet counted" value={totals.pendingCount ? signed(totals.pending) : "—"} sub={`${totals.pendingCount} awaiting a decision`} />
      </div>

      <Panel
        title="Variation log"
        subtitle={`${variations.length} logged · approved ones move the revised contract sum`}
        action={canEdit && <button onClick={() => setAdding(true)} className={btnPrimary}><Plus className="w-3.5 h-3.5" /> Log variation</button>}
      >
        {variations.length === 0 ? (
          <Empty icon={Wrench} title="No variations yet" hint="Log each change against the original contract sum with its cause — a client instruction, a design change, a provisional sum adjustment — and attach the letter or drawing that supports it.">
            {canEdit && <button onClick={() => setAdding(true)} className={btnPrimary}><Plus className="w-3.5 h-3.5" /> Log the first variation</button>}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-[12px]">
              <thead>
                <tr className="text-[10px] text-[#5B6675] uppercase tracking-wider border-b border-[#222A35]">
                  <th className="w-8" />
                  <th className="text-left px-3 py-2">No.</th>
                  <th className="text-left px-3 py-2">Variation</th>
                  <th className="text-left px-3 py-2">Cause</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-right px-3 py-2">Amount</th>
                  <th className="text-right px-3 py-2">Running total</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {variations.map((v) => {
                  const expanded = !!open[v.id];
                  const counted = v.status === "approved";
                  return (
                    <VariationRows key={v.id} v={v} expanded={expanded} counted={counted} projectId={projectId} canEdit={canEdit} canApprove={canApprove}
                      onToggle={() => setOpen((o) => ({ ...o, [v.id]: !o[v.id] }))} onEdit={() => setEditing(v)} onChanged={onChanged} fmt={fmt} signed={signed} />
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-[#222A35] bg-[#0A0E14]/60">
                  <td colSpan={5} className="px-3 py-2.5 text-[11px] text-[#8A95A5]">Original {contractSum != null ? fmt(contractSum) : "—"} {signed(totals.net)} approved</td>
                  <td className="px-3 py-2.5 text-right text-white tabular-nums">{signed(totals.net)}</td>
                  <td className="px-3 py-2.5 text-right text-[#FF6B1A] font-display tabular-nums">{totals.revised != null ? fmt(totals.revised) : "—"}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Panel>

      {(adding || editing) && (
        <VariationForm projectId={projectId} initial={editing ?? undefined} canApprove={canApprove} onClose={() => { setAdding(false); setEditing(null); }} onDone={async () => { setAdding(false); setEditing(null); await onChanged(); }} />
      )}
    </div>
  );
}

function VariationRows({ v, expanded, counted, projectId, canEdit, canApprove, onToggle, onEdit, onChanged, fmt, signed }: {
  v: VariationDto; expanded: boolean; counted: boolean; projectId: string; canEdit: boolean; canApprove: boolean;
  onToggle: () => void; onEdit: () => void; onChanged: () => void | Promise<void>; fmt: (n: number | null | undefined) => string; signed: (n: number) => string;
}) {
  const { upload, uploader, pending, busy } = useDocumentUpload(projectId, onChanged);
  const [deciding, setDeciding] = useState(false);
  const decide = async (status: string) => {
    setDeciding(true);
    try { await api.updateVariation(projectId, v.id, { status }); toast.success(`${v.number} ${statusLabel(status).toLowerCase()}`); await onChanged(); }
    catch (e: any) { toast.error(e?.message || "Could not update"); }
    finally { setDeciding(false); }
  };
  const del = async (d: DocumentDto) => {
    try { await api.deleteDocument(d.id); await onChanged(); } catch (e: any) { toast.error(e?.message || "Could not delete"); }
  };
  return (
    <>
      <tr className={`border-b border-[#222A35]/60 ${expanded ? "bg-[#161C24]/40" : "hover:bg-[#161C24]/40"}`}>
        <td className="pl-3"><button onClick={onToggle} className="text-[#8A95A5] hover:text-white">{expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</button></td>
        <td className="px-3 py-2.5 font-mono text-[11px] text-[#8A95A5] whitespace-nowrap">{v.number}</td>
        <td className="px-3 py-2.5">
          <button onClick={onToggle} className="text-white text-left hover:underline">{v.title}</button>
          <div className="text-[10.5px] text-[#5B6675]">{fmtDate(v.submittedDate || v.createdAt)}{v.requestedBy ? ` · ${v.requestedBy}` : ""}{v.documents.length ? ` · ${v.documents.length} file${v.documents.length === 1 ? "" : "s"}` : ""}{v.scheduleImpactDays ? ` · ${v.scheduleImpactDays}d on programme` : ""}</div>
        </td>
        <td className="px-3 py-2.5 text-[#C2CAD6]">{v.trigger || "—"}</td>
        <td className="px-3 py-2.5"><Pill tone={statusTone(v.status)}>{STATUSES.find((s) => s.value === v.status)?.label || statusLabel(v.status)}</Pill></td>
        <td className={`px-3 py-2.5 text-right tabular-nums ${v.amountKES < 0 ? "text-[#22C55E]" : "text-white"}`}>{signed(v.amountKES)}</td>
        <td className={`px-3 py-2.5 text-right tabular-nums ${counted ? "text-white" : "text-[#5B6675]"}`}>{counted ? fmt(v.runningTotal) : <span title="Not approved, so not counted">—</span>}</td>
        <td className="px-3 py-2.5 text-right whitespace-nowrap">
          {canEdit && <button onClick={onEdit} title="Edit" className="w-7 h-7 rounded inline-flex items-center justify-center text-[#5B6675] hover:text-white"><Pencil className="w-3.5 h-3.5" /></button>}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-[#222A35]">
          <td />
          <td colSpan={7} className="px-3 pb-4 pt-1">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="rounded-lg border border-[#222A35] bg-[#0A0E14] p-3">
                <div className="text-[10px] uppercase tracking-wider text-[#5B6675] mb-1.5">Description</div>
                <p className="text-[12px] text-[#C2CAD6] whitespace-pre-wrap leading-relaxed">{v.description || <span className="text-[#5B6675]">No description.</span>}</p>
                {canApprove && ["drafted", "pm_review", "owner_approval"].includes(v.status) && (
                  <div className="flex gap-2 mt-3 pt-3 border-t border-[#222A35]">
                    <button onClick={() => decide("approved")} disabled={deciding} className={`${btnPrimary} h-8`}><Check className="w-3.5 h-3.5" /> Approve</button>
                    <button onClick={() => decide("rejected")} disabled={deciding} className={`${btnGhost} h-8`}><XIcon className="w-3.5 h-3.5" /> Reject</button>
                    {v.status === "drafted" && <button onClick={() => decide("owner_approval")} disabled={deciding} className={`${btnGhost} h-8`}>Send for client approval</button>}
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-[#222A35] bg-[#0A0E14]">
                <div className="px-3 py-2 border-b border-[#222A35] flex items-center justify-between">
                  <div className="text-[10px] uppercase tracking-wider text-[#5B6675] flex items-center gap-1.5"><Paperclip className="w-3 h-3" /> Supporting documents</div>
                  {canEdit && <button onClick={() => upload({ category: "variation", linkedType: "variation", linkedId: v.id, note: v.number })} disabled={busy} className="text-[11px] text-[#FF6B1A] hover:underline flex items-center gap-1">{busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Attach</button>}
                </div>
                {pending.length > 0 && <div className="p-2"><UploadTray state={uploader} /></div>}
                {v.documents.length === 0 ? (
                  <div className="px-3 py-4 text-[11.5px] text-[#5B6675] flex items-center gap-2"><FileText className="w-3.5 h-3.5" /> No instruction letter or revised drawing attached yet.</div>
                ) : (
                  <div className="divide-y divide-[#222A35]">{v.documents.map((d) => <DocRow key={d.id} doc={d} compact onDelete={canEdit ? del : undefined} />)}</div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function VariationForm({ projectId, initial, canApprove, onClose, onDone }: { projectId: string; initial?: VariationDto; canApprove: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const money = useMoney();
  const [f, setF] = useState({
    title: initial?.title || "",
    cause: initial?.trigger || CAUSES[0],
    kind: (initial?.amountKES ?? 0) < 0 ? "omission" : "addition",
    amount: initial ? money.fromBase(Math.abs(initial.amountKES)) : "",
    description: initial?.description || "",
    status: initial?.status || "drafted",
    scheduleImpactDays: String(initial?.scheduleImpactDays ?? 0),
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  const save = async () => {
    if (!f.title.trim()) return toast.error("Give the variation a title");
    const amt = Math.abs(money.toBase(f.amount));
    if (!amt) return toast.error("Enter the value of the variation");
    const amountKES = f.kind === "omission" ? -amt : amt;
    setBusy(true);
    try {
      const payload = { title: f.title.trim(), cause: f.cause, amountKES, description: f.description || undefined, status: f.status, scheduleImpactDays: Number(f.scheduleImpactDays) || 0 };
      if (initial) await api.updateVariation(projectId, initial.id, payload); else await api.createVariation(projectId, payload);
      toast.success(initial ? "Variation updated" : "Variation logged");
      await onDone();
    } catch (e: any) { toast.error(e?.message || "Could not save"); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={initial ? `Edit ${initial.number}` : "Log a variation"} subtitle="Valued against the original contract sum. Attach the instruction or drawing after saving." onClose={onClose}>
      <div className="space-y-3">
        <Field label="Title"><input autoFocus value={f.title} onChange={set("title")} placeholder="e.g. Additional retaining wall to north boundary" className={input} /></Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Cause"><select value={f.cause} onChange={set("cause")} className={input}>{CAUSES.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Effect on the contract sum">
            <select value={f.kind} onChange={set("kind")} className={input}>
              <option value="addition">Addition (+)</option>
              <option value="omission">Omission (−)</option>
            </select>
          </Field>
          <Field label={money.unit("Amount")}><input type="number" min={0} value={f.amount} onChange={set("amount")} placeholder="0" className={input} /></Field>
          <Field label="Time impact (days)"><input type="number" value={f.scheduleImpactDays} onChange={set("scheduleImpactDays")} className={input} /></Field>
        </div>
        <Field label="Description"><textarea value={f.description} onChange={set("description")} placeholder="What changed, where, and what was instructed." className={textarea} /></Field>
        <Field label="Status" hint={canApprove ? undefined : "Approval is reserved to the contractor, owner, executive or project manager."}>
          <select value={f.status} onChange={set("status")} className={input}>
            {STATUSES.filter((s) => canApprove || !["approved", "rejected"].includes(s.value) || s.value === initial?.status).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className={btnGhost}>Cancel</button>
          <button onClick={save} disabled={busy} className={btnPrimary}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} {initial ? "Save changes" : "Log variation"}</button>
        </div>
      </div>
    </Modal>
  );
}
