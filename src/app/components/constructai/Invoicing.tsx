import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Plus, Search, X, Trash2, DollarSign, FileText } from "lucide-react";
import type { Role } from "./roles";
import { ROLES } from "./roles";
import api, { type InvoiceDto } from "../../services/api";

const STATUS_COLOR: Record<string, string> = {
  draft: "#8A95A5",
  sent: "#3B82F6",
  paid: "#22C55E",
  overdue: "#EF4444",
};

const STATUSES = ["draft", "sent", "paid", "overdue"];

export default function Invoicing({ role = "Contractor" }: { role?: Role }) {
  const perms = ROLES[role];
  const [invoices, setInvoices] = useState<InvoiceDto[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ invoiceNumber: "", clientName: "", amount: "", status: "draft" as string, issueDate: "", dueDate: "", notes: "" });
  const [payFor, setPayFor] = useState<InvoiceDto | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState("");
  const openPay = (inv: InvoiceDto) => { setPayFor(inv); setPayAmount(String(inv.paidAmount || inv.amount || "")); setPayDate(inv.paidDate || new Date().toISOString().slice(0, 10)); };
  const savePayment = async () => {
    if (!payFor) return;
    const amt = Number(payAmount) || 0;
    const status = amt >= (payFor.amount || 0) ? "paid" : payFor.status;
    try {
      await api.updateInvoice(projectId, payFor.id, { paidAmount: amt, paidDate: payDate, status });
      toast.success("Payment recorded");
      setPayFor(null);
      api.getInvoices(projectId).then(setInvoices).catch(() => {});
    } catch (e: any) { toast.error(e.message || "Could not record payment"); }
  };

  useEffect(() => {
    api.getProjects().then((ps) => {
      const list = ps.map((p) => ({ id: p.id || p.code, name: p.name }));
      setProjects(list);
      if (list.length) {
        setProjectId(list[0].id);
        api.getInvoices(list[0].id).then(setInvoices).catch(() => {});
      }
    });
  }, []);

  useEffect(() => {
    if (!projectId) return;
    api.getInvoices(projectId).then(setInvoices).catch(() => {});
  }, [projectId]);

  const filtered = invoices.filter((inv) => {
    if (statusFilter !== "All" && inv.status !== statusFilter) return false;
    if (q && !(`${inv.invoiceNumber} ${inv.clientName} ${inv.notes}`.toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  });

  const createInvoice = async () => {
    if (!perms.financials) return toast.error(`${role} cannot create invoices`);
    if (!form.invoiceNumber.trim() || !form.clientName.trim() || !form.amount) return toast.error("Invoice number, client, and amount required");
    const payload = { ...form, amount: Number(form.amount) };
    try {
      const row = await api.createInvoice(projectId, payload);
      setInvoices([row, ...invoices]);
      setShowNew(false);
      setForm({ invoiceNumber: "", clientName: "", amount: "", status: "draft", issueDate: "", dueDate: "", notes: "" });
      toast.success("Invoice created");
    } catch {
      setInvoices([{ ...payload, id: `I-${Date.now()}`, projectId } as InvoiceDto, ...invoices]);
      setShowNew(false);
      toast.success("Invoice created (offline)");
    }
  };

  const deleteInvoice = async (id: string) => {
    try { await api.deleteInvoice(projectId, id); } catch { /* ignore */ }
    setInvoices(invoices.filter((i) => i.id !== id));
    toast.success("Invoice deleted");
  };

  return (
    <div className="px-4 sm:px-7 py-5 sm:py-6 space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[13px] text-white font-display"><FileText className="w-4 h-4 text-[#FF6B1A]" /> Invoicing</div>
          <div className="text-[11px] text-[#8A95A5] mt-0.5">Accounts receivable and invoice management</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="h-9 bg-[#11161D] border border-[#222A35] rounded-md px-2 text-white text-[12px]">
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#5B6675]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search invoices…" className="w-[180px] sm:w-[220px] h-9 bg-[#11161D] border border-[#222A35] rounded-md pl-8 pr-3 text-[12px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]" />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 bg-[#11161D] border border-[#222A35] rounded-md px-2 text-white text-[12px]">
            <option value="All">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {perms.financials && (
            <button onClick={() => setShowNew(true)} className="h-9 px-3 rounded-md text-[12px] flex items-center gap-1.5 bg-[#FF6B1A] hover:bg-[#FF7E33] text-white">
              <Plus className="w-3.5 h-3.5" /> New Invoice
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {STATUSES.map((s) => (
          <div key={s} className="rounded-xl border border-[#222A35] bg-[#11161D] p-3">
            <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">{s}</div>
            <div className="text-[18px] text-white font-display mt-1">{invoices.filter((i) => i.status === s).length}</div>
          </div>
        ))}
        <div className="rounded-xl border border-[#22C55E]/40 bg-[#22C55E]/5 p-3">
          <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">Received</div>
          <div className="text-[16px] text-[#22C55E] font-display mt-1">${invoices.reduce((sum, i) => sum + (i.paidAmount || 0), 0).toLocaleString()}</div>
        </div>
      </div>

      <div className="hidden sm:block rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[750px] text-[12px]">
            <thead>
              <tr className="text-[10px] text-[#5B6675] uppercase tracking-wider">
                <th className="text-left px-4 py-2.5">Invoice #</th>
                <th className="text-left px-3 py-2.5">Client</th>
                <th className="text-left px-3 py-2.5">Amount</th>
                <th className="text-left px-3 py-2.5">Status</th>
                <th className="text-left px-3 py-2.5">Due</th>
                <th className="text-left px-3 py-2.5">Paid</th>
                <th className="text-right px-4 py-2.5">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => (
                <tr key={inv.id} className="border-t border-[#222A35] hover:bg-[#161C24]">
                  <td className="px-4 py-2.5 text-white font-mono text-[11px]">{inv.invoiceNumber}</td>
                  <td className="px-3 py-2.5 text-white">{inv.clientName}</td>
                  <td className="px-3 py-2.5 text-white flex items-center gap-1"><DollarSign className="w-3 h-3 text-[#5B6675]" />{inv.amount.toLocaleString()}</td>
                  <td className="px-3 py-2.5">
                    <span className="px-2 py-0.5 rounded-full text-[10px]" style={{ background: `${STATUS_COLOR[inv.status] || "#5B6675"}20`, color: STATUS_COLOR[inv.status] || "#5B6675" }}>{inv.status}</span>
                  </td>
                  <td className="px-3 py-2.5 text-[#8A95A5]">{inv.dueDate}</td>
                  <td className="px-3 py-2.5 text-[#8A95A5]">{inv.paidAmount ? `$${inv.paidAmount.toLocaleString()}${inv.paidDate ? ` · ${inv.paidDate}` : ""}` : "—"}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {perms.financials && <button onClick={() => openPay(inv)} className="text-[11px] text-[#22C55E] hover:underline mr-3">Record payment</button>}
                    <button onClick={() => deleteInvoice(inv.id)} className="text-[#8A95A5] hover:text-red-400 align-middle"><Trash2 className="w-3.5 h-3.5 inline" /></button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="text-center py-8 text-[11px] text-[#5B6675]">No invoices found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* cards — phones */}
      <div className="sm:hidden space-y-2">
        {filtered.length === 0 && <div className="text-center py-8 text-[11px] text-[#5B6675] rounded-xl border border-[#222A35] bg-[#11161D]">No invoices found</div>}
        {filtered.map((inv) => (
          <div key={inv.id} className="rounded-xl border border-[#222A35] bg-[#11161D] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[11px] text-[#8A95A5] truncate">{inv.invoiceNumber}</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] shrink-0" style={{ background: `${STATUS_COLOR[inv.status] || "#5B6675"}20`, color: STATUS_COLOR[inv.status] || "#5B6675" }}>{inv.status}</span>
            </div>
            <div className="text-[13px] text-white mt-1">{inv.clientName}</div>
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-[14px] text-white font-display flex items-center gap-1"><DollarSign className="w-3.5 h-3.5 text-[#5B6675]" />{inv.amount.toLocaleString()}</span>
              {inv.dueDate && <span className="text-[11px] text-[#8A95A5]">Due {inv.dueDate}</span>}
            </div>
            <div className="text-[11px] text-[#8A95A5] mt-1">Paid: {inv.paidAmount ? `$${inv.paidAmount.toLocaleString()}${inv.paidDate ? ` · ${inv.paidDate}` : ""}` : "—"}</div>
            {perms.financials && (
              <div className="flex items-center gap-3 mt-2.5 pt-2.5 border-t border-[#222A35]">
                <button onClick={() => openPay(inv)} className="text-[12px] text-[#22C55E] hover:underline">Record payment</button>
                <button onClick={() => deleteInvoice(inv.id)} className="text-[12px] text-[#8A95A5] hover:text-red-400 ml-auto flex items-center gap-1"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {showNew && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setShowNew(false)}>
          <div className="bg-[#11161D] border border-[#222A35] rounded-xl w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="text-[14px] text-white font-display">New Invoice</div>
              <button onClick={() => setShowNew(false)} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3 text-[12px]">
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Invoice #</div><input value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
                <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Amount</div><input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
              </div>
              <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Client Name</div><input value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Status</div>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white">
                    {STATUSES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Issue Date</div><input type="date" value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
                <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Due Date</div><input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
              </div>
              <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Notes</div><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full bg-[#0A0E14] border border-[#222A35] rounded-md px-3 py-2 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-[#222A35]">
              <button onClick={() => setShowNew(false)} className="h-9 px-3 rounded-md border border-[#222A35] text-[12px] text-[#8A95A5] hover:text-white">Cancel</button>
              <button onClick={createInvoice} className="h-9 px-4 rounded-md bg-[#FF6B1A] text-white text-[12px] flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" />Create Invoice</button>
            </div>
          </div>
        </div>
      )}

      {payFor && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setPayFor(null)}>
          <div className="w-full max-w-sm rounded-xl border border-[#222A35] bg-[#11161D]" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[#222A35] flex items-center justify-between"><div className="text-[14px] text-white font-display">Record payment</div><button onClick={() => setPayFor(null)} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button></div>
            <div className="p-5 space-y-3">
              <div className="text-[12px] text-[#8A95A5]">{payFor.invoiceNumber} · {payFor.clientName} · invoiced ${Number(payFor.amount).toLocaleString()}</div>
              <div><div className="text-[10px] uppercase tracking-wider text-[#8A95A5] mb-1">Amount received</div><input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
              <div><div className="text-[10px] uppercase tracking-wider text-[#8A95A5] mb-1">Date received</div><input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
              <div className="text-[10px] text-[#5B6675]">Paying the full amount marks the invoice Paid; a smaller amount keeps it open (partial payment).</div>
            </div>
            <div className="px-5 py-4 border-t border-[#222A35] flex gap-2"><button onClick={() => setPayFor(null)} className="flex-1 h-10 rounded-md border border-[#222A35] text-[12px] text-white">Cancel</button><button onClick={savePayment} className="flex-1 h-10 rounded-md bg-[#22C55E] text-white text-[12px]">Save payment</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
