// ============================================================================
// Turn a spreadsheet (xlsx / xls / csv) into BOQ sections and items in the
// browser, so the server only ever receives clean rows.
//
// Real bills are messy: headers on row 3, section titles as a lone row of text,
// "Qty" in one file and "Quantity" in the next. This finds the header row by
// looking for something that means "description", maps the columns it can, and
// treats any row that has a description but no quantity/rate/unit as a section
// heading. Whatever it decides is shown to the user before anything is saved.
// ============================================================================

import * as XLSX from "xlsx";

export type ImportItem = { code?: string; description: string; unit?: string; quantity?: number; rate?: number };
export type ImportSection = { code?: string; title: string; items: ImportItem[] };
export type ImportResult = { sections: ImportSection[]; itemCount: number; total: number; warnings: string[]; sheetName: string };

const norm = (v: unknown) => String(v ?? "").trim();
const lower = (v: unknown) => norm(v).toLowerCase();
const toNum = (v: unknown): number | undefined => {
  if (v == null || v === "") return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  const cleaned = String(v).replace(/[^\d.\-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
};

const HEADER_HINTS = {
  code: ["ref", "item", "item no", "item no.", "no", "no.", "code", "bill ref", "item ref"],
  description: ["description", "desc", "particulars", "item description", "description of works", "work description"],
  unit: ["unit", "units", "uom", "u/m"],
  quantity: ["qty", "quantity", "quant", "qnty"],
  rate: ["rate", "unit rate", "rate (kes)", "rate kes", "unit price", "price"],
  amount: ["amount", "total", "amount (kes)", "amount kes", "sum"],
};

function detectHeader(rows: unknown[][]): { rowIndex: number; cols: Partial<Record<keyof typeof HEADER_HINTS, number>> } | null {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const row = rows[r] || [];
    const cols: Partial<Record<keyof typeof HEADER_HINTS, number>> = {};
    row.forEach((cell, c) => {
      const v = lower(cell);
      if (!v) return;
      for (const key of Object.keys(HEADER_HINTS) as (keyof typeof HEADER_HINTS)[]) {
        if (cols[key] == null && HEADER_HINTS[key].some((h) => v === h || v.startsWith(h + " ") || v.startsWith(h + "("))) cols[key] = c;
      }
    });
    // A header row must at least name the description column and one figure.
    if (cols.description != null && (cols.rate != null || cols.quantity != null || cols.amount != null)) return { rowIndex: r, cols };
  }
  return null;
}

export function parseBoqWorkbook(data: ArrayBuffer, fileName: string): ImportResult {
  const wb = XLSX.read(data, { type: "array" });
  const warnings: string[] = [];
  // Use the first sheet that has a recognisable header; a priced bill often has a
  // summary sheet first.
  let chosen: { name: string; rows: unknown[][]; header: NonNullable<ReturnType<typeof detectHeader>> } | null = null;
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: "" });
    const header = detectHeader(rows);
    if (header) { chosen = { name, rows, header }; break; }
  }
  if (!chosen) {
    // No header row we recognise. Fall back to positional columns on the first
    // sheet: ref, description, unit, qty, rate — the most common layout.
    const name = wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: "" });
    warnings.push("No header row was recognised, so columns were read in the usual order: Ref, Description, Unit, Qty, Rate. Check the preview.");
    chosen = { name, rows, header: { rowIndex: -1, cols: { code: 0, description: 1, unit: 2, quantity: 3, rate: 4 } } };
  }

  const { cols, rowIndex } = chosen.header;
  const sections: ImportSection[] = [];
  let current: ImportSection | null = null;
  let itemCount = 0; let total = 0; let skipped = 0;

  for (let r = rowIndex + 1; r < chosen.rows.length; r++) {
    const row = chosen.rows[r] || [];
    const description = norm(row[cols.description!]);
    const code = cols.code != null ? norm(row[cols.code]) : "";
    const unit = cols.unit != null ? norm(row[cols.unit]) : "";
    const quantity = cols.quantity != null ? toNum(row[cols.quantity]) : undefined;
    let rate = cols.rate != null ? toNum(row[cols.rate]) : undefined;
    const amount = cols.amount != null ? toNum(row[cols.amount]) : undefined;
    if (!description && !code) continue; // blank spacer row

    // Totals / carried-forward lines are not items.
    const dl = description.toLowerCase();
    if (/^(total|sub[- ]?total|carried (to|forward)|brought forward|grand total|summary)/.test(dl)) continue;

    const looksLikeHeading = description && quantity == null && rate == null && !unit && amount == null;
    if (looksLikeHeading) {
      current = { code: code || undefined, title: description.replace(/\s+/g, " ").slice(0, 200), items: [] };
      sections.push(current);
      continue;
    }
    if (!description) { skipped += 1; continue; }
    if (!current) { current = { title: "Bill", items: [] }; sections.push(current); }
    // A rate can be recovered from amount ÷ qty when the file only carries amounts.
    if (rate == null && amount != null && quantity) rate = Math.round((amount / quantity) * 100) / 100;
    const item: ImportItem = { code: code || undefined, description, unit: unit || undefined, quantity: quantity ?? 0, rate: rate ?? 0 };
    current.items.push(item);
    itemCount += 1;
    total += (item.quantity || 0) * (item.rate || 0);
  }

  // Drop headings that turned out to have nothing under them (page titles etc.).
  const cleaned = sections.filter((s) => s.items.length > 0);
  if (skipped) warnings.push(`${skipped} row${skipped === 1 ? " was" : "s were"} skipped for having no description.`);
  const unpriced = cleaned.reduce((n, s) => n + s.items.filter((i) => !i.rate).length, 0);
  if (unpriced) warnings.push(`${unpriced} item${unpriced === 1 ? " has" : "s have"} no rate and will be imported unpriced.`);
  if (!itemCount) warnings.push(`No priced items were found in “${fileName}”. The file needs a Description column plus Qty and Rate (or Amount).`);

  return { sections: cleaned, itemCount, total: Math.round(total * 100) / 100, warnings, sheetName: chosen.name };
}

export async function parseBoqFile(file: File): Promise<ImportResult> {
  const buf = await file.arrayBuffer();
  return parseBoqWorkbook(buf, file.name);
}
