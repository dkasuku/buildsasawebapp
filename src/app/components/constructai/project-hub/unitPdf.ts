// A unit's progress report as a branded PDF: the company letterhead, the
// unit's stages, open snags, payments and invoices, the latest updates and a
// grid of recent photos (this unit's and the whole building's), with the link
// to the buyer's private page. Made in the browser, then uploaded so it can be
// sent on WhatsApp or by email as a link.
import api, { type UnitDto } from "../../../services/api";
import { jsPDF, lastTableEnd } from "../../../services/pdf";
import { companyLogoData, drawLetterhead } from "../../../services/brandPdf";
import { company } from "../aiDocs";
import { clientApi } from "../client/clientData";

const kes = (n: number) => `KES ${Math.round(Number(n) || 0).toLocaleString("en-KE")}`;
const day = (d?: string | null) => { if (!d) return ""; const t = new Date(d); return isNaN(+t) ? String(d) : t.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); };
const OPEN = (s: string) => !["resolved", "closed", "rejected"].includes(s);

/** A photo, shrunk to a JPEG a PDF can carry without becoming huge. */
async function photo(url: string, max = 900): Promise<{ data: string; w: number; h: number } | null> {
  try {
    const { dataUrl } = await api.fileDataUrl(url);
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
        resolve({ data: c.toDataURL("image/jpeg", 0.75), w: c.width, h: c.height });
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  } catch { return null; }
}

export async function unitReportPdf(projectId: string, projectName: string, u: UnitDto): Promise<{ blob: Blob; fileName: string }> {
  const [c, logo, updates, invoices, snags] = await Promise.all([
    company(), companyLogoData(),
    clientApi.projectUpdates(projectId).catch(() => []),
    api.getInvoices(projectId).catch(() => []),
    api.listPunch({ projectId, unitId: u.id } as any).catch(() => []),
  ]);
  const mine = updates.filter((x) => !x.unitId || x.unitId === u.id).slice(0, 6);
  const myInvoices = (invoices as any[]).filter((i) => i.unitId === u.id && i.status !== "draft");
  const doc = new jsPDF();
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  let y = drawLetterhead(doc, c, logo, "UNIT PROGRESS REPORT", [`Unit: ${u.code}`, `Date: ${day(new Date().toISOString())}`]);
  const room = (need: number) => { if (y + need > H - 18) { doc.addPage(); y = 20; } };

  // Who and what
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(140);
  doc.text("PREPARED FOR", 14, y); doc.text("PROJECT", W / 2, y);
  doc.setFontSize(10.5); doc.setTextColor(20);
  doc.text(u.clientName || "The owner of this unit", 14, y + 6);
  doc.text(doc.splitTextToSize(projectName, W / 2 - 14), W / 2, y + 6);
  doc.setFontSize(9); doc.setTextColor(90);
  doc.text([u.block ? `Block ${u.block}` : "", u.floor ? `Floor ${u.floor}` : "", u.type || ""].filter(Boolean).join(" · ") || " ", W / 2, y + 11.5);
  y += 20;

  // Progress
  doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.setTextColor(u.progress >= 100 ? 22 : 244, u.progress >= 100 ? 163 : 91, u.progress >= 100 ? 74 : 30);
  doc.text(`${u.progress}%`, 14, y + 6);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(60);
  doc.text(u.statusLabel || u.status.replace(/_/g, " "), 44, y + 1);
  doc.setFillColor(235, 237, 240); doc.roundedRect(44, y + 3.5, W - 58, 3.5, 1.5, 1.5, "F");
  if (u.progress) { doc.setFillColor(244, 91, 30); doc.roundedRect(44, y + 3.5, (W - 58) * (u.progress / 100), 3.5, 1.5, 1.5, "F"); }
  y += 14;

  // Stages
  (doc as any).autoTable({
    startY: y, head: [["Stage", "Status", "Completed"]],
    body: u.stages.map((s) => [s.name, s.done ? "Done" : "Pending", s.done && s.doneAt ? day(s.doneAt) : ""]),
    styles: { fontSize: 9, cellPadding: 2.2 }, headStyles: { fillColor: [11, 42, 74], textColor: 255 },
    columnStyles: { 1: { cellWidth: 28 }, 2: { cellWidth: 34 } },
    didParseCell: (d: any) => { if (d.section === "body" && d.column.index === 1) d.cell.styles.textColor = d.cell.raw === "Done" ? [22, 163, 74] : [140, 140, 140]; },
    margin: { left: 14, right: 14 },
  });
  y = lastTableEnd(doc, y + 40) + 8;

  // Snags
  const openSnags = (snags as any[]).filter((s) => OPEN(s.status));
  if ((snags as any[]).length) {
    room(30);
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(20);
    doc.text(openSnags.length ? `Snags being fixed before handover (${openSnags.length} open)` : "Snags: all fixed", 14, y);
    (doc as any).autoTable({
      startY: y + 3, head: [["Ref", "Snag", "Where", "Status"]],
      body: (snags as any[]).slice(0, 30).map((s) => [s.code || "", s.title || s.desc || "", s.location || s.area || "", OPEN(s.status) ? String(s.status).replace(/_/g, " ") : "Fixed"]),
      styles: { fontSize: 8.5, cellPadding: 2 }, headStyles: { fillColor: [11, 42, 74], textColor: 255 },
      columnStyles: { 0: { cellWidth: 20 }, 3: { cellWidth: 26 } }, margin: { left: 14, right: 14 },
    });
    y = lastTableEnd(doc, y + 30) + 8;
  }

  // Payments
  if (u.priceKES || myInvoices.length) {
    room(30);
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(20); doc.text("Payments", 14, y); y += 6;
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(60);
    if (u.priceKES) { doc.text(`Price ${kes(u.priceKES)}   ·   Paid ${kes(u.paidKES || 0)}   ·   Balance ${kes(Math.max(0, u.priceKES - (u.paidKES || 0)))}`, 14, y); y += 4; }
    if (myInvoices.length) {
      (doc as any).autoTable({
        startY: y + 2, head: [["Payment request", "Due", "Amount", "Paid", "Status"]],
        body: myInvoices.map((i) => [i.invoiceNumber, day(i.dueDate), kes(i.amount), kes(i.paidAmount || 0), i.status]),
        styles: { fontSize: 8.5, cellPadding: 2 }, headStyles: { fillColor: [11, 42, 74], textColor: 255 }, margin: { left: 14, right: 14 },
      });
      y = lastTableEnd(doc, y + 20) + 8;
    } else y += 6;
  }

  // Latest updates
  if (mine.length) {
    room(24);
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(20); doc.text("Latest updates", 14, y); y += 6;
    for (const x of mine) {
      const body = doc.splitTextToSize(`${x.title}${x.body ? ` - ${x.body}` : ""}`, W - 50);
      room(5 + body.length * 4.2);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(140);
      doc.text(`${day(x.createdAt)}${x.unitId ? "  ·  your unit" : "  ·  whole project"}`, 14, y);
      doc.setFontSize(9.5); doc.setTextColor(40); doc.text(body.slice(0, 4), 46, y);
      y += Math.min(4, body.length) * 4.2 + 2.5;
    }
    y += 4;
  }

  // Photos: three across
  const urls = mine.flatMap((x) => x.media.filter((m) => m.type === "image").map((m) => m.url)).slice(0, 6);
  if (urls.length) {
    const pics = (await Promise.all(urls.map((p) => photo(p)))).filter(Boolean) as { data: string; w: number; h: number }[];
    if (pics.length) {
      room(60);
      doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(20); doc.text("Recent photos", 14, y); y += 4;
      const gap = 4, cw = (W - 28 - gap * 2) / 3, ch = cw * 0.75;
      pics.forEach((p, i) => {
        if (i % 3 === 0 && i) y += ch + gap;
        if (i % 3 === 0) room(ch + 4);
        const x = 14 + (i % 3) * (cw + gap);
        // Fit inside the cell, centred, keeping the photo's shape.
        const k = Math.min(cw / p.w, ch / p.h), w = p.w * k, h = p.h * k;
        doc.setFillColor(245, 246, 248); doc.rect(x, y, cw, ch, "F");
        try { doc.addImage(p.data, "JPEG", x + (cw - w) / 2, y + (ch - h) / 2, w, h); } catch { /* skip */ }
      });
      y += ch + 8;
    }
  }

  // Footer on every page: the buyer's private link.
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(140);
    doc.text(u.link ? `Follow unit ${u.code} live: ${u.link}` : `Unit ${u.code} · ${projectName}`, 14, H - 8);
    doc.text(`Page ${i} of ${pages}`, W - 14, H - 8, { align: "right" });
  }
  const fileName = `Unit ${u.code} progress ${new Date().toISOString().slice(0, 10)}.pdf`.replace(/[\\/:*?"<>|]/g, "-");
  return { blob: doc.output("blob"), fileName };
}
