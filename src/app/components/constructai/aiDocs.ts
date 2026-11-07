// Turn a Buildsasa AI answer into a document the contractor can send: a branded
// PDF (company letterhead), an Excel workbook (with live totals), a Word
// document or a CSV. Also reads a priced table back into quote lines so it can
// be saved in Quotes.
import * as XLSX from "xlsx";
import api, { type CompanyPublic } from "../../services/api";
import { companyLogoData, drawLetterhead } from "../../services/brandPdf";
import { jsPDF, lastTableEnd } from "../../services/pdf";

export type DocFormat = "pdf" | "xlsx" | "docx" | "csv";
type Block = { kind: "text"; text: string } | { kind: "table"; head: string[]; rows: string[][] };

const ROW = /^\s*\|.*\|\s*$/;
const SEP = /^\s*\|?[\s:-]+(\|[\s:-]+)+\|?\s*$/;
const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
export const plain = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1");

/** Split an answer into paragraphs and markdown tables. */
export function docBlocks(text: string): Block[] {
  const out: Block[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (ROW.test(lines[i]) && SEP.test(lines[i + 1] || "")) {
      const head = cells(lines[i]);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && ROW.test(lines[i])) rows.push(cells(lines[i++]));
      i--;
      out.push({ kind: "table", head, rows });
    } else {
      const last = out[out.length - 1];
      if (last && last.kind === "text") last.text += "\n" + lines[i]; else out.push({ kind: "text", text: lines[i] });
    }
  }
  return out.map((b) => (b.kind === "text" ? { ...b, text: b.text.trim() } : b)).filter((b) => b.kind === "table" || b.text);
}

/** "KES 12,500", "12,500.50", "1.2k" → number; anything else → null. */
export const num = (s: string): number | null => {
  const t = plain(s).replace(/KES|KSh|Ksh|Kshs|USD|\$|,|\s/gi, "");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
};

// ── Quote lines ──
const col = (head: string[], re: RegExp) => head.findIndex((h) => re.test(plain(h)));
export type QuoteLine = { section?: string; description: string; unit: string; quantity: number; rate: number };
/** A table priced line by line (quantity and rate, or an amount) reads as a quote. */
export function tableToQuoteLines(head: string[], rows: string[][]): QuoteLine[] {
  const iItem = col(head, /^(item|material|activity|element|work|trade|stage)/i);
  const iDesc = col(head, /desc|spec|detail/i);
  const iQty = col(head, /^(qty|quantity|quant)/i);
  const iUnit = col(head, /^unit$|^units?\b|uom/i);
  const iRate = col(head, /rate|unit (price|cost)|price/i);
  const iAmt = col(head, /amount|total|cost|sum/i);
  if (iRate < 0 && iAmt < 0) return [];
  const out: QuoteLine[] = [];
  for (const r of rows) {
    const label = plain([r[iItem] ?? "", r[iDesc] ?? ""].filter(Boolean).join(iItem >= 0 && iDesc >= 0 ? " — " : "")).trim() || plain(r[0] || "");
    // Totals, VAT and subtotal rows are worked out by Quotes itself.
    if (/^(sub ?total|total|grand total|vat|tax|contingenc|discount)/i.test(label) || /^\*\*/.test((r[0] || "").trim()) && /total/i.test(r.join(" "))) continue;
    const qty = iQty >= 0 ? num(r[iQty] || "") : null;
    const rate = iRate >= 0 ? num(r[iRate] || "") : null;
    const amt = iAmt >= 0 && iAmt !== iRate ? num(r[iAmt] || "") : null;
    if (rate == null && amt == null) continue;
    const quantity = qty && qty > 0 ? qty : 1;
    out.push({ description: label.slice(0, 300), unit: (iUnit >= 0 ? plain(r[iUnit] || "") : "") || (qty ? "no." : "item"), quantity, rate: rate ?? Math.round(((amt || 0) / quantity) * 100) / 100 });
  }
  return out;
}
export const firstQuoteTable = (text: string) => {
  for (const b of docBlocks(text)) if (b.kind === "table") { const lines = tableToQuoteLines(b.head, b.rows); if (lines.length) return { ...b, lines }; }
  return null;
};

// ── Company letterhead, fetched once ──
let companyP: Promise<CompanyPublic | null> | null = null;
const company = () => (companyP ||= api.getCompany().then((c) => c as CompanyPublic).catch(() => null));

const fileName = (title: string, ext: string) => `${(title || "Buildsasa document").replace(/[\\/:*?"<>|\n]/g, "-").slice(0, 80).trim()}.${ext}`;
const save = (blob: Blob, name: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
};
/** A short title for the document from the question asked. */
export const docTitle = (question?: string) => {
  const q = (question || "").replace(/\s+/g, " ").replace(/\b(as|in|into|to) (a )?(pdf|excel|word|docx?|xlsx|csv|spreadsheet|document)( format| file)?\b/gi, "").replace(/^(please|can you|could you|kindly)\s+/i, "").trim();
  return q ? q.charAt(0).toUpperCase() + q.slice(1, 70) : "Buildsasa AI";
};
const isQuoteLike = (text: string, title: string) => /quot|boq|bill of quantit|estimate|pric/i.test(title) || !!firstQuoteTable(text);

// ── PDF ──
async function toPdf(text: string, title: string) {
  const doc = new jsPDF();
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const quote = isQuoteLike(text, title);
  const c = await company();
  let y = drawLetterhead(doc, c, await companyLogoData(), quote ? "QUOTATION" : "DOCUMENT", [`Date: ${new Date().toLocaleDateString("en-GB")}`]);
  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(20);
  doc.splitTextToSize(title, W - 28).forEach((l: string) => { doc.text(l, 14, y); y += 6; });
  y += 2;
  const room = (h: number) => { if (y + h > H - 16) { doc.addPage(); y = 18; } };
  for (const b of docBlocks(text)) {
    if (b.kind === "table") {
      const numeric = b.head.map((_, k) => { const filled = b.rows.filter((r) => plain(r[k] || "").trim()); return filled.length > 0 && filled.filter((r) => num(r[k]) != null).length > filled.length / 2; });
      (doc as any).autoTable({
        startY: y, head: [b.head.map(plain)],
        body: b.rows.map((r) => r.map((cell) => ({ content: plain(cell), styles: /\*\*/.test(cell) ? { fontStyle: "bold" } : {} }))),
        styles: { fontSize: 8.5, cellPadding: 2.2, overflow: "linebreak" },
        headStyles: { fillColor: [11, 42, 74], textColor: 255 },
        alternateRowStyles: { fillColor: [247, 248, 250] },
        columnStyles: Object.fromEntries(numeric.map((n, k) => [k, n ? { halign: "right" } : {}])),
        margin: { left: 14, right: 14 },
      });
      y = lastTableEnd(doc, y + 20) + 6;
      continue;
    }
    for (const raw of b.text.split("\n")) {
      const line = raw.trim();
      if (!line) { y += 2; continue; }
      const heading = /^#{1,4}\s+/.test(line) || (/^\*\*[^*]+\*\*:?$/.test(line));
      const bullet = /^[-*•]\s+/.test(line) || /^\d+[.)]\s+/.test(line);
      const content = plain(line.replace(/^#{1,4}\s+/, "").replace(/^[-*•]\s+/, ""));
      doc.setFont("helvetica", heading ? "bold" : "normal"); doc.setFontSize(heading ? 11 : 9.5); doc.setTextColor(heading ? 20 : 55);
      const wrapped = doc.splitTextToSize(content, W - 28 - (bullet ? 5 : 0));
      room(wrapped.length * 4.8 + (heading ? 3 : 0));
      if (heading) y += 2;
      if (bullet && !/^\d/.test(line)) doc.text("•", 15, y);
      doc.text(wrapped, bullet && !/^\d/.test(line) ? 19 : 14, y);
      y += wrapped.length * 4.8 + (heading ? 1.5 : 0.8);
    }
    y += 2;
  }
  if (quote && c?.paymentDetails) {
    const wrapped = doc.splitTextToSize(c.paymentDetails, W - 28);
    room(10 + wrapped.length * 4.5);
    doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(20); doc.text("Payment details", 14, y + 4);
    doc.setFont("helvetica", "normal"); doc.setTextColor(70); doc.text(wrapped, 14, y + 10);
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(150);
    doc.text(`Prepared with Buildsasa${quote ? " · Prices are estimates; confirm with suppliers before ordering" : ""}`, 14, H - 8);
    doc.text(`${i} / ${pages}`, W - 14, H - 8, { align: "right" });
  }
  doc.save(fileName(title, "pdf"));
}

// ── Excel: every table on its own sheet, numbers as numbers, live totals ──
function toXlsx(text: string, title: string) {
  const wb = XLSX.utils.book_new();
  const tables = docBlocks(text).filter((b): b is Extract<Block, { kind: "table" }> => b.kind === "table");
  const notes = docBlocks(text).filter((b) => b.kind === "text").map((b) => plain((b as any).text)).join("\n\n");
  tables.forEach((t, n) => {
    const head = t.head.map(plain);
    const iQty = col(head, /^(qty|quantity)/i), iRate = col(head, /rate|unit (price|cost)|price/i), iAmt = col(head, /amount|total/i);
    const body = t.rows.filter((r) => !/^(sub ?total|total|grand total|vat)/i.test(plain(r[0] || "")) && !(r.every((c, k) => k === 0 || !c || num(c) == null) && /total/i.test(r.join(" "))));
    const aoa: (string | number | { f: string })[][] = [[title], [], head];
    body.forEach((r, k) => {
      const row: any[] = r.map((cell) => { const v = num(cell); return v != null ? v : plain(cell); });
      // Amount = quantity × rate as a formula, so edits recalculate.
      if (iQty >= 0 && iRate >= 0 && iAmt >= 0 && typeof row[iQty] === "number" && typeof row[iRate] === "number") {
        const R = 4 + k, L = (i: number) => XLSX.utils.encode_col(i);
        row[iAmt] = { t: "n", v: row[iQty] * row[iRate], f: `${L(iQty)}${R}*${L(iRate)}${R}` };
      }
      aoa.push(row);
    });
    if (iAmt >= 0 && body.length) {
      const L = XLSX.utils.encode_col(iAmt), first = 4, last = 3 + body.length;
      const line = (label: string, v: number, f: string) => { const r: any[] = new Array(head.length).fill(""); r[Math.max(0, iAmt - 1)] = label; r[iAmt] = { t: "n", v: Math.round(v * 100) / 100, f }; return r; };
      const subtotal = aoa.slice(3).reduce((t, r) => { const c: any = r[iAmt]; return t + (typeof c === "number" ? c : c && typeof c.v === "number" ? c.v : 0); }, 0);
      const vat = /\bVAT\b/i.test(text);
      const sub = last + 2; // the row the subtotal lands on
      aoa.push([], line(vat ? "Subtotal" : "Total", subtotal, `SUM(${L}${first}:${L}${last})`));
      if (vat) aoa.push(line("VAT 16%", subtotal * 0.16, `${L}${sub}*0.16`), line("Total", subtotal * 1.16, `${L}${sub}+${L}${sub + 1}`));
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = head.map((h, k) => ({ wch: Math.min(60, Math.max(10, h.length + 2, ...body.map((r) => plain(r[k] || "").length + 2))) }));
    XLSX.utils.book_append_sheet(wb, ws, tables.length > 1 ? `Table ${n + 1}` : "Quote");
  });
  if (notes) {
    const ws = XLSX.utils.aoa_to_sheet(notes.split("\n").map((l) => [l]));
    ws["!cols"] = [{ wch: 110 }];
    XLSX.utils.book_append_sheet(wb, ws, tables.length ? "Notes" : "Document");
  }
  XLSX.writeFile(wb, fileName(title, "xlsx"));
}

// ── Word: an HTML document Word opens natively (.doc) ──
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
async function toWord(text: string, title: string) {
  const c = await company();
  let html = "";
  for (const b of docBlocks(text)) {
    if (b.kind === "table") {
      html += `<table><tr>${b.head.map((h) => `<th>${inline(h)}</th>`).join("")}</tr>${b.rows.map((r) => `<tr>${r.map((cell) => `<td${num(cell) != null ? ' class="n"' : ""}>${inline(cell)}</td>`).join("")}</tr>`).join("")}</table>`;
      continue;
    }
    let list = "";
    const flush = () => { if (list) { html += `<ul>${list}</ul>`; list = ""; } };
    for (const raw of b.text.split("\n")) {
      const line = raw.trim();
      if (/^[-*•]\s+/.test(line)) { list += `<li>${inline(line.replace(/^[-*•]\s+/, ""))}</li>`; continue; }
      flush();
      if (!line) continue;
      if (/^#{1,4}\s+/.test(line) || /^\*\*[^*]+\*\*:?$/.test(line)) html += `<h2>${inline(plain(line.replace(/^#{1,4}\s+/, "")))}</h2>`;
      else html += `<p>${inline(line)}</p>`;
    }
    flush();
  }
  const head = c ? `<div class="co"><b>${esc(c.name || "")}</b><br/>${[c.address, [c.phone, c.email].filter(Boolean).join(" · "), c.kraPin ? `KRA PIN: ${c.kraPin}` : ""].filter(Boolean).map((x) => esc(String(x))).join("<br/>")}</div>` : "";
  const doc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#222}h1{font-size:16pt;margin:14pt 0 6pt}h2{font-size:12pt;margin:12pt 0 4pt}table{border-collapse:collapse;width:100%;margin:8pt 0}th{background:#0B2A4A;color:#fff;text-align:left}th,td{border:1px solid #ccc;padding:4pt 6pt;font-size:10pt}td.n{text-align:right}.co{border-top:4pt solid #FF6B1A;padding-top:6pt;color:#555;font-size:9pt}.foot{color:#999;font-size:8pt;margin-top:18pt}</style></head>
<body>${head}<h1>${esc(title)}</h1><p style="color:#777;font-size:9pt">${new Date().toLocaleDateString("en-GB")}</p>${html}${c?.paymentDetails && isQuoteLike(text, title) ? `<h2>Payment details</h2><p>${esc(c.paymentDetails).replace(/\n/g, "<br/>")}</p>` : ""}<p class="foot">Prepared with Buildsasa</p></body></html>`;
  save(new Blob(["﻿", doc], { type: "application/msword" }), fileName(title, "doc"));
}

function toCsv(text: string, title: string) {
  const t = docBlocks(text).find((b) => b.kind === "table") as Extract<Block, { kind: "table" }> | undefined;
  const rows = t ? [t.head, ...t.rows] : docBlocks(text).map((b) => [plain((b as any).text || "")]);
  const q = (v: string) => `"${plain(v).replace(/"/g, '""')}"`;
  save(new Blob(["﻿" + rows.map((r) => r.map(q).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }), fileName(title, "csv"));
}

/** Download an AI answer (or one of its tables, as markdown) in a format. */
export async function exportAnswer(text: string, format: DocFormat, title: string) {
  // "Here's the quote…" / "Sure!" reads fine in a chat, not on a document.
  text = text.replace(/^\s*(here'?s|here is|sure|certainly|great|okay|ok)\b[^\n]*\n+/i, "");
  if (format === "pdf") return toPdf(text, title);
  if (format === "xlsx") return toXlsx(text, title);
  if (format === "docx") return toWord(text, title);
  return toCsv(text, title);
}
/** A table back to markdown, to export it on its own. */
export const tableMarkdown = (head: string[], rows: string[][]) => [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

/** "…in PDF", "as an Excel sheet", "word document": the format the user asked for. */
export const askedFormat = (q: string): DocFormat | null => {
  if (/\bpdf\b/i.test(q)) return "pdf";
  if (/\b(excel|xlsx|spreadsheet|sheet)\b/i.test(q)) return "xlsx";
  if (/\b(word|docx?)\b(?! (by|for) word)/i.test(q) && /\b(word doc|word document|word format|in word|as word|docx?)\b/i.test(q)) return "docx";
  if (/\bcsv\b/i.test(q)) return "csv";
  return null;
};

/** A WhatsApp link with the answer as plain text (tables flattened). */
export const whatsappLink = (text: string) => {
  const flat = docBlocks(text).map((b) => b.kind === "text" ? b.text.replace(/\*\*(.+?)\*\*/g, "*$1*") : b.rows.map((r) => r.map(plain).filter(Boolean).join(" · ")).join("\n")).join("\n\n");
  return `https://wa.me/?text=${encodeURIComponent(flat.slice(0, 3500))}`;
};
