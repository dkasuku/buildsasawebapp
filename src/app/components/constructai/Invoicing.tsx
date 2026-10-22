import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Plus, Search, X, Trash2, FileText, Download } from "lucide-react";
import type { Role } from "./roles";
import { PageHeader } from "./PageShell";
import { ROLES } from "./roles";
import api, { type InvoiceDto, type CompanyPublic } from "../../services/api";
import { jsPDF, lastTableEnd } from "../../services/pdf";
import { companyLogoData, drawLetterhead } from "../../services/brandPdf";
import { useCurrency } from "./CurrencyContext";
import { formatCurrency } from "./currency";

const STATUS_COLOR: Record<string, string> = {
  draft: "#8A95A5",
  sent: "#3B82F6",
  paid: "#22C55E",
  overdue: "#EF4444",
};

const STATUSES = ["draft", "sent", "paid", "overdue"];
const PAYMENT_TERMS = ["Due on receipt", "Net 7", "Net 14", "Net 30", "Net 60"];

type LineItem = { description: string; quantity: string; rate: string };
const EMPTY_LINE: LineItem = { description: "", quantity: "", rate: "" };
const lineAmount = (li: LineItem) => (Number(li.quantity) || 0) * (Number(li.rate) || 0);

const EMPTY_FORM = {
  invoiceNumber: "",
  clientName: "",
  billToAddress: "",
  shipTo: "",
  poNumber: "",
  paymentTerms: "Net 30",
  status: "draft" as string,
  issueDate: "",
  dueDate: "",
  taxRate: "",
  discount: "",
  shipping: "",
  amountPaid: "",
  notes: "",
  terms: "",
};

export default function Invoicing({ role = "Contractor" }: { role?: Role }) {
  const perms = ROLES[role];
  const [invoices, setInvoices] = useState<InvoiceDto[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [lines, setLines] = useState<LineItem[]>([{ ...EMPTY_LINE }]);
  const { currency } = useCurrency();
  const [company, setCompany] = useState<CompanyPublic | null>(null);
  useEffect(() => { api.getCompany().then(setCompany).catch(() => {}); }, []);

  // Branded invoice PDF. Amounts are always printed in KES, the stored currency.
  const downloadPdf = async (inv: InvoiceDto) => {
    const doc = new jsPDF();
    const W = doc.internal.pageSize.getWidth();
    const kes = (n: number) => `KES ${Math.round(Number(n) || 0).toLocaleString("en-KE")}`;
    const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-GB") : "");
    const meta = [`Invoice no: ${inv.invoiceNumber}`, inv.issueDate ? `Date: ${day(inv.issueDate)}` : "", inv.dueDate ? `Due: ${day(inv.dueDate)}` : "", inv.poNumber ? `PO: ${inv.poNumber}` : ""].filter(Boolean);
    let y = drawLetterhead(doc, company, await companyLogoData(), "INVOICE", meta);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(140); doc.text("BILL TO", 14, y);
    doc.setFontSize(10); doc.setTextColor(20); doc.text(inv.clientName || "", 14, y + 6);
    doc.setFontSize(9); doc.setTextColor(90);
    const addr = doc.splitTextToSize(inv.billToAddress || "", 90);
    if (inv.billToAddress) doc.text(addr, 14, y + 11);
    y += 14 + (inv.billToAddress ? addr.length * 4.5 : 0);
    let items: { description: string; quantity: number; rate: number }[] = [];
    try { items = JSON.parse(inv.items || "[]"); } catch { items = []; }
    (doc as any).autoTable({
      startY: y,
      head: [["Description", "Qty", "Rate", "Amount"]],
      body: items.map((i) => [i.description, String(i.quantity), kes(i.rate), kes((Number(i.quantity) || 0) * (Number(i.rate) || 0))]),
      styles: { fontSize: 9, cellPadding: 2.5 },
      headStyles: { fillColor: [11, 42, 74], textColor: 255 },
      columnStyles: { 1: { cellWidth: 16, halign: "right" }, 2: { cellWidth: 32, halign: "right" }, 3: { cellWidth: 34, halign: "right" } },
    });
    y = lastTableEnd(doc, y + 20) + 8;
    const sub = inv.subtotal ?? items.reduce((t, i) => t + (Number(i.quantity) || 0) * (Number(i.rate) || 0), 0);
    const rows: [string, string][] = [["Subtotal", kes(sub)]];
    if (inv.discount) rows.push(["Discount", `- ${kes(inv.discount)}`]);
    if (inv.taxRate) rows.push([`VAT (${inv.taxRate}%)`, kes((sub - (inv.discount || 0)) * inv.taxRate / 100)]);
    if (inv.shipping) rows.push(["Shipping", kes(inv.shipping)]);
    doc.setFontSize(9); doc.setTextColor(60);
    rows.forEach(([k, v]) => { doc.text(k, W - 70, y); doc.text(v, W - 14, y, { align: "right" }); y += 6; });
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(20);
    doc.text("Total", W - 70, y + 1); doc.text(kes(inv.amount), W - 14, y + 1, { align: "right" });
    y += 8;
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    if (inv.paidAmount) { doc.setTextColor(60); doc.text("Paid", W - 70, y); doc.text(kes(inv.paidAmount), W - 14, y, { align: "right" }); y += 6; }
    doc.setFont("helvetica", "bold"); doc.setTextColor(255, 107, 26);
    doc.text("Balance due", W - 70, y); doc.text(kes((inv.amount || 0) - (inv.paidAmount || 0)), W - 14, y, { align: "right" });
    y += 10;
    const block = (heading: string, text?: string | null) => {
      if (!text) return;
      const wrapped = doc.splitTextToSize(text, W - 28);
      if (y + 10 + wrapped.length * 4.5 > doc.internal.pageSize.getHeight() - 15) { doc.addPage(); y = 20; }
      doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(20); doc.text(heading, 14, y + 4);
      doc.setFont("helvetica", "normal"); doc.setTextColor(80); doc.text(wrapped, 14, y + 10);
      y += 12 + wrapped.length * 4.5;
    };
    block("Payment terms", inv.paymentTerms);
    block("How to pay", company?.paymentDetails);
    block("Notes", inv.notes);
    block("Terms & conditions", inv.terms);
    doc.save(`${inv.invoiceNumber}.pdf`.replace(/[\\/:*?"<>|]/g, "-"));
  };
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

  // Live totals derived from the line items + totals panel inputs.
  const subtotal = lines.reduce((s, li) => s + lineAmount(li), 0);
  const taxRate = Number(form.taxRate) || 0;
  const discount = Number(form.discount) || 0;
  const shipping = Number(form.shipping) || 0;
  const taxAmount = (subtotal - discount) * (taxRate / 100);
  const total = subtotal - discount + taxAmount + shipping;
  const amountPaid = Number(form.amountPaid) || 0;
  const balanceDue = total - amountPaid;

  const resetForm = () => { setForm({ ...EMPTY_FORM }); setLines([{ ...EMPTY_LINE }]); };

  const updateLine = (i: number, patch: Partial<LineItem>) => setLines(lines.map((li, idx) => (idx === i ? { ...li, ...patch } : li)));
  const addLine = () => setLines([...lines, { ...EMPTY_LINE }]);
  const removeLine = (i: number) => setLines(lines.length > 1 ? lines.filter((_, idx) => idx !== i) : [{ ...EMPTY_LINE }]);

  const createInvoice = async () => {
    if (!perms.financials) return toast.error(`${role} cannot create invoices`);
    // Keep only rows that have a positive computed amount.
    const validLines = lines.filter((li) => lineAmount(li) > 0);
    if (!form.invoiceNumber.trim() || !form.clientName.trim() || validLines.length === 0) return toast.error("Invoice number, client, and at least one line item required");
    const itemsJson = JSON.stringify(validLines.map((li) => ({ description: li.description, quantity: Number(li.quantity) || 0, rate: Number(li.rate) || 0 })));
    const payload = {
      invoiceNumber: form.invoiceNumber,
      clientName: form.clientName,
      billToAddress: form.billToAddress || null,
      shipTo: form.shipTo || null,
      poNumber: form.poNumber || null,
      paymentTerms: form.paymentTerms || null,
      status: form.status,
      issueDate: form.issueDate,
      dueDate: form.dueDate,
      items: itemsJson,
      subtotal,
      taxRate: form.taxRate === "" ? null : taxRate,
      discount: form.discount === "" ? null : discount,
      shipping: form.shipping === "" ? null : shipping,
      amount: Math.round(total),
      paidAmount: Math.round(amountPaid) || 0,
      notes: form.notes || null,
      terms: form.terms || null,
    };
    try {
      const row = await api.createInvoice(projectId, payload);
      setInvoices([row, ...invoices]);
      setShowNew(false);
      resetForm();
      toast.success("Invoice created");
    } catch {
      setInvoices([{ ...payload, id: `I-${Date.now()}`, projectId } as InvoiceDto, ...invoices]);
      setShowNew(false);
      resetForm();
      toast.success("Invoice created (offline)");
    }
  };

  const deleteInvoice = async (id: string) => {
    try { await api.deleteInvoice(projectId, id); } catch { /* ignore */ }
    setInvoices(invoices.filter((i) => i.id !== id));
    toast.success("Invoice deleted");
  };

  return (
    <div>
      <PageHeader
        title="Invoicing"
        subtitle="Accounts receivable and invoice management"
        actions={<>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="ws-select">
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#5B6675]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search invoices…" className="w-[180px] sm:w-[220px] h-9 bg-[#11161D] border border-[#222A35] rounded-md pl-8 pr-3 text-[12px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]" />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="ws-select">
            <option value="All">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {perms.financials && (
            <button onClick={() => setShowNew(true)} className="ws-btn-primary">
              <Plus aria-hidden /> New Invoice
            </button>
          )}
        </>}
      />
      <div className="px-4 sm:px-8 py-5 sm:py-6 space-y-5">

      
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
                <th className="text-left px-3 py-2.5">Balance</th>
                <th className="text-right px-4 py-2.5">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => (
                <tr key={inv.id} className="border-t border-[#222A35] hover:bg-[#161C24]">
                  <td className="px-4 py-2.5 text-white font-mono text-[11px]">{inv.invoiceNumber}</td>
                  <td className="px-3 py-2.5 text-white">{inv.clientName}</td>
                  <td className="px-3 py-2.5 text-white">{formatCurrency(Math.round(inv.amount), currency)}</td>
                  <td className="px-3 py-2.5">
                    <span className="px-2 py-0.5 rounded-full text-[10px]" style={{ background: `${STATUS_COLOR[inv.status] || "#5B6675"}20`, color: STATUS_COLOR[inv.status] || "#5B6675" }}>{inv.status}</span>
                  </td>
                  <td className="px-3 py-2.5 text-[#8A95A5]">{inv.dueDate}</td>
                  <td className="px-3 py-2.5 text-[#8A95A5]">{inv.paidAmount ? `${formatCurrency(Math.round(inv.paidAmount), currency)}${inv.paidDate ? ` · ${inv.paidDate}` : ""}` : "—"}</td>
                  <td className="px-3 py-2.5 text-[#8A95A5]">{formatCurrency(Math.round((inv.amount || 0) - (inv.paidAmount || 0)), currency)}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button onClick={() => downloadPdf(inv)} className="text-[11px] text-[#8A95A5] hover:text-white mr-3 inline-flex items-center gap-1 align-middle"><Download className="w-3.5 h-3.5" />PDF</button>
                    {perms.financials && <button onClick={() => openPay(inv)} className="text-[11px] text-[#22C55E] hover:underline mr-3">Record payment</button>}
                    <button onClick={() => deleteInvoice(inv.id)} className="text-[#8A95A5] hover:text-red-400 align-middle"><Trash2 className="w-3.5 h-3.5 inline" /></button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="text-center py-8 text-[11px] text-[#5B6675]">No invoices found</td></tr>
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
              <span className="text-[14px] text-white font-display">{formatCurrency(Math.round(inv.amount), currency)}</span>
              {inv.dueDate && <span className="text-[11px] text-[#8A95A5]">Due {inv.dueDate}</span>}
            </div>
            <div className="text-[11px] text-[#8A95A5] mt-1">Paid: {inv.paidAmount ? `${formatCurrency(Math.round(inv.paidAmount), currency)}${inv.paidDate ? ` · ${inv.paidDate}` : ""}` : "—"}</div>
            <div className="text-[11px] text-[#8A95A5] mt-0.5">Balance: {formatCurrency(Math.round((inv.amount || 0) - (inv.paidAmount || 0)), currency)}</div>
            {perms.financials && (
              <div className="flex items-center gap-3 mt-2.5 pt-2.5 border-t border-[#222A35]">
                <button onClick={() => openPay(inv)} className="text-[12px] text-[#22C55E] hover:underline">Record payment</button>
                <button onClick={() => downloadPdf(inv)} className="text-[12px] text-[#8A95A5] hover:text-white flex items-center gap-1"><Download className="w-3.5 h-3.5" /> PDF</button>
                <button onClick={() => deleteInvoice(inv.id)} className="text-[12px] text-[#8A95A5] hover:text-red-400 ml-auto flex items-center gap-1"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {showNew && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-start sm:items-center justify-center p-4 overflow-y-auto" onClick={() => setShowNew(false)}>
          <div className="bg-[#11161D] border border-[#222A35] rounded-xl w-full max-w-3xl my-4 max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#222A35]">
              <div className="text-[14px] text-white font-display">New Invoice</div>
              <button onClick={() => setShowNew(false)} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 py-4 space-y-5 text-[12px] overflow-y-auto">
              {/* Top: invoice # + status */}
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Invoice # <span className="text-[#FF6B1A]">*</span></div><input placeholder="e.g. INV-0042" value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
                <div>
                  <div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Status</div>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white focus:outline-none focus:border-[#FF6B1A]">
                    {STATUSES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              {/* Bill To / Ship To */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <div className="text-[11px] text-white uppercase tracking-wider">Bill To</div>
                  <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Client Name <span className="text-[#FF6B1A]">*</span></div><input placeholder="e.g. Jane Wanjiku" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
                  <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Address</div><textarea placeholder="e.g. P.O. Box 1234-00100&#10;Nairobi" value={form.billToAddress} onChange={(e) => setForm({ ...form, billToAddress: e.target.value })} rows={3} className="w-full bg-[#0A0E14] border border-[#222A35] rounded-md px-3 py-2 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
                </div>
                <div className="space-y-2">
                  <div className="text-[11px] text-white uppercase tracking-wider">Ship To <span className="text-[10px] text-[#5B6675] normal-case">(optional)</span></div>
                  <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Ship-to details</div><textarea placeholder="e.g. Site: Plot 45, Kitengela" value={form.shipTo} onChange={(e) => setForm({ ...form, shipTo: e.target.value })} rows={4} className="w-full bg-[#0A0E14] border border-[#222A35] rounded-md px-3 py-2 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
                </div>
              </div>

              {/* Meta */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Issue Date</div><input type="date" value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
                <div>
                  <div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Payment Terms</div>
                  <select value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white focus:outline-none focus:border-[#FF6B1A]">
                    {PAYMENT_TERMS.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Due Date</div><input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
                <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">PO Number</div><input placeholder="e.g. PO-2026-018" value={form.poNumber} onChange={(e) => setForm({ ...form, poNumber: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
              </div>

              {/* Line items */}
              <div className="space-y-2">
                <div className="text-[11px] text-white uppercase tracking-wider">Line Items</div>
                <div className="rounded-md border border-[#222A35] overflow-hidden">
                  <div className="grid grid-cols-[1fr_70px_100px_110px_32px] gap-2 px-3 py-2 bg-[#0A0E14] text-[10px] text-[#8A95A5] uppercase tracking-wider">
                    <div>Description</div><div className="text-right">Qty</div><div className="text-right">Rate</div><div className="text-right">Amount</div><div></div>
                  </div>
                  {lines.map((li, i) => (
                    <div key={i} className="grid grid-cols-[1fr_70px_100px_110px_32px] gap-2 px-3 py-2 items-center border-t border-[#222A35]">
                      <input value={li.description} onChange={(e) => updateLine(i, { description: e.target.value })} placeholder="Item or service" className="h-8 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white focus:outline-none focus:border-[#FF6B1A]" />
                      <input placeholder="1" type="number" value={li.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} className="h-8 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white text-right focus:outline-none focus:border-[#FF6B1A]" />
                      <input placeholder="e.g. 50000" type="number" value={li.rate} onChange={(e) => updateLine(i, { rate: e.target.value })} className="h-8 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white text-right focus:outline-none focus:border-[#FF6B1A]" />
                      <div className="text-right text-white">{formatCurrency(Math.round(lineAmount(li)), currency)}</div>
                      <button onClick={() => removeLine(i)} className="text-[#8A95A5] hover:text-red-400 flex justify-center"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                </div>
                <button onClick={addLine} className="text-[11px] text-[#FF6B1A] hover:text-[#FF7E33] flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Line item</button>
              </div>

              {/* Totals panel */}
              <div className="flex justify-end">
                <div className="w-full sm:w-[320px] space-y-2">
                  <div className="flex items-center justify-between"><span className="text-[#8A95A5]">Subtotal</span><span className="text-white">{formatCurrency(Math.round(subtotal), currency)}</span></div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#8A95A5]">Tax %</span>
                    <div className="flex items-center gap-2">
                      <input placeholder="16" type="number" value={form.taxRate} onChange={(e) => setForm({ ...form, taxRate: e.target.value })} className="w-[70px] h-8 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white text-right focus:outline-none focus:border-[#FF6B1A]" />
                      <span className="text-white w-[110px] text-right">{formatCurrency(Math.round(taxAmount), currency)}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#8A95A5]">Discount</span>
                    <input placeholder="0" type="number" value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} className="w-[120px] h-8 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white text-right focus:outline-none focus:border-[#FF6B1A]" />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#8A95A5]">Shipping</span>
                    <input placeholder="0" type="number" value={form.shipping} onChange={(e) => setForm({ ...form, shipping: e.target.value })} className="w-[120px] h-8 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white text-right focus:outline-none focus:border-[#FF6B1A]" />
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-[#222A35]"><span className="text-white">Total</span><span className="text-white font-display text-[14px]">{formatCurrency(Math.round(total), currency)}</span></div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#8A95A5]">Amount Paid</span>
                    <input placeholder="0" type="number" value={form.amountPaid} onChange={(e) => setForm({ ...form, amountPaid: e.target.value })} className="w-[120px] h-8 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white text-right focus:outline-none focus:border-[#FF6B1A]" />
                  </div>
                  <div className="flex items-center justify-between"><span className="text-[#8A95A5]">Balance Due</span><span className="text-[#22C55E]">{formatCurrency(Math.round(balanceDue), currency)}</span></div>
                </div>
              </div>

              {/* Notes + Terms */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Notes</div><textarea placeholder="e.g. Thank you for your business." value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} className="w-full bg-[#0A0E14] border border-[#222A35] rounded-md px-3 py-2 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
                <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Terms &amp; Conditions</div><textarea placeholder="e.g. Payment due within 14 days by M-Pesa or bank transfer." value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} rows={3} className="w-full bg-[#0A0E14] border border-[#222A35] rounded-md px-3 py-2 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[#222A35]">
              <button onClick={() => setShowNew(false)} className="h-9 px-3 rounded-md border border-[#222A35] text-[12px] text-[#8A95A5] hover:text-white">Cancel</button>
              <button onClick={createInvoice} className="h-9 px-4 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[12px] flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" />Create Invoice</button>
            </div>
          </div>
        </div>
      )}

      {payFor && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setPayFor(null)}>
          <div className="w-full max-w-sm rounded-xl border border-[#222A35] bg-[#11161D]" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[#222A35] flex items-center justify-between"><div className="text-[14px] text-white font-display">Record payment</div><button onClick={() => setPayFor(null)} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button></div>
            <div className="p-5 space-y-3">
              <div className="text-[12px] text-[#8A95A5]">{payFor.invoiceNumber} · {payFor.clientName} · invoiced {formatCurrency(Math.round(Number(payFor.amount) || 0), currency)}</div>
              <div><div className="text-[10px] uppercase tracking-wider text-[#8A95A5] mb-1">Amount received</div><input placeholder="e.g. 100000" type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
              <div><div className="text-[10px] uppercase tracking-wider text-[#8A95A5] mb-1">Date received</div><input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
              <div className="text-[10px] text-[#5B6675]">Paying the full amount marks the invoice Paid; a smaller amount keeps it open (partial payment).</div>
            </div>
            <div className="px-5 py-4 border-t border-[#222A35] flex gap-2"><button onClick={() => setPayFor(null)} className="flex-1 h-10 rounded-md border border-[#222A35] text-[12px] text-white">Cancel</button><button onClick={savePayment} className="flex-1 h-10 rounded-md bg-[#22C55E] text-white text-[12px]">Save payment</button></div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}
