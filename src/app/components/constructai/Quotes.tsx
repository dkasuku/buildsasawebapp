// ============================================================================
// Quotes — priced offers to a client before a project exists.
//
// Remodelers, interior designers and specialist trades quote many small jobs
// and win some, so a quote is not tied to a project. It is shared by a link the
// client opens on their phone to accept or decline (PublicQuoteView), and an
// accepted quote converts into a project — its lines become the BOQ — plus a
// deposit invoice, so nothing is typed in twice.
// ============================================================================

import { MapPicker } from "./MapPicker";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Plus, Search, X, Trash2, FileSignature, Share2, Download, Copy, Pencil, CheckCircle2, XCircle, FolderPlus, MessageCircle, Mail,
} from "lucide-react";
import type { Role } from "./roles";
import { ROLES } from "./roles";
import api, { absoluteFileUrl, type QuoteDto, type QuoteLine, type QuoteStatus, type QuoteInput, type CompanyPublic } from "../../services/api";
import { companyLogoData, drawLetterhead } from "../../services/brandPdf";
import { useCurrency } from "./CurrencyContext";
import { formatCurrency } from "./currency";
import { jsPDF, lastTableEnd } from "../../services/pdf";

export const QUOTE_STATUS_COLOR: Record<QuoteStatus, string> = {
  draft: "#8A95A5",
  sent: "#3B82F6",
  accepted: "#22C55E",
  declined: "#EF4444",
  expired: "#F59E0B",
};
const STATUS_LABEL: Record<QuoteStatus, string> = { draft: "Draft", sent: "Sent", accepted: "Accepted", declined: "Declined", expired: "Expired" };
const UNITS = ["item", "sum", "m", "m2", "m3", "no", "kg", "day", "hr", "lot"];

/** Same arithmetic as the server's priceQuote, for the live editor totals. */
export function quoteTotals(items: { quantity: number | string; rate: number | string }[], discount?: number | string | null, taxRate?: number | string | null) {
  const subtotal = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.rate) || 0), 0);
  const disc = Math.max(0, Number(discount) || 0);
  const taxPct = Math.max(0, Number(taxRate) || 0);
  const tax = (subtotal - disc) * (taxPct / 100);
  return { subtotal, discount: disc, tax, total: Math.max(0, subtotal - disc + tax) };
}

// Starting line sets for common jobs. Rates are left blank on purpose: prices
// differ by company and market, and a made-up figure would end up on a quote.
const TEMPLATES: Record<string, QuoteLine[]> = {
  "Kitchen remodel": [
    { section: "Demolition", description: "Strip out existing cabinets, worktops and fittings; cart away debris", unit: "sum", quantity: 1, rate: 0 },
    { section: "Cabinetry", description: "Supply and install base cabinets", unit: "m", quantity: 0, rate: 0 },
    { section: "Cabinetry", description: "Supply and install wall cabinets", unit: "m", quantity: 0, rate: 0 },
    { section: "Worktops", description: "Supply and install worktop (granite/quartz), including cut-outs", unit: "m", quantity: 0, rate: 0 },
    { section: "Finishes", description: "Wall tiling / backsplash", unit: "m2", quantity: 0, rate: 0 },
    { section: "Services", description: "Plumbing: sink, mixer and connections", unit: "sum", quantity: 1, rate: 0 },
    { section: "Services", description: "Electrical: sockets, lighting and appliance points", unit: "sum", quantity: 1, rate: 0 },
  ],
  "Bathroom remodel": [
    { section: "Demolition", description: "Remove existing sanitary ware and tiles; cart away debris", unit: "sum", quantity: 1, rate: 0 },
    { section: "Waterproofing", description: "Apply waterproofing membrane to floor and shower walls", unit: "m2", quantity: 0, rate: 0 },
    { section: "Tiling", description: "Floor tiling", unit: "m2", quantity: 0, rate: 0 },
    { section: "Tiling", description: "Wall tiling", unit: "m2", quantity: 0, rate: 0 },
    { section: "Sanitary ware", description: "Supply and fix WC, basin and vanity", unit: "no", quantity: 1, rate: 0 },
    { section: "Sanitary ware", description: "Supply and fix shower mixer, screen and accessories", unit: "sum", quantity: 1, rate: 0 },
    { section: "Services", description: "Plumbing first and second fix", unit: "sum", quantity: 1, rate: 0 },
  ],
  "Tiling works": [
    { section: "Preparation", description: "Screed / level the substrate", unit: "m2", quantity: 0, rate: 0 },
    { section: "Tiling", description: "Supply tiles (client-approved selection)", unit: "m2", quantity: 0, rate: 0 },
    { section: "Tiling", description: "Lay tiles including adhesive and grout", unit: "m2", quantity: 0, rate: 0 },
    { section: "Tiling", description: "Skirting tiles", unit: "m", quantity: 0, rate: 0 },
  ],
  "Painting & decor": [
    { section: "Preparation", description: "Surface preparation: fill cracks, sand and prime", unit: "m2", quantity: 0, rate: 0 },
    { section: "Painting", description: "Internal walls: two coats emulsion", unit: "m2", quantity: 0, rate: 0 },
    { section: "Painting", description: "Ceilings: two coats emulsion", unit: "m2", quantity: 0, rate: 0 },
    { section: "Painting", description: "Doors and frames: gloss / varnish", unit: "no", quantity: 0, rate: 0 },
  ],
  "Electrical works": [
    { section: "First fix", description: "Conduits, boxes and wiring", unit: "sum", quantity: 1, rate: 0 },
    { section: "Second fix", description: "Supply and fix sockets", unit: "no", quantity: 0, rate: 0 },
    { section: "Second fix", description: "Supply and fix light fittings", unit: "no", quantity: 0, rate: 0 },
    { section: "Distribution", description: "Consumer unit / distribution board", unit: "no", quantity: 1, rate: 0 },
    { section: "Testing", description: "Testing, certification and handover", unit: "sum", quantity: 1, rate: 0 },
  ],
};

const DEFAULT_TERMS = "Prices are in KES. This quote is valid until the date shown. Work starts on receipt of the deposit. Any change to the scope will be quoted separately before it is carried out.";

type Line = { section: string; description: string; unit: string; quantity: string; rate: string };
const EMPTY_LINE: Line = { section: "", description: "", unit: "item", quantity: "1", rate: "" };
const toLine = (l: QuoteLine): Line => ({ section: l.section || "", description: l.description, unit: l.unit || "item", quantity: String(l.quantity ?? ""), rate: l.rate ? String(l.rate) : "" });
const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const EMPTY_FORM = {
  title: "", clientName: "", clientPhone: "", clientEmail: "", clientAddress: "",
  validUntil: "", discount: "", taxRate: "", depositPercent: "50", notes: "", terms: DEFAULT_TERMS,
};

const shareUrl = (q: QuoteDto) => `${window.location.origin}/?quote=${q.publicToken}`;
// wa.me wants digits with the country code; Kenyan numbers are usually typed 07…/01….
const waNumber = (phone?: string | null) => {
  const d = String(phone || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("0")) return "254" + d.slice(1);
  return d;
};

const input = "w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white text-[12px] focus:outline-none focus:border-[#FF6B1A]";
const label = "text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1";

export default function Quotes({ role = "Contractor" }: { role?: Role }) {
  const canManage = ROLES[role]?.financials ?? false;
  const { currency } = useCurrency();
  const money = (n: number) => formatCurrency(Math.round(Number(n) || 0), currency);

  const [quotes, setQuotes] = useState<QuoteDto[]>([]);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [company, setCompany] = useState<CompanyPublic | null>(null);
  const [defaultTerms, setDefaultTerms] = useState<string>(DEFAULT_TERMS);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | QuoteStatus>("All");

  const [editing, setEditing] = useState<QuoteDto | "new" | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }]);
  const [saving, setSaving] = useState(false);

  const [sharing, setSharing] = useState<QuoteDto | null>(null);
  const [converting, setConverting] = useState<QuoteDto | null>(null);
  const [city, setCity] = useState("");

  const load = () => api.getQuotes()
    .then((r) => { setQuotes(r.quotes || []); setCompanyName(r.companyName); setCompany(r.company || null); if (r.defaultTerms) setDefaultTerms(r.defaultTerms); })
    .catch((e) => toast.error(e.message || "Could not load quotes"))
    .finally(() => setLoading(false));
  useEffect(() => { load(); }, []);
  // Branding changed in Settings → Company: pick it up without a reload.
  useEffect(() => {
    const refresh = () => api.getQuotes().then((r) => { setCompany(r.company || null); setCompanyName(r.companyName); if (r.defaultTerms) setDefaultTerms(r.defaultTerms); }).catch(() => {});
    window.addEventListener("buildflex:company-updated", refresh);
    return () => window.removeEventListener("buildflex:company-updated", refresh);
  }, []);
  const openBranding = () => window.dispatchEvent(new CustomEvent("buildflex:open-settings", { detail: { tab: "company" } }));

  const replace = (row: QuoteDto) => setQuotes((qs) => qs.map((x) => (x.id === row.id ? row : x)));

  const filtered = quotes.filter((x) => {
    if (statusFilter !== "All" && x.status !== statusFilter) return false;
    if (q && !`${x.quoteNumber} ${x.title} ${x.clientName}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const stats = useMemo(() => {
    const by = (s: QuoteStatus) => quotes.filter((x) => x.status === s);
    const decided = by("accepted").length + by("declined").length;
    return {
      open: by("draft").length + by("sent").length,
      openValue: [...by("draft"), ...by("sent")].reduce((s, x) => s + x.total, 0),
      won: by("accepted").length,
      wonValue: by("accepted").reduce((s, x) => s + x.total, 0),
      winRate: decided ? Math.round((by("accepted").length / decided) * 100) : null,
    };
  }, [quotes]);

  // ---- editor ----
  const openNew = () => {
    setForm({ ...EMPTY_FORM, terms: defaultTerms, validUntil: plusDays(30) });
    setLines([{ ...EMPTY_LINE }]);
    setEditing("new");
  };
  const openEdit = (x: QuoteDto) => {
    setForm({
      title: x.title, clientName: x.clientName, clientPhone: x.clientPhone || "", clientEmail: x.clientEmail || "",
      clientAddress: x.clientAddress || "", validUntil: x.validUntil || "", discount: x.discount ? String(x.discount) : "",
      taxRate: x.taxRate ? String(x.taxRate) : "", depositPercent: x.depositPercent != null ? String(x.depositPercent) : "",
      notes: x.notes || "", terms: x.terms || "",
    });
    setLines(x.items.length ? x.items.map(toLine) : [{ ...EMPTY_LINE }]);
    setEditing(x);
  };
  const duplicate = (x: QuoteDto) => {
    openEdit(x);
    setForm((f) => ({ ...f, validUntil: plusDays(30) }));
    setEditing("new");
  };
  const applyTemplate = (name: string) => {
    const t = TEMPLATES[name];
    if (!t) return;
    const hasContent = lines.some((l) => l.description.trim());
    setLines([...(hasContent ? lines : []), ...t.map(toLine)]);
    if (!form.title.trim()) setForm((f) => ({ ...f, title: name }));
  };
  const updateLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const removeLine = (i: number) => setLines(lines.length > 1 ? lines.filter((_, idx) => idx !== i) : [{ ...EMPTY_LINE }]);

  const totals = quoteTotals(lines, form.discount, form.taxRate);
  const deposit = totals.total * ((Number(form.depositPercent) || 0) / 100);

  const save = async () => {
    const items = lines.filter((l) => l.description.trim()).map((l) => ({
      section: l.section.trim(), description: l.description.trim(), unit: l.unit || "item",
      quantity: Number(l.quantity) || 0, rate: Number(l.rate) || 0,
    }));
    if (!form.title.trim() || !form.clientName.trim()) return toast.error("Add the job title and the client's name");
    if (!items.length) return toast.error("Add at least one line item");
    if (items.some((i) => !i.rate)) {
      if (!window.confirm("Some lines have no rate, so they will show as KES 0 on the quote. Save anyway?")) return;
    }
    const payload: QuoteInput = {
      title: form.title, clientName: form.clientName, clientPhone: form.clientPhone || null, clientEmail: form.clientEmail || null,
      clientAddress: form.clientAddress || null, items, validUntil: form.validUntil || null,
      discount: form.discount === "" ? null : Number(form.discount), taxRate: form.taxRate === "" ? null : Number(form.taxRate),
      depositPercent: form.depositPercent === "" ? null : Number(form.depositPercent), notes: form.notes || null, terms: form.terms || null,
    };
    setSaving(true);
    try {
      if (editing === "new") {
        const row = await api.createQuote(payload);
        setQuotes((qs) => [row, ...qs]);
        toast.success(`Quote ${row.quoteNumber} saved`);
      } else if (editing) {
        const row = await api.updateQuote(editing.id, payload);
        replace(row);
        toast.success(editing.status === "sent" ? "Quote updated. The client's link shows the new version." : "Quote updated");
      }
      setEditing(null);
    } catch (e: any) {
      toast.error(e.message || "Could not save the quote");
    } finally {
      setSaving(false);
    }
  };

  // ---- actions ----
  const openShare = async (x: QuoteDto) => {
    try {
      const row = x.publicToken && x.status !== "draft" ? x : await api.shareQuote(x.id);
      replace(row);
      setSharing(row);
    } catch (e: any) { toast.error(e.message || "Could not create the link"); }
  };
  const copyLink = async (x: QuoteDto) => {
    try { await navigator.clipboard.writeText(shareUrl(x)); toast.success("Link copied"); }
    catch { toast.error("Could not copy. Select the link and copy it manually."); }
  };
  const shareMessage = (x: QuoteDto) =>
    `Hello ${x.clientName}, here is your quote ${x.quoteNumber} for ${x.title} (${money(x.total)})${companyName ? ` from ${companyName}` : ""}. You can view and accept it here: ${shareUrl(x)}`;

  const setStatus = async (x: QuoteDto, status: "accepted" | "declined") => {
    const verb = status === "accepted" ? "accepted" : "declined";
    if (!window.confirm(`Mark ${x.quoteNumber} as ${verb} by the client?`)) return;
    try { replace(await api.setQuoteStatus(x.id, status)); toast.success(`Marked ${verb}`); }
    catch (e: any) { toast.error(e.message || "Could not update"); }
  };

  const convert = async () => {
    if (!converting) return;
    try {
      const r = await api.convertQuote(converting.id, { city: city.trim() || undefined });
      replace(r.quote);
      setConverting(null);
      toast.success(
        r.invoice
          ? `Project "${r.project.name}" created with its BOQ, and a draft deposit invoice of ${money(r.invoice.amount)} is ready in Invoicing.`
          : `Project "${r.project.name}" created with its BOQ. Find it in Projects.`,
        { duration: 7000 },
      );
    } catch (e: any) { toast.error(e.message || "Could not create the project"); }
  };

  const remove = async (x: QuoteDto) => {
    if (!window.confirm(`Delete quote ${x.quoteNumber}? The client's link will stop working.`)) return;
    try { await api.deleteQuote(x.id); setQuotes((qs) => qs.filter((y) => y.id !== x.id)); toast.success("Quote deleted"); }
    catch (e: any) { toast.error(e.message || "Could not delete"); }
  };

  const downloadPdf = async (x: QuoteDto) => {
    const doc = new jsPDF();
    const W = doc.internal.pageSize.getWidth();
    const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;
    const meta = [
      `Quote no: ${x.quoteNumber}`,
      `Date: ${new Date(x.sentAt || x.createdAt).toLocaleDateString("en-GB")}`,
      x.validUntil ? `Valid until: ${new Date(x.validUntil).toLocaleDateString("en-GB")}` : "",
    ].filter(Boolean);
    let top = drawLetterhead(doc, company || (companyName ? { name: companyName } : null), await companyLogoData(), "QUOTATION", meta);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(140); doc.text("PREPARED FOR", 14, top);
    doc.setFontSize(10); doc.setTextColor(20); doc.text(x.clientName, 14, top + 6);
    doc.setFontSize(9); doc.setTextColor(90);
    const addr = [x.clientAddress, x.clientPhone, x.clientEmail].filter(Boolean).join("\n");
    if (addr) doc.text(doc.splitTextToSize(addr, 90), 14, top + 11);
    top += 11 + (addr ? addr.split("\n").length * 4.5 : 0) + 8;
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(20);
    doc.text(x.title, 14, top);

    const body: any[] = [];
    let lastSection: string | null = null;
    x.items.forEach((i) => {
      if ((i.section || "") !== (lastSection ?? "") && i.section) {
        body.push([{ content: i.section, colSpan: 5, styles: { fontStyle: "bold", fillColor: [245, 246, 248] } }]);
      }
      lastSection = i.section || "";
      body.push([i.description, i.unit, String(i.quantity), kes(i.rate), kes(i.quantity * i.rate)]);
    });
    (doc as any).autoTable({
      startY: top + 5,
      head: [["Description", "Unit", "Qty", "Rate", "Amount"]],
      body,
      styles: { fontSize: 9, cellPadding: 2.5 },
      headStyles: { fillColor: [11, 42, 74], textColor: 255 },
      columnStyles: { 1: { cellWidth: 16 }, 2: { cellWidth: 16, halign: "right" }, 3: { cellWidth: 30, halign: "right" }, 4: { cellWidth: 34, halign: "right" } },
    });
    let y = lastTableEnd(doc, 120) + 8;
    const t = quoteTotals(x.items, x.discount, x.taxRate);
    const rows: [string, string][] = [["Subtotal", kes(t.subtotal)]];
    if (t.discount) rows.push(["Discount", `- ${kes(t.discount)}`]);
    if (x.taxRate) rows.push([`VAT (${x.taxRate}%)`, kes(t.tax)]);
    doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(60);
    rows.forEach(([k, v]) => { doc.text(k, W - 70, y); doc.text(v, W - 14, y, { align: "right" }); y += 6; });
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(20);
    doc.text("Total", W - 70, y + 1); doc.text(kes(x.total), W - 14, y + 1, { align: "right" });
    y += 8;
    if (x.depositPercent) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(255, 107, 26);
      doc.text(`Deposit to start (${x.depositPercent}%)`, W - 70, y); doc.text(kes(x.total * x.depositPercent / 100), W - 14, y, { align: "right" });
      y += 8;
    }
    const block = (heading: string, text?: string | null) => {
      if (!text) return;
      const wrapped = doc.splitTextToSize(text, W - 28);
      if (y + 10 + wrapped.length * 4.5 > doc.internal.pageSize.getHeight() - 15) { doc.addPage(); y = 20; }
      doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(20); doc.text(heading, 14, y + 4);
      doc.setFont("helvetica", "normal"); doc.setTextColor(80); doc.text(wrapped, 14, y + 10);
      y += 12 + wrapped.length * 4.5;
    };
    block("Scope notes", x.notes);
    block("Terms", x.terms);
    block("Payment details", company?.paymentDetails);
    if (x.publicToken) block("Accept online", shareUrl(x));
    doc.save(`${x.quoteNumber} ${x.title}.pdf`.replace(/[\\/:*?"<>|]/g, "-"));
  };

  const StatusPill = ({ s }: { s: QuoteStatus }) => (
    <span className="px-2 py-0.5 rounded-full text-[10px] whitespace-nowrap" style={{ background: `${QUOTE_STATUS_COLOR[s]}20`, color: QUOTE_STATUS_COLOR[s] }}>{STATUS_LABEL[s]}</span>
  );

  const Actions = ({ x }: { x: QuoteDto }) => (
    <div className="flex items-center gap-3 flex-wrap justify-end text-[11px] [&_button]:text-[11px]">
      {canManage && !x.projectId && x.status !== "accepted" && <button onClick={() => openEdit(x)} className="text-[#8A95A5] hover:text-white flex items-center gap-1"><Pencil className="w-3.5 h-3.5" />Edit</button>}
      {canManage && (x.status === "draft" || x.status === "sent" || x.status === "expired") && <button onClick={() => openShare(x)} className="text-[#3B82F6] hover:underline flex items-center gap-1"><Share2 className="w-3.5 h-3.5" />{x.status === "draft" ? "Send" : "Share"}</button>}
      <button onClick={() => downloadPdf(x)} className="text-[#8A95A5] hover:text-white flex items-center gap-1"><Download className="w-3.5 h-3.5" />PDF</button>
      {canManage && (x.status === "sent" || x.status === "expired") && <>
        <button onClick={() => setStatus(x, "accepted")} className="text-[#22C55E] hover:underline flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />Accepted</button>
        <button onClick={() => setStatus(x, "declined")} className="text-[#EF4444] hover:underline flex items-center gap-1"><XCircle className="w-3.5 h-3.5" />Declined</button>
      </>}
      {canManage && x.status === "accepted" && !x.projectId && <button onClick={() => { setCity(""); setConverting(x); }} className="text-[#FF6B1A] hover:underline flex items-center gap-1"><FolderPlus className="w-3.5 h-3.5" />Start project</button>}
      {x.projectId && <span className="text-[#22C55E]">Project created</span>}
      {canManage && <button onClick={() => duplicate(x)} className="text-[#8A95A5] hover:text-white flex items-center gap-1" title="Duplicate"><Copy className="w-3.5 h-3.5" /></button>}
      {canManage && !x.projectId && <button onClick={() => remove(x)} className="text-[#8A95A5] hover:text-red-400" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>}
    </div>
  );

  return (
    <div className="px-4 sm:px-7 py-5 sm:py-6 space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[13px] text-white font-display"><FileSignature className="w-4 h-4 text-[#FF6B1A]" /> Quotes</div>
          <div className="text-[11px] text-[#8A95A5] mt-0.5">Price a job, send it to the client to accept online, then turn it into a project</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#5B6675]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search quotes…" className="w-[180px] sm:w-[220px] h-9 bg-[#11161D] border border-[#222A35] rounded-md pl-8 pr-3 text-[12px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]" />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="h-9 bg-[#11161D] border border-[#222A35] rounded-md px-2 text-white text-[12px]">
            <option value="All">All statuses</option>
            {(Object.keys(STATUS_LABEL) as QuoteStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          {canManage && (
            <button onClick={openNew} className="h-9 px-3 rounded-md text-[12px] flex items-center gap-1.5 bg-[#FF6B1A] hover:bg-[#FF7E33] text-white">
              <Plus className="w-3.5 h-3.5" /> New Quote
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-3">
          <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">Open quotes</div>
          <div className="text-[18px] text-white font-display mt-1">{stats.open}</div>
        </div>
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-3">
          <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">Open value</div>
          <div className="text-[16px] text-white font-display mt-1">{money(stats.openValue)}</div>
        </div>
        <div className="rounded-xl border border-[#22C55E]/40 bg-[#22C55E]/5 p-3">
          <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">Won · {stats.won}</div>
          <div className="text-[16px] text-[#22C55E] font-display mt-1">{money(stats.wonValue)}</div>
        </div>
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-3">
          <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">Win rate</div>
          <div className="text-[18px] text-white font-display mt-1">{stats.winRate == null ? "—" : `${stats.winRate}%`}</div>
        </div>
      </div>

      {!loading && quotes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#222A35] bg-[#11161D] p-8 text-center">
          <FileSignature className="w-8 h-8 text-[#FF6B1A] mx-auto" />
          <div className="text-[14px] text-white font-display mt-3">No quotes yet</div>
          <p className="text-[12px] text-[#8A95A5] mt-1.5 max-w-md mx-auto">Price a job in minutes, starting from a template like a kitchen or bathroom remodel. Send it on WhatsApp, and the client can accept it from their phone.</p>
          {canManage && <button onClick={openNew} className="mt-4 h-9 px-4 rounded-md text-[12px] inline-flex items-center gap-1.5 bg-[#FF6B1A] hover:bg-[#FF7E33] text-white"><Plus className="w-3.5 h-3.5" /> Create your first quote</button>}
        </div>
      ) : (
        <>
          <div className="hidden md:block rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-[12px]">
                <thead>
                  <tr className="text-[10px] text-[#5B6675] uppercase tracking-wider">
                    <th className="text-left px-4 py-2.5">Quote</th>
                    <th className="text-left px-3 py-2.5">Job</th>
                    <th className="text-left px-3 py-2.5">Client</th>
                    <th className="text-right px-3 py-2.5">Total</th>
                    <th className="text-left px-3 py-2.5">Status</th>
                    <th className="text-left px-3 py-2.5">Valid until</th>
                    <th className="text-right px-4 py-2.5">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((x) => (
                    <tr key={x.id} className="border-t border-[#222A35] hover:bg-[#161C24] align-top">
                      <td className="px-4 py-2.5 text-white font-mono text-[11px]">{x.quoteNumber}</td>
                      <td className="px-3 py-2.5 text-white">{x.title}</td>
                      <td className="px-3 py-2.5 text-[#C7CDD6]">{x.clientName}</td>
                      <td className="px-3 py-2.5 text-white text-right">{money(x.total)}</td>
                      <td className="px-3 py-2.5">
                        <StatusPill s={x.status} />
                        {x.status === "sent" && x.viewedAt && <div className="text-[10px] text-[#5B6675] mt-1">Viewed by client</div>}
                        {x.status === "accepted" && x.acceptedBy && <div className="text-[10px] text-[#5B6675] mt-1">by {x.acceptedBy}</div>}
                        {x.status === "declined" && x.declineReason && <div className="text-[10px] text-[#5B6675] mt-1 max-w-[180px]">"{x.declineReason}"</div>}
                      </td>
                      <td className="px-3 py-2.5 text-[#8A95A5]">{x.validUntil || "—"}</td>
                      <td className="px-4 py-2.5"><Actions x={x} /></td>
                    </tr>
                  ))}
                  {filtered.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-[11px] text-[#5B6675]">{loading ? "Loading…" : "No quotes match"}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="md:hidden space-y-2">
            {filtered.length === 0 && <div className="text-center py-8 text-[11px] text-[#5B6675] rounded-xl border border-[#222A35] bg-[#11161D]">{loading ? "Loading…" : "No quotes match"}</div>}
            {filtered.map((x) => (
              <div key={x.id} className="rounded-xl border border-[#222A35] bg-[#11161D] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-[#8A95A5]">{x.quoteNumber}</span>
                  <StatusPill s={x.status} />
                </div>
                <div className="text-[13px] text-white mt-1">{x.title}</div>
                <div className="text-[11px] text-[#8A95A5]">{x.clientName}</div>
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-[14px] text-white font-display">{money(x.total)}</span>
                  {x.validUntil && <span className="text-[11px] text-[#8A95A5]">Valid to {x.validUntil}</span>}
                </div>
                <div className="mt-2.5 pt-2.5 border-t border-[#222A35]"><Actions x={x} /></div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ---- editor ---- */}
      {editing && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-start sm:items-center justify-center p-2 sm:p-4 overflow-y-auto" onClick={() => !saving && setEditing(null)}>
          <div className="bg-[#11161D] border border-[#222A35] rounded-xl w-full max-w-4xl my-4 max-h-[94vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#222A35]">
              <div className="text-[14px] text-white font-display">{editing === "new" ? "New quote" : `Edit ${editing.quoteNumber}`}</div>
              <button onClick={() => setEditing(null)} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-4 sm:px-5 py-4 space-y-5 overflow-y-auto">
              <BrandingStrip company={company} fallbackName={companyName} onEdit={openBranding} canEdit={canManage} />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2"><div className={label}>Job title <span className="text-[#FF6B1A]">*</span></div><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Kitchen remodel, Runda" className={input} /></div>
                <div><div className={label}>Valid until</div><input type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} className={input} /></div>
              </div>

              <div>
                <div className="text-[11px] text-white uppercase tracking-wider mb-2">Client <span className="normal-case tracking-normal text-[#5B6675]">(the person you are quoting)</span></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><div className={label}>Client's name <span className="text-[#FF6B1A]">*</span></div><input value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} placeholder="e.g. Jane Wanjiku" className={input} /></div>
                  <div><div className={label}>Client's phone (WhatsApp)</div><input type="tel" value={form.clientPhone} onChange={(e) => setForm({ ...form, clientPhone: e.target.value })} placeholder="e.g. 0712 345 678" className={input} /><div className="text-[10px] text-[#5B6675] mt-1">We use this to send the quote to the client on WhatsApp.</div></div>
                  <div><div className={label}>Client's email</div><input type="email" value={form.clientEmail} onChange={(e) => setForm({ ...form, clientEmail: e.target.value })} placeholder="e.g. jane@example.com" className={input} /></div>
                  <div className="sm:col-span-2"><div className={label}>Job site / address</div><MapPicker value={form.clientAddress} onChange={(v) => setForm((x) => ({ ...x, clientAddress: v }))} onLatLngChange={() => {}} placeholder="Search the job site, e.g. Runda, Nairobi" /></div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-[11px] text-white uppercase tracking-wider">Line items</div>
                  <select value="" onChange={(e) => applyTemplate(e.target.value)} className="h-8 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white text-[11px]">
                    <option value="">+ Add lines from a template…</option>
                    {Object.keys(TEMPLATES).map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  {lines.map((l, i) => (
                    <div key={i} className="rounded-md border border-[#222A35] bg-[#0A0E14] p-2 grid grid-cols-6 sm:grid-cols-[110px_1fr_70px_64px_100px_100px_28px] gap-2 items-center">
                      <input value={l.section} onChange={(e) => updateLine(i, { section: e.target.value })} placeholder="Section" className="col-span-6 sm:col-span-1 h-8 bg-[#11161D] border border-[#222A35] rounded-md px-2 text-white text-[12px] focus:outline-none focus:border-[#FF6B1A]" />
                      <input value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} placeholder="Description of the work" className="col-span-6 sm:col-span-1 h-8 bg-[#11161D] border border-[#222A35] rounded-md px-2 text-white text-[12px] focus:outline-none focus:border-[#FF6B1A]" />
                      <select value={l.unit} onChange={(e) => updateLine(i, { unit: e.target.value })} className="col-span-2 sm:col-span-1 h-8 bg-[#11161D] border border-[#222A35] rounded-md px-1 text-white text-[12px]">
                        {[...new Set([l.unit, ...UNITS])].map((u) => <option key={u}>{u}</option>)}
                      </select>
                      <input type="number" inputMode="decimal" value={l.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} placeholder="Qty" className="col-span-2 sm:col-span-1 h-8 bg-[#11161D] border border-[#222A35] rounded-md px-2 text-white text-[12px] text-right focus:outline-none focus:border-[#FF6B1A]" />
                      <input type="number" inputMode="decimal" value={l.rate} onChange={(e) => updateLine(i, { rate: e.target.value })} placeholder="Rate" className="col-span-2 sm:col-span-1 h-8 bg-[#11161D] border border-[#222A35] rounded-md px-2 text-white text-[12px] text-right focus:outline-none focus:border-[#FF6B1A]" />
                      <div className="col-span-5 sm:col-span-1 text-right text-white text-[12px]">{money((Number(l.quantity) || 0) * (Number(l.rate) || 0))}</div>
                      <button onClick={() => removeLine(i)} className="col-span-1 text-[#8A95A5] hover:text-red-400 flex justify-center" aria-label="Remove line"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                </div>
                <button onClick={() => setLines([...lines, { ...EMPTY_LINE, section: lines[lines.length - 1]?.section || "" }])} className="text-[11px] text-[#FF6B1A] hover:text-[#FF7E33] flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Line item</button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="space-y-3">
                  <div><div className={label}>Scope notes, inclusions and exclusions</div><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} placeholder="e.g. Client supplies appliances. Price excludes plumbing relocation." className="w-full bg-[#0A0E14] border border-[#222A35] rounded-md px-3 py-2 text-white text-[12px] focus:outline-none focus:border-[#FF6B1A]" /></div>
                  <div><div className={label}>Terms</div><textarea value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} rows={3} className="w-full bg-[#0A0E14] border border-[#222A35] rounded-md px-3 py-2 text-white text-[12px] focus:outline-none focus:border-[#FF6B1A]" /></div>
                </div>
                <div className="space-y-2 text-[12px]">
                  <div className="flex items-center justify-between"><span className="text-[#8A95A5]">Subtotal</span><span className="text-white">{money(totals.subtotal)}</span></div>
                  <div className="flex items-center justify-between gap-2"><span className="text-[#8A95A5]">Discount (KES)</span><input type="number" value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} className="w-[130px] h-8 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white text-right focus:outline-none focus:border-[#FF6B1A]" /></div>
                  <div className="flex items-center justify-between gap-2"><span className="text-[#8A95A5]">VAT %</span><div className="flex items-center gap-2"><input type="number" value={form.taxRate} onChange={(e) => setForm({ ...form, taxRate: e.target.value })} placeholder="16" className="w-[64px] h-8 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white text-right focus:outline-none focus:border-[#FF6B1A]" /><span className="text-white w-[110px] text-right">{money(totals.tax)}</span></div></div>
                  <div className="flex items-center justify-between pt-2 border-t border-[#222A35]"><span className="text-white">Total</span><span className="text-white font-display text-[15px]">{money(totals.total)}</span></div>
                  <div className="flex items-center justify-between gap-2"><span className="text-[#8A95A5]">Deposit to start %</span><div className="flex items-center gap-2"><input type="number" value={form.depositPercent} onChange={(e) => setForm({ ...form, depositPercent: e.target.value })} className="w-[64px] h-8 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white text-right focus:outline-none focus:border-[#FF6B1A]" /><span className="text-[#FF6B1A] w-[110px] text-right">{money(deposit)}</span></div></div>
                  <div className="text-[10px] text-[#5B6675]">When the quote becomes a project, a deposit invoice for this amount is drafted for you.</div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[#222A35]">
              <button onClick={() => setEditing(null)} className="h-9 px-3 rounded-md border border-[#222A35] text-[12px] text-[#8A95A5] hover:text-white">Cancel</button>
              <button onClick={save} disabled={saving} className="h-9 px-4 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] disabled:opacity-60 text-white text-[12px]">{saving ? "Saving…" : "Save quote"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ---- share ---- */}
      {sharing && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setSharing(null)}>
          <div className="w-full max-w-md rounded-xl border border-[#222A35] bg-[#11161D]" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[#222A35] flex items-center justify-between"><div className="text-[14px] text-white font-display">Send {sharing.quoteNumber} to {sharing.clientName}</div><button onClick={() => setSharing(null)} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button></div>
            <div className="p-5 space-y-3">
              <p className="text-[12px] text-[#8A95A5]">The client opens this link on any phone to see the quote and accept or decline it. You'll see their answer here.</p>
              <div className="flex gap-2">
                <input readOnly value={shareUrl(sharing)} onFocus={(e) => e.target.select()} className={input + " font-mono text-[11px]"} />
                <button onClick={() => copyLink(sharing)} className="h-9 px-3 rounded-md border border-[#222A35] text-white text-[12px] flex items-center gap-1"><Copy className="w-3.5 h-3.5" />Copy</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <a href={`https://wa.me/${waNumber(sharing.clientPhone)}?text=${encodeURIComponent(shareMessage(sharing))}`} target="_blank" rel="noopener noreferrer" className="h-10 rounded-md bg-[#25D366] text-white text-[12px] flex items-center justify-center gap-1.5"><MessageCircle className="w-4 h-4" />WhatsApp</a>
                <a href={`mailto:${sharing.clientEmail || ""}?subject=${encodeURIComponent(`Quote ${sharing.quoteNumber}: ${sharing.title}`)}&body=${encodeURIComponent(shareMessage(sharing))}`} className="h-10 rounded-md border border-[#222A35] text-white text-[12px] flex items-center justify-center gap-1.5"><Mail className="w-4 h-4" />Email</a>
              </div>
              <button onClick={() => downloadPdf(sharing)} className="w-full h-9 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white text-[12px] flex items-center justify-center gap-1.5"><Download className="w-3.5 h-3.5" />Download PDF to attach</button>
            </div>
          </div>
        </div>
      )}

      {/* ---- convert ---- */}
      {converting && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setConverting(null)}>
          <div className="w-full max-w-sm rounded-xl border border-[#222A35] bg-[#11161D]" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[#222A35] flex items-center justify-between"><div className="text-[14px] text-white font-display">Start project from {converting.quoteNumber}</div><button onClick={() => setConverting(null)} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button></div>
            <div className="p-5 space-y-3 text-[12px]">
              <ul className="text-[#C7CDD6] space-y-1.5 list-disc pl-4">
                <li>Creates the project <span className="text-white">"{converting.title}"</span> worth {money(converting.total)}</li>
                <li>Copies the {converting.items.length} quote lines into the project's BOQ</li>
                {converting.depositPercent ? <li>Drafts a {converting.depositPercent}% deposit invoice of {money(converting.total * converting.depositPercent / 100)}</li> : null}
              </ul>
              <div><div className={label}>Location / town</div><input value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Runda, Nairobi" className={input} /></div>
            </div>
            <div className="px-5 py-4 border-t border-[#222A35] flex gap-2"><button onClick={() => setConverting(null)} className="flex-1 h-10 rounded-md border border-[#222A35] text-[12px] text-white">Cancel</button><button onClick={convert} className="flex-1 h-10 rounded-md bg-[#FF6B1A] text-white text-[12px]">Create project</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

/** How the company appears at the top of the quote, and the way to change it. */
function BrandingStrip({ company, fallbackName, onEdit, canEdit }: { company: CompanyPublic | null; fallbackName: string | null; onEdit: () => void; canEdit: boolean }) {
  const name = company?.name || fallbackName || "Your company";
  const complete = !!(company?.logoUrl && (company.phone || company.email));
  return (
    <div className={`rounded-lg border px-3 py-2.5 flex items-center gap-3 flex-wrap ${complete ? "border-[#222A35] bg-[#0A0E14]" : "border-[#FF6B1A]/40 bg-[#FF6B1A]/5"}`}>
      <div className="text-[10px] uppercase tracking-wider text-[#5B6675] shrink-0">Your quotes show</div>
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {company?.logoUrl
          ? <span className="h-8 rounded bg-white px-1 flex items-center shrink-0"><img src={absoluteFileUrl(company.logoUrl)} alt="" className="h-6 w-auto max-w-[90px] object-contain" /></span>
          : <span className="h-8 w-8 rounded border border-dashed border-[#5B6675] text-[9px] text-[#5B6675] flex items-center justify-center shrink-0">logo</span>}
        <div className="min-w-0">
          <div className="text-[12.5px] text-white truncate">{name}</div>
          <div className="text-[10.5px] text-[#8A95A5] truncate">{complete ? [company?.phone, company?.email].filter(Boolean).join(" · ") : "No logo or contact details yet"}</div>
        </div>
      </div>
      {canEdit && (
        <button type="button" onClick={onEdit} className={`h-8 px-3 rounded-md text-[11.5px] shrink-0 ${complete ? "border border-[#222A35] text-[#C2CAD6] hover:text-white" : "bg-[#FF6B1A] text-white hover:bg-[#FF7E33]"}`}>
          {complete ? "Change" : "Add your logo"}
        </button>
      )}
    </div>
  );
}
