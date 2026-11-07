// Quotes written by Buildsasa AI stay editable in the chat. These helpers turn an
// answer into a quote draft, work out its totals, give it back to the AI as a
// table after manual edits, and download it as a proper quotation.
import * as XLSX from "xlsx";
import { jsPDF, lastTableEnd } from "../../services/pdf";
import { drawLetterhead } from "../../services/brandPdf";
import type { QuoteDraft } from "./AiAssistantPanel";
import { company, docBlocks, docLogo, docTitle, esc, fileName, firstQuoteTable, plain, save, toCsv, type DocFormat } from "./aiDocs";

export const quoteSums = (q: QuoteDraft) => {
  const subtotal = q.lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.rate) || 0), 0);
  const discount = Math.max(0, Number(q.discount) || 0);
  const tax = (subtotal - discount) * (Math.max(0, Number(q.taxRate) || 0) / 100);
  return { subtotal, discount, tax, total: Math.max(0, subtotal - discount + tax) };
};
const k2 = (n: number) => Math.round(n).toLocaleString("en-KE");

/** The quote as a markdown table, so the AI sees the user's manual edits. */
export const quoteMarkdown = (q: QuoteDraft) => {
  const t = quoteSums(q);
  return [`Quote: ${q.title} for ${q.clientName || "(client not set)"}`, "",
    "| Item | Description | Quantity | Unit | Rate (KES) | Amount (KES) |", "|---|---|---|---|---|---|",
    ...q.lines.map((l) => `| ${l.section || ""} | ${l.description} | ${l.quantity} | ${l.unit} | ${k2(l.rate)} | ${k2(l.quantity * l.rate)} |`),
    `| **Subtotal** | | | | | **${k2(t.subtotal)}** |`,
    ...(t.discount ? [`| Discount | | | | | -${k2(t.discount)} |`] : []),
    ...(q.taxRate ? [`| VAT ${q.taxRate}% | | | | | ${k2(t.tax)} |`] : []),
    `| **Total** | | | | | **${k2(t.total)}** |`, q.notes ? `\nNotes: ${q.notes}` : ""].join("\n");
};

/** A quote draft from an AI answer with a priced table, or null. Client details,
 *  logo and the saved quote carry over from the previous draft in the chat. */
export function draftFromAnswer(text: string, meta: Record<string, any> = {}, prev?: QuoteDraft): QuoteDraft | null {
  const t = firstQuoteTable(text);
  if (!t) return null;
  const m = text.match(/VAT[^0-9\n]{0,8}(\d{1,2}(?:\.\d+)?)\s*%/i);
  const vat = /\bVAT\b/i.test(text) ? Number(m?.[1] || 16) : 0;
  const notes = docBlocks(text).filter((b) => b.kind === "text").map((b) => plain((b as { text: string }).text)).slice(1).join("\n\n").trim();
  const meaningful = (s?: string) => (s && s !== "Buildsasa AI" ? s : "");
  return {
    title: meaningful(meta.title) || prev?.title || "Quotation",
    clientName: meta.clientName || prev?.clientName || "",
    clientPhone: meta.clientPhone || prev?.clientPhone, clientEmail: prev?.clientEmail, clientAddress: prev?.clientAddress,
    lines: t.lines.map((l) => ({ ...l, quantity: Math.round(l.quantity * 100) / 100, rate: Math.round(l.rate * 100) / 100 })),
    taxRate: meta.taxRate != null && meta.taxRate !== "" ? Number(meta.taxRate) || 0 : vat || prev?.taxRate || 0,
    discount: prev?.discount || 0, notes: meta.notes || notes.slice(0, 1500) || prev?.notes, terms: prev?.terms,
    logo: prev?.logo, savedId: prev?.savedId, quoteNumber: prev?.quoteNumber,
  };
}
export { docTitle };

/** Download a quote as a quotation document. */
export async function exportQuote(q: QuoteDraft, format: DocFormat) {
  const t = quoteSums(q);
  const name = `${q.quoteNumber ? q.quoteNumber + " " : ""}${q.title || "Quote"}`;
  const c = await company();
  if (format === "pdf") {
    const doc = new jsPDF();
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    const meta = [q.quoteNumber ? `Quote no: ${q.quoteNumber}` : "", `Date: ${new Date().toLocaleDateString("en-GB")}`, q.validUntil ? `Valid until: ${new Date(q.validUntil).toLocaleDateString("en-GB")}` : ""].filter(Boolean);
    let y = drawLetterhead(doc, c, await docLogo(q.logo), "QUOTATION", meta);
    if (q.clientName) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(140); doc.text("PREPARED FOR", 14, y);
      doc.setFontSize(10); doc.setTextColor(20); doc.text(q.clientName, 14, y + 6);
      const addr = [q.clientAddress, q.clientPhone, q.clientEmail].filter(Boolean).join("\n");
      doc.setFontSize(9); doc.setTextColor(90); if (addr) doc.text(doc.splitTextToSize(addr, 90), 14, y + 11);
      y += 11 + (addr ? addr.split("\n").length * 4.5 : 0) + 6;
    }
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(20);
    doc.text(doc.splitTextToSize(q.title || "Quotation", W - 28), 14, y);
    const body: any[] = [];
    let last: string | undefined;
    q.lines.forEach((l, i) => {
      if (l.section && l.section !== last) body.push([{ content: l.section, colSpan: 6, styles: { fontStyle: "bold", fillColor: [245, 246, 248] } }]);
      if (l.section) last = l.section;
      body.push([String(i + 1), l.description, l.unit, String(l.quantity), k2(l.rate), k2(l.quantity * l.rate)]);
    });
    (doc as any).autoTable({
      startY: y + 5, head: [["#", "Description", "Unit", "Qty", "Rate (KES)", "Amount (KES)"]], body,
      styles: { fontSize: 9, cellPadding: 2.4 }, headStyles: { fillColor: [11, 42, 74], textColor: 255 },
      columnStyles: { 0: { cellWidth: 9 }, 2: { cellWidth: 16 }, 3: { cellWidth: 16, halign: "right" }, 4: { cellWidth: 28, halign: "right" }, 5: { cellWidth: 32, halign: "right" } },
      margin: { left: 14, right: 14 },
    });
    y = lastTableEnd(doc, 120) + 8;
    if (y > H - 50) { doc.addPage(); y = 20; }
    const rows: [string, string][] = [["Subtotal", `KES ${k2(t.subtotal)}`]];
    if (t.discount) rows.push(["Discount", `- KES ${k2(t.discount)}`]);
    if (q.taxRate) rows.push([`VAT (${q.taxRate}%)`, `KES ${k2(t.tax)}`]);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(60);
    rows.forEach(([a, b]) => { doc.text(a, W - 75, y); doc.text(b, W - 14, y, { align: "right" }); y += 6; });
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(20);
    doc.text("Total", W - 75, y + 1); doc.text(`KES ${k2(t.total)}`, W - 14, y + 1, { align: "right" });
    y += 12;
    const block = (h: string, txt?: string | null) => {
      if (!txt) return;
      const w = doc.splitTextToSize(txt, W - 28);
      if (y + 10 + w.length * 4.5 > H - 15) { doc.addPage(); y = 20; }
      doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(20); doc.text(h, 14, y);
      doc.setFont("helvetica", "normal"); doc.setTextColor(80); doc.text(w, 14, y + 6);
      y += 10 + w.length * 4.5;
    };
    block("Notes", q.notes); block("Terms", q.terms); block("Payment details", c?.paymentDetails);
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(150);
      doc.text("Prepared with Buildsasa", 14, H - 8); doc.text(`${i} / ${pages}`, W - 14, H - 8, { align: "right" });
    }
    doc.save(fileName(name, "pdf"));
    return;
  }
  if (format === "xlsx") {
    const aoa: any[][] = [[c?.name || ""], [`Quotation: ${q.title}`], [`Client: ${q.clientName || ""}`], [], ["Section", "Description", "Unit", "Qty", "Rate (KES)", "Amount (KES)"]];
    const first = aoa.length + 1;
    q.lines.forEach((l, i) => { const r = first + i; aoa.push([l.section || "", l.description, l.unit, l.quantity, l.rate, { t: "n", v: l.quantity * l.rate, f: `D${r}*E${r}` }]); });
    const lastRow = first + q.lines.length - 1, sub = lastRow + 2;
    aoa.push([]);
    aoa.push(["", "", "", "", "Subtotal", { t: "n", v: t.subtotal, f: `SUM(F${first}:F${lastRow})` }]);
    aoa.push(["", "", "", "", "Discount", t.discount]);
    aoa.push(["", "", "", "", "VAT %", Number(q.taxRate) || 0]);
    aoa.push(["", "", "", "", "VAT", { t: "n", v: t.tax, f: `(F${sub}-F${sub + 1})*F${sub + 2}/100` }]);
    aoa.push(["", "", "", "", "Total", { t: "n", v: t.total, f: `F${sub}-F${sub + 1}+F${sub + 3}` }]);
    if (q.notes) aoa.push([], ["Notes"], ...q.notes.split("\n").map((l) => [l]));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 18 }, { wch: 50 }, { wch: 8 }, { wch: 8 }, { wch: 14 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Quote");
    XLSX.writeFile(wb, fileName(name, "xlsx"));
    return;
  }
  if (format === "docx") {
    const logo = await docLogo(q.logo);
    const para = (s?: string) => esc(s || "").split("\n").join("<br/>");
    const rows = q.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${l.section ? `${esc(l.section)}: ` : ""}${esc(l.description)}</td><td>${esc(l.unit)}</td><td class="n">${l.quantity}</td><td class="n">${k2(l.rate)}</td><td class="n">${k2(l.quantity * l.rate)}</td></tr>`).join("");
    const totals: [string, number][] = [["Subtotal", t.subtotal]];
    if (t.discount) totals.push(["Discount", -t.discount]);
    if (q.taxRate) totals.push([`VAT (${q.taxRate}%)`, t.tax]);
    totals.push(["<b>Total</b>", t.total]);
    const contact = [c?.address, [c?.phone, c?.email].filter(Boolean).join(" · "), c?.kraPin ? `KRA PIN: ${c.kraPin}` : ""].filter(Boolean).map((x) => esc(String(x))).join("<br/>");
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${esc(name)}</title>
<style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#222}table{border-collapse:collapse;width:100%;margin:8pt 0}th{background:#0B2A4A;color:#fff;text-align:left}th,td{border:1px solid #ccc;padding:4pt 6pt;font-size:10pt}td.n{text-align:right}.co{border-top:4pt solid #FF6B1A;padding-top:6pt;color:#555;font-size:9pt}h1{color:#FF6B1A;font-size:15pt}</style></head><body>
<div class="co">${logo ? `<img src="${logo}" style="height:48pt"/><br/>` : ""}<b>${esc(c?.name || "")}</b><br/>${contact}</div>
<h1>QUOTATION${q.quoteNumber ? ` ${esc(q.quoteNumber)}` : ""}</h1>
<p>Date: ${new Date().toLocaleDateString("en-GB")}${q.clientName ? `<br/>Prepared for: <b>${esc(q.clientName)}</b>${q.clientPhone ? ` · ${esc(q.clientPhone)}` : ""}` : ""}</p>
<h2>${esc(q.title)}</h2>
<table><tr><th>#</th><th>Description</th><th>Unit</th><th>Qty</th><th>Rate (KES)</th><th>Amount (KES)</th></tr>${rows}${totals.map(([a, b]) => `<tr><td colspan="5" class="n">${a}</td><td class="n">KES ${k2(b)}</td></tr>`).join("")}</table>
${q.notes ? `<h3>Notes</h3><p>${para(q.notes)}</p>` : ""}${q.terms ? `<h3>Terms</h3><p>${para(q.terms)}</p>` : ""}${c?.paymentDetails ? `<h3>Payment details</h3><p>${para(c.paymentDetails)}</p>` : ""}
<p style="color:#999;font-size:8pt">Prepared with Buildsasa</p></body></html>`;
    save(new Blob(["﻿", html], { type: "application/msword" }), fileName(name, "doc"));
    return;
  }
  return toCsv(quoteMarkdown(q), name);
}
