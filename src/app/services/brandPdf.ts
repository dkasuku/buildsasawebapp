// Shared letterhead for documents a client receives (quotes, invoices): the
// company's logo, name and contact details on the left, the document title and
// reference lines on the right. Returns the y position to continue from.

import type { jsPDF } from "./pdf";
import api, { type CompanyPublic } from "./api";

// One fetch per page load; the logo rarely changes mid-session.
let logoPromise: Promise<string | null> | null = null;
export function companyLogoData(): Promise<string | null> {
  if (!logoPromise) logoPromise = api.getCompanyLogoData().then((r) => r.dataUrl).catch(() => null);
  return logoPromise;
}
/** Call after the logo is changed in Settings. */
export function forgetCompanyLogo() { logoPromise = null; }

export function drawLetterhead(
  doc: jsPDF,
  company: CompanyPublic | null | undefined,
  logo: string | null,
  title: string,
  meta: string[],
): number {
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(255, 107, 26);
  doc.rect(0, 0, W, 4, "F");
  let x = 14;
  if (logo) {
    try {
      const props = doc.getImageProperties(logo);
      const h = 18;
      const w = Math.min(45, (props.width / props.height) * h);
      doc.addImage(logo, props.fileType || "PNG", 14, 10, w, h, undefined, "FAST");
      x = 14 + w + 5;
    } catch { /* unreadable image: fall back to the name alone */ }
  }
  doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(20);
  doc.text(company?.name || "", x, 17);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(100);
  const contact = [company?.address, [company?.phone, company?.email].filter(Boolean).join("  ·  "), company?.kraPin ? `KRA PIN: ${company.kraPin}` : ""].filter(Boolean) as string[];
  let cy = 22;
  contact.forEach((line) => { doc.splitTextToSize(line, 95).forEach((l: string) => { doc.text(l, x, cy); cy += 4; }); });

  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(255, 107, 26);
  doc.text(title, W - 14, 17, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(90);
  meta.forEach((m, i) => doc.text(m, W - 14, 23 + i * 5, { align: "right" }));
  return Math.max(cy, 23 + meta.length * 5, logo ? 30 : 0) + 6;
}
