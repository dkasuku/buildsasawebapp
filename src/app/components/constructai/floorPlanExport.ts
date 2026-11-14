// Floor plan deliverables. A plan handed to a client or an architect is a proper
// drawing, not a screenshot:
//  - PDF (A3 landscape, to a standard scale): the drawing with overall dimensions,
//    north arrow and scale bar; a title block (company, project, drawing title,
//    number, date, revision, scale); a room schedule with areas; a door and
//    window schedule; notes with the "concept, not for construction" disclaimer
//    and any building-rule problems still open.
//  - PNG: the same drawing as an image, for WhatsApp.
//  - DXF: walls, doors, windows, furniture and labels in millimetres on layers,
//    for AutoCAD and other CAD software.
//  - SVG: the vector drawing.
import { jsPDF } from "jspdf";

export type PlanItem = { kind: string; name: string; x: number; y: number; w: number; h: number; rot?: number };
export type PlanData = { name: string; units: "cm"; items: PlanItem[] };
export type ExportDrawing = { svg: string; widthCm: number; heightCm: number; buildingW: number; buildingH: number };
export type ExportInfo = { company?: string; project?: string; client?: string; issues?: string[] };

const OUTSIDE = /veranda|porch|terrace|balcony|parking|garage|carport/i;
const DISCLAIMER = "Concept layout for discussion only. Not for construction or building approvals: have it checked and detailed by a registered architect and structural engineer.";
const safe = (s: string) => (s || "Floor plan").replace(/[\\/:*?"<>|\n]/g, "-").slice(0, 80).trim();
const m = (cm: number) => (cm / 100).toFixed(2);
const today = () => new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

function save(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/** The drawing as a PNG data URL, `pxWide` pixels across. */
export function drawingPng(d: ExportDrawing, pxWide: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = Math.round(pxWide), h = Math.round((pxWide * d.heightCm) / d.widthCm);
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const g = c.getContext("2d")!; g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("Couldn't draw the plan image."));
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(d.svg);
  });
}

export function rooms(plan: PlanData) {
  const rs = plan.items.filter((i) => i.kind === "room");
  const indoor = rs.filter((r) => !OUTSIDE.test(r.name)), outside = rs.filter((r) => OUTSIDE.test(r.name));
  const sum = (a: PlanItem[]) => a.reduce((t, r) => t + r.w * r.h, 0) / 1e4;
  return { indoor, outside, indoorM2: sum(indoor), outsideM2: sum(outside) };
}

function openingSchedule(plan: PlanData) {
  const group = (pick: (i: PlanItem) => boolean) => {
    const by = new Map<number, number>();
    plan.items.filter(pick).forEach((i) => { const w = Math.max(i.w, i.h); by.set(w, (by.get(w) || 0) + 1); });
    return [...by.entries()].sort((a, b) => b[0] - a[0]);
  };
  const isOpening = (i: PlanItem) => i.kind === "door" && /opening/i.test(i.name);
  return { doors: group((i) => i.kind === "door" && !isOpening(i)), openings: group(isOpening), windows: group((i) => i.kind === "window") };
}

// ---------------------------------------------------------------- PDF (A3 or A4)
export async function exportPdf(d: ExportDrawing, plan: PlanData, info: ExportInfo, paper: "a3" | "a4" = "a3") {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: paper });
  // Everything is laid out for A3 and scaled for A4: k for sizes and spacing, f for text (kept a bit larger to stay readable).
  const k = paper === "a4" ? 297 / 420 : 1, f = paper === "a4" ? 0.86 : 1;
  const _fs = doc.setFontSize.bind(doc); (doc as any).setFontSize = (n: number) => _fs(n * f);
  const W = paper === "a4" ? 297 : 420, H = paper === "a4" ? 210 : 297, M = 10 * k, panelW = 112 * k, panelX = W - M - panelW;
  // Frame.
  doc.setDrawColor(24, 38, 58); doc.setLineWidth(0.6); doc.rect(M, M, W - 2 * M, H - 2 * M);
  doc.line(panelX, M, panelX, H - M);
  // Drawing area and a standard scale that fits it.
  const areaX = M + 8 * k, areaY = M + 14 * k, areaW = panelX - areaX - 8 * k, areaH = H - M - 26 * k - areaY;
  const scale = [50, 100, 150, 200, 250, 300, 500].find((s) => (d.widthCm * 10) / s <= areaW && (d.heightCm * 10) / s <= areaH) || 500;
  const imgW = (d.widthCm * 10) / scale, imgH = (d.heightCm * 10) / scale;
  const png = await drawingPng(d, Math.min(4200, Math.max(1600, imgW * 9)));
  const ix = areaX + (areaW - imgW) / 2, iy = areaY + (areaH - imgH) / 2;
  doc.addImage(png, "PNG", ix, iy, imgW, imgH, undefined, "FAST");
  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(24, 38, 58);
  doc.text((plan.name || "Floor plan").toUpperCase(), areaX, M + 9 * k);
  // North arrow (top right of the drawing area).
  const nx = panelX - 18 * k, ny = M + 18 * k;
  doc.setFillColor(24, 38, 58); doc.triangle(nx, ny - 7 * k, nx - 4 * k, ny + 5 * k, nx + 4 * k, ny + 5 * k, "F");
  doc.setFontSize(9); doc.text("N", nx, ny - 9 * k, { align: "center" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); doc.text("(assumed)", nx, ny + 9 * k, { align: "center" });
  // Scale bar: 0-5 m.
  const sb = (500 * 10) / scale, sx = areaX, sy = H - M - 12 * k;
  for (let i = 0; i < 5; i++) { doc.setFillColor(i % 2 ? 255 : 24, i % 2 ? 255 : 38, i % 2 ? 255 : 58); doc.rect(sx + (i * sb) / 5, sy, sb / 5, 2.2 * k, "FD"); }
  doc.setFontSize(7.5); doc.setTextColor(24, 38, 58);
  [0, 1, 2, 3, 4, 5].forEach((v) => doc.text(`${v}`, sx + (v * sb) / 5, sy + 6 * k, { align: "center" }));
  doc.text("metres", sx + sb + 4 * k, sy + 2.2 * k);
  doc.text(`Scale 1:${scale} at ${paper.toUpperCase()}`, sx + sb + 18 * k, sy + 2.2 * k);

  // ---- Right panel: room schedule, opening schedule, notes, title block.
  let y = M + 8 * k;
  const px = panelX + 5 * k, pw = panelW - 10 * k;
  const head = (t: string) => { doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(24, 38, 58); doc.text(t, px, y); y += 1.5 * k; doc.setLineWidth(0.3); doc.line(px, y, px + pw, y); y += 4.2 * k; };
  const row = (a: string, b: string, c: string, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(7.5); doc.setTextColor(40, 50, 65);
    doc.text(doc.splitTextToSize(a, 52 * k)[0], px, y); doc.text(b, px + 62 * k, y, { align: "right" }); doc.text(c, px + pw, y, { align: "right" }); y += 4 * k;
  };
  const rs = rooms(plan);
  head("ROOM SCHEDULE");
  row("Room", "Size (m)", "Area (m²)", true);
  rs.indoor.forEach((r) => row(r.name, `${m(r.w)} × ${m(r.h)}`, (r.w * r.h / 1e4).toFixed(1)));
  row("Total indoor", "", rs.indoorM2.toFixed(1), true);
  if (rs.outside.length) {
    rs.outside.forEach((r) => row(r.name, `${m(r.w)} × ${m(r.h)}`, (r.w * r.h / 1e4).toFixed(1)));
    row("Veranda / parking", "", rs.outsideM2.toFixed(1), true);
  }
  row(`Building ${m(d.buildingW)} × ${m(d.buildingH)} m overall`, "", "", false);
  y += 2 * k;
  const os = openingSchedule(plan);
  head("DOORS AND WINDOWS");
  os.doors.forEach(([w, n], i) => row(`D${i + 1}  Door ${w} cm wide`, "", `× ${n}`));
  os.openings.forEach(([w, n], i) => row(`O${i + 1}  Wide opening ${w} cm`, "", `× ${n}`));
  os.windows.forEach(([w, n], i) => row(`W${i + 1}  Window ${w} cm wide`, "", `× ${n}`));
  y += 2 * k;
  head("NOTES");
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.2); doc.setTextColor(40, 50, 65);
  const notes = [
    "1. All dimensions are in metres and are room sizes between wall centres. Check all dimensions on site.",
    `2. ${DISCLAIMER}`,
    "3. Room sizes, light and ventilation follow common Kenyan practice (windows at least 1/10 of floor area).",
    ...(info.issues && info.issues.length ? [`4. Open points to resolve: ${info.issues.slice(0, 5).join(" ")}`] : []),
  ];
  for (const n of notes) { const lines = doc.splitTextToSize(n, pw); if (y + lines.length * 3.3 * k > H - M - 58 * k) break; doc.text(lines, px, y); y += lines.length * 3.3 * k + 1.2; }

  // Title block (bottom of the panel).
  const tb = H - M - 54 * k;
  doc.setLineWidth(0.6); doc.line(panelX, tb, W - M, tb);
  const cell = (label: string, value: string, yy: number, big = false) => {
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); doc.setTextColor(110, 120, 135); doc.text(label.toUpperCase(), px, yy);
    doc.setFont("helvetica", "bold"); doc.setFontSize(big ? 12 : 8.5); doc.setTextColor(24, 38, 58);
    doc.text(doc.splitTextToSize(value || "-", pw)[0], px, yy + (big ? 5.2 * k : 4 * k));
  };
  cell("Prepared by", info.company || "Buildsasa", tb + 5 * k, true);
  cell("Project", info.project || plan.name, tb + 16 * k);
  cell("Client", info.client || "", tb + 24 * k);
  cell("Drawing", /ground floor/i.test(plan.name) ? "Ground floor plan" : "Floor plan", tb + 32 * k);
  const no = `BS-FP-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}`;
  doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); doc.setTextColor(110, 120, 135);
  ["Drawing no.", "Date", "Rev", "Scale"].forEach((l, i) => doc.text(l.toUpperCase(), px + i * 27 * k, tb + 41 * k));
  doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(24, 38, 58);
  [no, today(), "A", `1:${scale}`].forEach((v, i) => doc.text(v, px + i * 27 * k, tb + 45 * k));
  doc.setFont("helvetica", "italic"); doc.setFontSize(6.2); doc.setTextColor(110, 120, 135);
  doc.text("Drawn with Buildsasa · buildsasa.com", px, H - M - 2.5 * k);
  doc.save(`${safe(plan.name)} (${paper.toUpperCase()}).pdf`);
}

// ---------------------------------------------------------------- PNG / SVG
export async function exportPng(d: ExportDrawing, plan: PlanData) {
  const url = await drawingPng(d, 2400);
  const blob = await (await fetch(url)).blob();
  save(blob, `${safe(plan.name)}.png`);
}
export function exportSvg(d: ExportDrawing, plan: PlanData) {
  save(new Blob([d.svg], { type: "image/svg+xml" }), `${safe(plan.name)}.svg`);
}

// ---------------------------------------------------------------- DXF (R12, millimetres)
export function exportDxf(plan: PlanData) {
  const out: string[] = [];
  const p = (...a: (string | number)[]) => out.push(...a.map(String));
  const X = (cm: number) => (cm * 10).toFixed(1), Y = (cm: number) => (-cm * 10).toFixed(1); // DXF y points up
  const line = (layer: string, x1: number, y1: number, x2: number, y2: number) => p(0, "LINE", 8, layer, 10, X(x1), 20, Y(y1), 30, 0, 11, X(x2), 21, Y(y2), 31, 0);
  const box = (layer: string, i: PlanItem) => { line(layer, i.x, i.y, i.x + i.w, i.y); line(layer, i.x + i.w, i.y, i.x + i.w, i.y + i.h); line(layer, i.x + i.w, i.y + i.h, i.x, i.y + i.h); line(layer, i.x, i.y + i.h, i.x, i.y); };
  const text = (layer: string, x: number, y: number, h: number, s: string) => p(0, "TEXT", 8, layer, 10, X(x), 20, Y(y), 30, 0, 40, (h * 10).toFixed(1), 1, s.replace(/[^\x20-\x7E]/g, (c) => (c === "²" ? "2" : c === "×" ? "x" : "")), 72, 1, 11, X(x), 21, Y(y), 31, 0);
  p(0, "SECTION", 2, "HEADER", 9, "$ACADVER", 1, "AC1009", 9, "$INSUNITS", 70, 4, 0, "ENDSEC");
  p(0, "SECTION", 2, "TABLES", 0, "TABLE", 2, "LAYER", 70, 5);
  [["WALLS", 7], ["DOORS", 3], ["WINDOWS", 5], ["FURNITURE", 8], ["TEXT", 7]].forEach(([n, c]) => p(0, "LAYER", 2, n, 70, 0, 62, c, 6, "CONTINUOUS"));
  p(0, "ENDTAB", 0, "ENDSEC", 0, "SECTION", 2, "ENTITIES");
  for (const i of plan.items) {
    if (i.kind === "room") {
      box("WALLS", i);
      text("TEXT", i.x + i.w / 2, i.y + i.h / 2, 18, i.name);
      text("TEXT", i.x + i.w / 2, i.y + i.h / 2 + 26, 11, `${m(i.w)} x ${m(i.h)} m  ${(i.w * i.h / 1e4).toFixed(1)} m2`);
    } else if (i.kind === "door") {
      // The opening and the door leaf (a line across the box at the hinge side).
      box("DOORS", i);
    } else if (i.kind === "window") {
      box("WINDOWS", i);
      if (i.w >= i.h) line("WINDOWS", i.x, i.y + i.h / 2, i.x + i.w, i.y + i.h / 2); else line("WINDOWS", i.x + i.w / 2, i.y, i.x + i.w / 2, i.y + i.h);
    } else if (i.kind === "wall") {
      box("WALLS", i);
    } else {
      box("FURNITURE", i);
    }
  }
  p(0, "ENDSEC", 0, "EOF");
  save(new Blob([out.join("\r\n")], { type: "application/dxf" }), `${safe(plan.name)}.dxf`);
}
