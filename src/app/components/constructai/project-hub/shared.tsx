// ============================================================================
// Small building blocks shared by every folder of the project hub, so the eight
// folders read as one page rather than eight modules glued together.
// ============================================================================

import { useEffect, useState, type ReactNode } from "react";
import { X, ExternalLink, Trash2, FileText, Image as ImageIcon, FileSpreadsheet, File as FileIcon, Loader2 } from "lucide-react";
import { absoluteFileUrl, type DocumentDto } from "../../../services/api";
import { useCurrency } from "../CurrencyContext";
import { formatCurrency, formatCompactCurrency, fromKES, toKES, roundForCurrency, CURRENCIES } from "../currency";

export const fmtDate = (d?: string | null, opts?: Intl.DateTimeFormatOptions) => {
  if (!d) return "—";
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? String(d) : parsed.toLocaleDateString(undefined, opts ?? { month: "short", day: "numeric", year: "numeric" });
};

export const fileSizeLabel = (bytes: number) =>
  bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(bytes / 1024))} KB`;

/**
 * Amounts in the hub are STORED in KES; the currency picked in the top bar
 * decides how they are shown and — via toBase/fromBase — the unit every amount
 * field is typed in. Switch the picker to USD and a form asks for dollars.
 */
export function useMoney() {
  const { currency } = useCurrency();
  return {
    code: currency,
    symbol: CURRENCIES[currency].symbol,
    /** Label suffix for an amount field: "Amount (USD)". */
    unit: (label: string) => `${label} (${currency})`,
    /** What the user typed, in the chosen currency → KES for storage. */
    toBase: (typed: number | string) => Math.round(toKES(Number(typed) || 0, currency) * 100) / 100,
    /** A stored KES figure → the number to put in an input, in the chosen currency. */
    fromBase: (kes: number | null | undefined) => (kes == null ? "" : String(roundForCurrency(fromKES(Number(kes) || 0, currency), currency))),
    /** A stored KES figure as a NUMBER in the chosen currency — for spreadsheet
     *  cells, which must stay numeric so they can be summed and formatted. */
    amount: (kes: number | null | undefined) => roundForCurrency(fromKES(Number(kes) || 0, currency), currency),
    fmt: (kes: number | null | undefined) => (kes == null ? "—" : formatCurrency(Math.round(Number(kes) || 0), currency)),
    compact: (kes: number | null | undefined) => (kes == null ? "—" : formatCompactCurrency(Math.round(Number(kes) || 0), currency)),
    /** Signed, for variations: +KSh 1.2M / −KSh 300K. */
    signed: (kes: number) => `${kes < 0 ? "−" : "+"}${formatCurrency(Math.abs(Math.round(kes)), currency)}`,
  };
}

export const input = "h-9 w-full bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-[12px] text-white placeholder:text-[#3A4350] focus:outline-none focus:border-[#FF6B1A]";
export const textarea = "w-full bg-[#0A0E14] border border-[#222A35] rounded-md px-3 py-2 text-[12px] text-white placeholder:text-[#3A4350] focus:outline-none focus:border-[#FF6B1A] min-h-[72px]";
export const btnPrimary = "h-9 px-3.5 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[12px] flex items-center justify-center gap-1.5 disabled:opacity-60 shrink-0";
export const btnGhost = "h-9 px-3 rounded-md border border-[#222A35] text-[12px] text-[#C2CAD6] hover:text-white hover:border-[#FF6B1A]/50 flex items-center justify-center gap-1.5 disabled:opacity-60 shrink-0";
export const btnDanger = "h-9 px-3 rounded-md border border-[#EF4444]/40 text-[12px] text-[#EF4444] hover:bg-[#EF4444]/10 flex items-center justify-center gap-1.5 disabled:opacity-60 shrink-0";

export function Panel({ title, subtitle, action, children, className = "" }: { title: string; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden ${className}`}>
      <div className="px-4 py-3 border-b border-[#222A35] flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-[13px] text-white font-display">{title}</div>
          {subtitle && <div className="text-[11px] text-[#8A95A5]">{subtitle}</div>}
        </div>
        {action && <div className="flex items-center gap-2">{action}</div>}
      </div>
      {children}
    </div>
  );
}

export function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "good" | "bad" | "warn" | "brand" }) {
  const color = tone === "good" ? "text-[#22C55E]" : tone === "bad" ? "text-[#EF4444]" : tone === "warn" ? "text-[#F5A623]" : tone === "brand" ? "text-[#FF6B1A]" : "text-white";
  return (
    <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-4 min-w-0">
      <div className="text-[11px] text-[#8A95A5]">{label}</div>
      <div className={`text-[19px] sm:text-[21px] mt-1 font-display leading-tight break-words ${color}`}>{value}</div>
      {sub && <div className="text-[10.5px] text-[#5B6675] mt-1 leading-snug">{sub}</div>}
    </div>
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "bad" | "warn" | "info" | "brand" }) {
  const cls = {
    neutral: "bg-[#5B6675]/15 text-[#8A95A5] border-[#222A35]",
    good: "bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/30",
    bad: "bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/30",
    warn: "bg-[#F5A623]/15 text-[#F5A623] border-[#F5A623]/30",
    info: "bg-[#3B82F6]/15 text-[#3B82F6] border-[#3B82F6]/30",
    brand: "bg-[#FF6B1A]/15 text-[#FF6B1A] border-[#FF6B1A]/30",
  }[tone];
  return <span className={`px-2 py-0.5 rounded-full text-[10px] border whitespace-nowrap ${cls}`}>{children}</span>;
}

export const statusTone = (s?: string | null): "neutral" | "good" | "bad" | "warn" | "info" => {
  const v = String(s || "").toLowerCase();
  if (["approved", "paid", "closed", "resolved", "done", "complete", "completed", "issued", "on track", "active"].includes(v)) return "good";
  if (["rejected", "void", "overdue", "major", "fatality", "at risk", "blocked"].includes(v)) return "bad";
  if (["submitted", "under_review", "pm_review", "owner_approval", "in_progress", "investigating", "ready_for_review", "pending", "moderate", "in review"].includes(v)) return "warn";
  if (["drafted", "draft", "open", "planning", "minor"].includes(v)) return "info";
  return "neutral";
};
export const statusLabel = (s?: string | null) => String(s || "—").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function Bar({ pct, tone = "brand", className = "h-1.5" }: { pct: number | null | undefined; tone?: "brand" | "good" | "bad" | "warn" | "info"; className?: string }) {
  const value = pct == null ? 0 : Math.min(100, Math.max(0, pct));
  const color = { brand: "bg-[#FF6B1A]", good: "bg-[#22C55E]", bad: "bg-[#EF4444]", warn: "bg-[#F5A623]", info: "bg-[#3B82F6]" }[tone];
  return (
    <div className={`${className} rounded-full bg-[#222A35] overflow-hidden`}>
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${value}%` }} />
    </div>
  );
}

export function Empty({ icon: Icon, title, hint, children }: { icon: any; title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-10 flex flex-col items-center text-center gap-2">
      <div className="w-10 h-10 rounded-xl bg-[#FF6B1A]/10 border border-[#FF6B1A]/20 flex items-center justify-center"><Icon className="w-5 h-5 text-[#FF6B1A]" /></div>
      <div className="text-[13px] text-white">{title}</div>
      {hint && <div className="text-[11.5px] text-[#8A95A5] max-w-sm">{hint}</div>}
      {children && <div className="mt-2 flex gap-2 flex-wrap justify-center">{children}</div>}
    </div>
  );
}

/** Close on Escape — shared by the modal and the rate-library drawer. */
export function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
}

/** Modal shell used by every "Add …" form in the hub. */
export function Modal({ title, subtitle, onClose, children, wide }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEscape(onClose);
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className={`bg-[#11161D] border border-[#222A35] rounded-t-2xl sm:rounded-xl w-full ${wide ? "sm:max-w-3xl" : "sm:max-w-lg"} max-h-[92vh] overflow-y-auto`}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[#222A35] sticky top-0 bg-[#11161D] z-10">
          <div>
            <div className="text-[15px] text-white font-display">{title}</div>
            {subtitle && <div className="text-[11.5px] text-[#8A95A5] mt-0.5">{subtitle}</div>}
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-md text-[#8A95A5] hover:text-white hover:bg-[#161C24] flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children, hint, className = "" }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <div className="text-[11px] text-[#8A95A5] mb-1.5">{label}</div>
      {children}
      {hint && <div className="text-[10.5px] text-[#5B6675] mt-1">{hint}</div>}
    </label>
  );
}

export const fileIcon = (name: string) => {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "heic"].includes(ext)) return ImageIcon;
  if (["xls", "xlsx", "csv"].includes(ext)) return FileSpreadsheet;
  if (["pdf", "doc", "docx", "txt"].includes(ext)) return FileText;
  return FileIcon;
};

/** One file row: icon, name, meta, open + delete. */
export function DocRow({ doc, onDelete, extra, compact }: { doc: DocumentDto; onDelete?: (d: DocumentDto) => void; extra?: ReactNode; compact?: boolean }) {
  const Icon = fileIcon(doc.name);
  const [busy, setBusy] = useState(false);
  return (
    <div className={`px-4 ${compact ? "py-2" : "py-3"} flex items-center gap-3 hover:bg-[#161C24]/60 transition`}>
      <Icon className="w-4 h-4 text-[#FF6B1A] shrink-0" />
      <div className="min-w-0 flex-1">
        <a href={absoluteFileUrl(doc.url)} target="_blank" rel="noreferrer" className="text-[12.5px] text-white hover:underline truncate block">{doc.name}</a>
        <div className="text-[10.5px] text-[#5B6675] truncate">
          {doc.size} · {doc.createdAt ? fmtDate(doc.createdAt) : doc.updated}{doc.uploadedBy ? ` · ${doc.uploadedBy}` : ""}{doc.note ? ` · ${doc.note}` : ""}
        </div>
      </div>
      {extra}
      <a href={absoluteFileUrl(doc.url)} target="_blank" rel="noreferrer" title="Open / download" className="w-8 h-8 rounded-md flex items-center justify-center text-[#8A95A5] hover:text-white hover:bg-[#161C24]"><ExternalLink className="w-3.5 h-3.5" /></a>
      {onDelete && (
        <button disabled={busy} onClick={async () => { setBusy(true); try { await onDelete(doc); } finally { setBusy(false); } }} title="Delete" className="w-8 h-8 rounded-md flex items-center justify-center text-[#5B6675] hover:text-[#EF4444] hover:bg-[#EF4444]/10 disabled:opacity-50">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
        </button>
      )}
    </div>
  );
}
