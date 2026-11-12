// Record money received against a payment request (a stage): amount, method
// and the M-Pesa or bank reference. Earlier payments are listed with their
// references, and the client is told (they see every payment in their view).
// A bottom sheet on a phone, a dialog on a desk.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, Trash2, X } from "lucide-react";
import api, { type InvoiceDto, type PaymentDto } from "../../services/api";

const kes = (n: number) => `KES ${Math.round(Number(n) || 0).toLocaleString("en-KE")}`;
const today = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const METHODS: [string, string][] = [["mpesa", "M-Pesa"], ["bank", "Bank"], ["cash", "Cash"], ["cheque", "Cheque"]];
const field = "w-full h-11 sm:h-10 bg-[#0A0E14] border border-[#222A35] rounded-lg px-3 text-[15px] sm:text-[13px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]/60";

export function PaymentSheet({ projectId, invoice, canEdit, onClose, onChanged }: { projectId: string; invoice: InvoiceDto; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  const [list, setList] = useState<PaymentDto[] | null>(null);
  const balance = Math.max(0, (invoice.amount || 0) - (invoice.paidAmount || 0));
  const [f, setF] = useState({ amount: balance ? String(balance) : "", method: "mpesa", reference: "", date: today(), notify: true });
  const [busy, setBusy] = useState(false);
  const load = () => api.invoicePayments(projectId, invoice.id).then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, [invoice.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);

  const save = async (allowDuplicate = false) => {
    setBusy(true);
    try {
      const r = await api.recordPayment(projectId, invoice.id, { amount: Number(f.amount), method: f.method, reference: f.reference, date: f.date, notify: f.notify, allowDuplicate });
      toast.success(r.invoice.status === "paid" ? `Paid in full · ${f.reference || "cash"}` : `${kes(Number(f.amount))} recorded · balance ${kes((r.invoice.amount || 0) - (r.invoice.paidAmount || 0))}`);
      onChanged(); onClose();
    } catch (e: any) {
      const msg = String(e?.message || "Couldn't record the payment");
      if (/already recorded/i.test(msg) && !allowDuplicate) { if (window.confirm(msg)) return save(true); }
      else toast.error(msg);
    }
    setBusy(false);
  };
  const remove = async (p: PaymentDto) => {
    if (!window.confirm(`Remove the ${kes(p.amount)} payment${p.reference ? ` (${p.reference})` : ""}?`)) return;
    try { await api.deletePayment(projectId, invoice.id, p.id); load(); onChanged(); } catch (e: any) { toast.error(e?.message || "Couldn't remove"); }
  };
  const needsRef = f.method !== "cash";

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div role="dialog" aria-label={`Payments for ${invoice.invoiceNumber}`} onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-[#11161D] border border-[#222A35] rounded-t-2xl sm:rounded-xl max-h-[92vh] overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        <div className="px-5 pt-4 pb-3 border-b border-[#222A35] flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] text-white font-display">Payment received</div>
            <div className="text-[12px] text-[#8A95A5] mt-0.5 truncate">{invoice.invoiceNumber} · {invoice.clientName} · {kes(invoice.amount)} requested</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-9 h-9 -mr-2 rounded-lg text-[#8A95A5] hover:text-white flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>

        {!!list?.length && (
          <div className="px-5 pt-3">
            <div className="text-[11px] uppercase tracking-wider text-[#5B6675] mb-1.5">Received so far</div>
            {list.map((p) => (
              <div key={p.id} className="flex items-center gap-2 py-1.5 text-[13px]">
                <span className="text-white tabular-nums">{kes(p.amount)}</span>
                <span className="text-[#8A95A5] truncate flex-1">{p.methodLabel}{p.reference ? ` · ${p.reference}` : ""} · {p.date}</span>
                {canEdit && <button onClick={() => remove(p)} aria-label="Remove payment" className="text-[#5B6675] hover:text-[#EF4444] p-1"><Trash2 className="w-3.5 h-3.5" /></button>}
              </div>
            ))}
            <div className="text-[12px] text-[#C2CAD6] pt-1 pb-1">Balance: <b className="text-white">{kes(balance)}</b></div>
          </div>
        )}

        {canEdit && balance > 0 ? (
          <div className="p-5 space-y-3">
            <label className="block"><span className="text-[11.5px] text-[#8A95A5]">Amount (KES)</span>
              <input autoFocus inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, "") })} className={`${field} mt-1 tabular-nums`} /></label>
            <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Paid by">
              {METHODS.map(([k, l]) => (
                <button key={k} role="radio" aria-checked={f.method === k} onClick={() => setF({ ...f, method: k })}
                  className={`h-10 rounded-lg text-[13px] border transition-transform active:scale-[0.97] ${f.method === k ? "border-[#FF6B1A] bg-[#FF6B1A]/10 text-white" : "border-[#222A35] text-[#C2CAD6]"}`}>{l}</button>
              ))}
            </div>
            {needsRef && (
              <label className="block"><span className="text-[11.5px] text-[#8A95A5]">{f.method === "mpesa" ? "M-Pesa code" : "Reference"}</span>
                <input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value.toUpperCase() })} placeholder={f.method === "mpesa" ? "e.g. QK12AB34CD" : "Slip or cheque number"} autoCapitalize="characters" spellCheck={false}
                  className={`${field} mt-1 font-mono tracking-wide`} /></label>
            )}
            <label className="block"><span className="text-[11.5px] text-[#8A95A5]">Date received</span>
              <input type="date" max={today()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className={`${field} mt-1`} /></label>
            <label className="flex items-center gap-2 text-[12.5px] text-[#C2CAD6]"><input type="checkbox" checked={f.notify} onChange={(e) => setF({ ...f, notify: e.target.checked })} className="accent-[#FF6B1A] w-4 h-4" /> Tell the client (email; they also see it in their view)</label>
            <button onClick={() => save()} disabled={busy || !(Number(f.amount) > 0) || (needsRef && !f.reference.trim())}
              className="w-full h-12 sm:h-11 rounded-xl bg-[#22C55E] text-[#ffffff] text-[15px] sm:text-[14px] font-medium inline-flex items-center justify-center gap-2 transition-transform active:scale-[0.98] disabled:opacity-40">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Record {Number(f.amount) ? kes(Number(f.amount)) : "payment"}
            </button>
          </div>
        ) : (
          <div className="p-5 text-[13px] text-[#8A95A5]">{balance <= 0 ? "This payment request is fully paid." : "Ask a manager to record payments."}</div>
        )}
      </div>
    </div>
  );
}
