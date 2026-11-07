// An AI-written quote, editable right in the chat: client, lines, quantities,
// rates, VAT, discount, notes and the logo on the letterhead. Download it as a
// PDF, Excel or Word quotation, or save it in Quotes (saving again updates it).
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, FileSpreadsheet, FileText, FileType2, ImagePlus, Loader2, Pencil, Plus, Save, Trash2, ArrowUpRight, MessageCircle } from "lucide-react";
import api, { type CompanyDto } from "../../services/api";
import { forgetCompanyLogo } from "../../services/brandPdf";
import type { QuoteDraft } from "./AiAssistantPanel";
import { setChatLogo, getChatLogo, whatsappLink, type DocFormat } from "./aiDocs";
import { exportQuote, quoteMarkdown, quoteSums } from "./aiQuote";

const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;
let companyP: Promise<CompanyDto | null> | null = null;
const loadCompany = () => (companyP ||= api.getCompany().catch(() => null));

/** Save a draft in Quotes, or update the quote it was saved as. */
export async function saveQuoteDraft(q: QuoteDraft): Promise<{ id: string; quoteNumber: string }> {
  if (!q.clientName.trim()) throw new Error("Add the client's name first.");
  if (!q.lines.some((l) => l.description.trim())) throw new Error("Add at least one line.");
  const payload: any = {
    title: q.title.trim() || "Quotation", clientName: q.clientName.trim(), clientPhone: q.clientPhone || null, clientEmail: q.clientEmail || null, clientAddress: q.clientAddress || null,
    items: q.lines.filter((l) => l.description.trim()).map((l) => ({ section: l.section || "", description: l.description, unit: l.unit || "item", quantity: Number(l.quantity) || 0, rate: Number(l.rate) || 0 })),
    taxRate: Number(q.taxRate) || null, discount: Number(q.discount) || null, notes: q.notes || null, terms: q.terms || null, validUntil: q.validUntil || null,
  };
  const r = q.savedId ? await api.updateQuote(q.savedId, payload) : await api.createQuote(payload);
  return { id: r.id, quoteNumber: r.quoteNumber };
}

function useQuoteActions(q: QuoteDraft, onChange: (q: QuoteDraft) => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const download = async (f: DocFormat) => {
    setBusy(f);
    try { await exportQuote(q, f); } catch (e: any) { toast.error(e?.message || "Couldn't create the file."); }
    setBusy(null);
  };
  const save = async () => {
    setBusy("save");
    try {
      const r = await saveQuoteDraft(q);
      onChange({ ...q, savedId: r.id, quoteNumber: r.quoteNumber });
      toast.success(q.savedId ? `Updated ${r.quoteNumber}.` : `Saved as ${r.quoteNumber}. Open Quotes to send it to the client.`);
    } catch (e: any) { toast.error(e?.message || "Couldn't save the quote."); }
    setBusy(null);
  };
  return { busy, download, save };
}

/** The compact quote card under the AI's answer. */
export function QuoteCard({ q, onChange, onEdit, onOpenQuotes }: { q: QuoteDraft; onChange: (q: QuoteDraft) => void; onEdit: () => void; onOpenQuotes: () => void }) {
  const { busy, download, save } = useQuoteActions(q, onChange);
  const t = quoteSums(q);
  const btn = "h-8 px-2.5 rounded-lg border border-[#222A35] text-[12px] text-[#C2CAD6] hover:text-white hover:bg-[#161C24] inline-flex items-center gap-1.5 disabled:opacity-50";
  const spin = (k: string, I: any) => (busy === k ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <I className="w-3.5 h-3.5" />);
  return (
    <div className="mt-3 rounded-xl border border-[#FF6B1A]/35 bg-[#11161D] overflow-hidden">
      <button onClick={onEdit} className="w-full text-left px-3.5 py-3 flex items-center gap-3 hover:bg-[#161C24]">
        <span className="w-9 h-9 rounded-lg bg-[#FF6B1A]/12 flex items-center justify-center shrink-0"><FileText className="w-4 h-4 text-[#FF6B1A]" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] text-white truncate">{q.quoteNumber ? `${q.quoteNumber} · ` : ""}{q.title || "Quotation"}</span>
          <span className="block text-[11.5px] text-[#8A95A5] truncate">{q.clientName || "No client yet"} · {q.lines.length} line{q.lines.length === 1 ? "" : "s"}{q.taxRate ? ` · VAT ${q.taxRate}%` : ""}</span>
        </span>
        <span className="text-right shrink-0"><span className="block text-[14px] text-white font-semibold">{kes(t.total)}</span><span className="block text-[11px] text-[#FF8A47] inline-flex items-center gap-1"><Pencil className="w-3 h-3" /> Edit quote</span></span>
      </button>
      <div className="px-3.5 pb-3 flex flex-wrap gap-1.5">
        <button className={btn} disabled={!!busy} onClick={() => download("pdf")}>{spin("pdf", FileText)} PDF</button>
        <button className={btn} disabled={!!busy} onClick={() => download("xlsx")}>{spin("xlsx", FileSpreadsheet)} Excel</button>
        <button className={btn} disabled={!!busy} onClick={() => download("docx")}>{spin("docx", FileType2)} Word</button>
        <a className={btn} href={whatsappLink(quoteMarkdown(q))} target="_blank" rel="noreferrer"><MessageCircle className="w-3.5 h-3.5" /> WhatsApp</a>
        <span className="flex-1" />
        {q.savedId && <button className={btn} onClick={onOpenQuotes}><ArrowUpRight className="w-3.5 h-3.5" /> Open in Quotes</button>}
        <button onClick={save} disabled={!!busy} className="h-8 px-3 rounded-lg bg-[#FF6B1A] hover:bg-[#FF7E33] text-[#ffffff] text-[12px] font-medium inline-flex items-center gap-1.5 disabled:opacity-60">{spin("save", q.savedId ? Check : Save)} {q.savedId ? "Update quote" : "Save to Quotes"}</button>
      </div>
    </div>
  );
}

/** The full editor, shown in the preview pane. */
export function QuoteEditor({ q, onChange, onOpenQuotes }: { q: QuoteDraft; onChange: (q: QuoteDraft) => void; onOpenQuotes: () => void }) {
  const { busy, download, save } = useQuoteActions(q, onChange);
  const [company, setCompany] = useState<CompanyDto | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { loadCompany().then(setCompany); }, []);
  const t = quoteSums(q);
  const set = (patch: Partial<QuoteDraft>) => onChange({ ...q, ...patch });
  const setLine = (i: number, patch: Partial<QuoteDraft["lines"][number]>) => set({ lines: q.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) });
  const logo = q.logo || getChatLogo() || company?.logoUrl || null;

  const uploadLogo = async (list: FileList | null) => {
    const f = Array.from(list || []).find((x) => x.type.startsWith("image/"));
    if (!f) return;
    setUploading(true);
    try {
      const { urls, failed } = await api.uploadFiles([f]);
      failed.forEach((x) => toast.error(`${x.name}: ${x.error}`));
      if (urls[0]) { setChatLogo(urls[0]); set({ logo: urls[0] }); toast.success("Logo added to this quote."); }
    } catch (e: any) { toast.error(e?.message || "Upload failed."); }
    setUploading(false); if (fileRef.current) fileRef.current.value = "";
  };
  const makeCompanyLogo = async () => {
    if (!q.logo) return;
    try { const c = await api.updateCompany({ logoUrl: q.logo }); forgetCompanyLogo(); companyP = Promise.resolve(c); setCompany(c); toast.success("Saved as your company logo. It will appear on every quote and invoice."); }
    catch (e: any) { toast.error(e?.message || "Couldn't update the company logo."); }
  };

  const inp = "w-full h-8 rounded-md bg-[#0A0E14] border border-[#222A35] px-2 text-[12.5px] text-white focus:outline-none focus:border-[#FF6B1A]/50";
  const label = "text-[10.5px] uppercase tracking-wider text-[#5B6675]";
  const spin = (k: string, I: any) => (busy === k ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <I className="w-3.5 h-3.5" />);
  return (
    <div className="space-y-4">
      {/* Letterhead logo */}
      <div className="rounded-lg border border-[#222A35] bg-[#11161D] p-3 flex items-center gap-3">
        <div className="w-16 h-12 rounded-md bg-[#ffffff] flex items-center justify-center overflow-hidden shrink-0 border border-[#222A35]">
          {logo ? <img src={logo} alt="Logo" className="max-w-full max-h-full object-contain" /> : <span className="text-[10px] text-[#8A95A5]">No logo</span>}
        </div>
        <div className="min-w-0 flex-1 text-[12px] text-[#8A95A5]">
          {q.logo ? "This logo goes on the quote's letterhead." : company?.logoUrl ? "Your company logo goes on the letterhead." : "Add your logo to brand the quote."}
          {q.logo && company?.canEdit && company.logoUrl !== q.logo && <button onClick={makeCompanyLogo} className="block text-[12px] text-[#FF8A47] hover:underline mt-0.5">Use it on every quote and invoice</button>}
        </div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => uploadLogo(e.target.files)} />
        <button onClick={() => fileRef.current?.click()} disabled={uploading} className="h-8 px-2.5 rounded-md border border-[#222A35] text-[12px] text-[#C2CAD6] hover:text-white inline-flex items-center gap-1.5 disabled:opacity-50">{uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />} {logo ? "Change" : "Upload logo"}</button>
      </div>

      {/* Client and job */}
      <div className="grid grid-cols-2 gap-2.5">
        <label className="col-span-2"><span className={label}>Job title</span><input aria-label="Job title" className={inp} value={q.title} onChange={(e) => set({ title: e.target.value })} /></label>
        <label><span className={label}>Client name</span><input aria-label="Client name" className={inp} value={q.clientName} onChange={(e) => set({ clientName: e.target.value })} placeholder="e.g. John Kamau" /></label>
        <label><span className={label}>Client phone</span><input className={inp} value={q.clientPhone || ""} onChange={(e) => set({ clientPhone: e.target.value })} placeholder="07…" /></label>
        <label><span className={label}>Client email</span><input className={inp} value={q.clientEmail || ""} onChange={(e) => set({ clientEmail: e.target.value })} /></label>
        <label><span className={label}>Valid until</span><input type="date" className={inp} value={q.validUntil || ""} onChange={(e) => set({ validUntil: e.target.value })} /></label>
      </div>

      {/* Lines */}
      <div className="rounded-lg border border-[#222A35] overflow-x-auto">
        <table className="w-full text-[12px] min-w-[600px]">
          <thead className="bg-[#161C24] text-[#8A95A5]">
            <tr><th className="text-left font-medium px-2 py-2 w-24">Section</th><th className="text-left font-medium px-2 py-2">Description</th><th className="text-left font-medium px-2 py-2 w-16">Unit</th><th className="text-right font-medium px-2 py-2 w-16">Qty</th><th className="text-right font-medium px-2 py-2 w-24">Rate</th><th className="text-right font-medium px-2 py-2 w-20">Amount</th><th className="w-8" /></tr>
          </thead>
          <tbody>
            {q.lines.map((l, i) => (
              <tr key={i} className="border-t border-[#222A35] align-top">
                <td className="p-1"><input aria-label={`Section ${i + 1}`} className={inp} value={l.section || ""} onChange={(e) => setLine(i, { section: e.target.value })} /></td>
                <td className="p-1"><textarea aria-label={`Description ${i + 1}`} rows={2} className={`${inp} h-auto min-h-8 py-1.5 resize-y leading-snug`} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} /></td>
                <td className="p-1"><input aria-label={`Unit ${i + 1}`} className={inp} value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} /></td>
                <td className="p-1"><input aria-label={`Quantity ${i + 1}`} type="number" className={`${inp} text-right`} value={l.quantity} onChange={(e) => setLine(i, { quantity: Number(e.target.value) })} /></td>
                <td className="p-1"><input aria-label={`Rate ${i + 1}`} type="number" className={`${inp} text-right`} value={l.rate} onChange={(e) => setLine(i, { rate: Number(e.target.value) })} /></td>
                <td className="px-2 py-2 text-right text-[#D5DBE3] whitespace-nowrap">{Math.round((Number(l.quantity) || 0) * (Number(l.rate) || 0)).toLocaleString("en-KE")}</td>
                <td className="p-1"><button onClick={() => set({ lines: q.lines.filter((_, k) => k !== i) })} className="h-8 w-7 text-[#5B6675] hover:text-[#EF4444] flex items-center justify-center" aria-label={`Remove line ${i + 1}`}><Trash2 className="w-3.5 h-3.5" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={() => set({ lines: [...q.lines, { section: q.lines[q.lines.length - 1]?.section || "", description: "", unit: "item", quantity: 1, rate: 0 }] })} className="w-full h-9 border-t border-[#222A35] text-[12px] text-[#FF8A47] hover:bg-[#161C24] inline-flex items-center justify-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add line</button>
      </div>

      {/* Totals */}
      <div className="ml-auto w-full max-w-sm space-y-1.5 text-[12.5px] whitespace-nowrap">
        <div className="flex justify-between text-[#C2CAD6]"><span>Subtotal</span><span>{kes(t.subtotal)}</span></div>
        <div className="flex justify-between items-center text-[#C2CAD6] gap-2"><span>Discount (KES)</span><input aria-label="Discount" type="number" className={`${inp} w-28 text-right`} value={q.discount || ""} onChange={(e) => set({ discount: Number(e.target.value) || 0 })} /></div>
        <div className="flex justify-between items-center text-[#C2CAD6] gap-2"><span>VAT %</span><input aria-label="VAT percent" type="number" className={`${inp} w-28 text-right`} value={q.taxRate || ""} placeholder="0" onChange={(e) => set({ taxRate: Number(e.target.value) || 0 })} /></div>
        {!!q.taxRate && <div className="flex justify-between text-[#8A95A5]"><span>VAT</span><span>{kes(t.tax)}</span></div>}
        <div className="flex justify-between text-white font-semibold text-[14px] pt-1.5 border-t border-[#222A35]"><span>Total</span><span>{kes(t.total)}</span></div>
      </div>

      <label className="block"><span className={label}>Notes, inclusions and exclusions</span><textarea rows={4} className={`${inp} h-auto py-1.5 resize-y`} value={q.notes || ""} onChange={(e) => set({ notes: e.target.value })} /></label>
      <label className="block"><span className={label}>Terms</span><textarea rows={2} className={`${inp} h-auto py-1.5 resize-y`} value={q.terms || ""} onChange={(e) => set({ terms: e.target.value })} placeholder="e.g. 50% deposit to start, balance on completion" /></label>

      <div className="flex flex-wrap gap-2 pt-3 sticky bottom-0 bg-[#0F141B] pb-1 border-t border-[#222A35] -mx-4 px-4">
        <button onClick={() => download("pdf")} disabled={!!busy} className="h-9 px-3 rounded-lg border border-[#222A35] text-[12.5px] text-[#C2CAD6] hover:text-white inline-flex items-center gap-1.5 disabled:opacity-50">{spin("pdf", FileText)} PDF</button>
        <button onClick={() => download("xlsx")} disabled={!!busy} className="h-9 px-3 rounded-lg border border-[#222A35] text-[12.5px] text-[#C2CAD6] hover:text-white inline-flex items-center gap-1.5 disabled:opacity-50">{spin("xlsx", FileSpreadsheet)} Excel</button>
        <button onClick={() => download("docx")} disabled={!!busy} className="h-9 px-3 rounded-lg border border-[#222A35] text-[12.5px] text-[#C2CAD6] hover:text-white inline-flex items-center gap-1.5 disabled:opacity-50">{spin("docx", FileType2)} Word</button>
        <span className="flex-1" />
        {q.savedId && <button onClick={onOpenQuotes} className="h-9 px-3 rounded-lg border border-[#222A35] text-[12.5px] text-[#C2CAD6] hover:text-white inline-flex items-center gap-1.5"><ArrowUpRight className="w-3.5 h-3.5" /> Open in Quotes</button>}
        <button onClick={save} disabled={!!busy} className="h-9 px-3.5 rounded-lg bg-[#FF6B1A] hover:bg-[#FF7E33] text-[#ffffff] text-[12.5px] font-medium inline-flex items-center gap-1.5 disabled:opacity-60">{spin("save", q.savedId ? Check : Save)} {q.savedId ? `Update ${q.quoteNumber || "quote"}` : "Save to Quotes"}</button>
      </div>
    </div>
  );
}
