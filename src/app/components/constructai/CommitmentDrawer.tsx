// ============================================================================
// CommitmentDrawer — right-side fixed detail panel for a single commitment.
// Loads getCommitment(projectId, id) for related ledger entries, payment
// applications, retention records + cost code, and pulls an audit trail via
// getApprovals for each of its payment applications.
// ============================================================================

import { useEffect, useState, type ReactNode } from "react";
import { X, Trash2 } from "lucide-react";
import api, {
  type CommitmentDto,
  type PaymentApplicationDto,
  type RetentionRecordDto,
  type LedgerEntryDto,
  type CostCodeDto,
  type ApprovalDto,
} from "../../services/api";

type FullCommitment = CommitmentDto & {
  paymentApplications?: PaymentApplicationDto[];
  retentionRecords?: RetentionRecordDto[];
  ledgerEntries?: LedgerEntryDto[];
};

export default function CommitmentDrawer({
  projectId,
  commitmentId,
  costCodes,
  canDelete,
  fmt,
  onClose,
  onDeleted,
}: {
  projectId: string;
  commitmentId: string;
  costCodes: CostCodeDto[];
  canDelete: boolean;
  fmt: (amountKES: number) => string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<FullCommitment | null>(null);
  const [approvals, setApprovals] = useState<ApprovalDto[]>([]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .getCommitment(projectId, commitmentId)
      .then(async (c) => {
        if (!alive) return;
        setData(c);
        // Build audit trail across this commitment's payment applications.
        const apps = c.paymentApplications ?? [];
        try {
          const trails = await Promise.all(
            apps.map((a) => api.getApprovals("payment_application", a.id).catch(() => [] as ApprovalDto[]))
          );
          if (alive) {
            const merged = trails.flat().sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1));
            setApprovals(merged);
          }
        } catch {
          if (alive) setApprovals([]);
        }
      })
      .catch(() => {
        if (alive) setData(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [projectId, commitmentId]);

  const costCode = data?.costCodeId ? costCodes.find((c) => c.id === data.costCodeId) : undefined;

  const remove = async () => {
    try {
      await api.deleteCommitment(projectId, commitmentId);
      onDeleted();
    } catch {
      // swallow; parent stays open
    }
  };

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-md bg-[#11161D] border-l border-[#222A35] overflow-y-auto">
        <div className="sticky top-0 bg-[#11161D] px-5 py-4 border-b border-[#222A35] flex items-center justify-between z-10">
          <div>
            <div className="text-[13px] text-white font-display">{data?.vendor || "Commitment"}</div>
            <div className="text-[11px] text-[#8A95A5]">{data?.scope || "Commitment detail"}</div>
          </div>
          <button onClick={onClose} className="text-[#8A95A5] hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="p-5 text-[12px] text-[#8A95A5]">Loading…</div>
        ) : !data ? (
          <div className="p-5 text-[12px] text-[#8A95A5]">Couldn't load this commitment.</div>
        ) : (
          <div className="p-5 space-y-5">
            {/* Summary */}
            <div className="grid grid-cols-2 gap-3 text-[12px]">
              <Field label="Contract value" value={fmt(Number(data.contractValue || 0))} />
              <Field label="Approved variations" value={fmt(Number(data.approvedVariations || 0))} />
              <Field label="Invoiced to date" value={fmt(Number(data.invoicedToDate || 0))} />
              <Field label="Paid to date" value={fmt(Number(data.paidToDate || 0))} />
              <Field label="Retention held" value={fmt(Number(data.retentionHeld || 0))} />
              <Field label="Balance remaining" value={fmt(Number(data.balanceRemaining || 0))} />
              <Field label="Retention %" value={`${Number(data.retentionPct || 0)}%`} />
              <Field label="Status" value={data.status || "active"} />
              <Field label="Cost code" value={costCode ? `${costCode.code}${costCode.description ? ` — ${costCode.description}` : ""}` : "—"} />
            </div>

            {/* Payment applications */}
            <Section title="Payment applications">
              {(data.paymentApplications ?? []).length === 0 ? (
                <Muted>No applications linked.</Muted>
              ) : (
                <div className="space-y-1.5">
                  {data.paymentApplications!.map((a) => (
                    <div key={a.id} className="flex items-center justify-between text-[12px] text-[#C2CAD6] border border-[#222A35] rounded-md px-3 py-2">
                      <span>
                        #{a.number} {a.period ? `· ${a.period}` : ""}
                      </span>
                      <span className="flex items-center gap-2">
                        <span>{fmt(Number(a.netPayable || 0))}</span>
                        <span className="text-[10px] text-[#8A95A5]">{a.status}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Retention records */}
            <Section title="Retention records">
              {(data.retentionRecords ?? []).length === 0 ? (
                <Muted>No retention records.</Muted>
              ) : (
                <div className="space-y-1.5">
                  {data.retentionRecords!.map((r) => (
                    <div key={r.id} className="flex items-center justify-between text-[12px] text-[#C2CAD6] border border-[#222A35] rounded-md px-3 py-2">
                      <span>Held {fmt(Number(r.amountHeld || 0))} · Released {fmt(Number(r.amountReleased || 0))}</span>
                      <span className="text-[10px] text-[#8A95A5]">{r.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Related ledger entries */}
            <Section title="Related ledger entries">
              {(data.ledgerEntries ?? []).length === 0 ? (
                <Muted>No ledger entries linked.</Muted>
              ) : (
                <div className="space-y-1.5">
                  {data.ledgerEntries!.map((l) => (
                    <div key={l.id} className="flex items-center justify-between text-[12px] text-[#C2CAD6] border border-[#222A35] rounded-md px-3 py-2">
                      <span>{l.desc}</span>
                      <span className={l.type === "in" ? "text-[#22C55E]" : "text-[#EF4444]"}>{fmt(Number(l.amountUSD || 0))}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Audit trail */}
            <Section title="Audit trail">
              {approvals.length === 0 ? (
                <Muted>No activity recorded.</Muted>
              ) : (
                <div className="space-y-1.5">
                  {approvals.map((ap) => (
                    <div key={ap.id} className="text-[12px] text-[#C2CAD6] border border-[#222A35] rounded-md px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="capitalize">{ap.action}</span>
                        <span className="text-[10px] text-[#8A95A5]">{new Date(ap.createdAt).toLocaleString()}</span>
                      </div>
                      <div className="text-[11px] text-[#8A95A5] mt-0.5">
                        {ap.actorName || "—"}
                        {ap.comments ? ` · ${ap.comments}` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {canDelete && (
              <div className="pt-2 border-t border-[#222A35]">
                <button
                  onClick={remove}
                  className="h-9 px-3 rounded-md border border-[#EF4444]/40 text-[#EF4444] text-[12px] flex items-center gap-1.5 hover:bg-[#EF4444]/10"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete commitment
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#222A35] bg-[#0A0E14] px-3 py-2">
      <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">{label}</div>
      <div className="text-[12px] text-white mt-0.5">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[12px] text-white font-display mb-2">{title}</div>
      {children}
    </div>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <div className="text-[12px] text-[#5B6675] py-1">{children}</div>;
}
