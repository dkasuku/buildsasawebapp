// A unit's progress report as a PDF, made on the server so automatic
// weekly/monthly emails can carry it as an attachment and WhatsApp messages can
// link to it. Same content as the one made in the browser: letterhead, progress,
// stages, snags, payments, latest updates and recent photos.
const PDFDocument = require('pdfkit');

const kes = (n) => `KES ${Math.round(Number(n) || 0).toLocaleString('en-KE')}`;
const day = (d) => { if (!d) return ''; const t = new Date(d); return isNaN(+t) ? String(d) : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
const parse = (v) => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
const OPEN = (s) => !['resolved', 'closed', 'rejected'].includes(s);
const ORANGE = '#F45B1E', NAVY = '#0B2A4A', INK = '#1B1F24', SOFT = '#5B6675', LINE = '#E6E9EE';

/** readFile(url) -> { buf, type } for our own uploads only (never arbitrary URLs). */
module.exports = async function unitPdf({ prismaBase, readFile, link, p, u }) {
  const [ws, updates, invoices, snags] = await Promise.all([
    prismaBase.workspace.findUnique({ where: { id: p.workspaceId } }),
    prismaBase.clientUpdate.findMany({ where: { projectId: p.id, OR: [{ unitId: u.id }, { unitId: null }] }, orderBy: { createdAt: 'desc' }, take: 6 }),
    prismaBase.invoice.findMany({ where: { projectId: p.id, unitId: u.id, status: { not: 'draft' } }, orderBy: { createdAt: 'desc' } }),
    prismaBase.punchItem.findMany({ where: { unitId: u.id, isPrivate: { not: true } }, orderBy: { createdAt: 'desc' }, take: 30 }),
  ]);
  const image = async (url, max = 4 * 1024 * 1024) => {
    try { const f = await readFile(url, max); return /^image\/(png|jpe?g)$/.test(f.type) ? f.buf : null; } catch { return null; }
  };
  const logo = ws?.logoUrl ? await image(ws.logoUrl, 2 * 1024 * 1024) : null;
  const photoUrls = updates.flatMap((x) => parse(x.media).filter((m) => m && m.type !== 'video' && m.type !== 'file').map((m) => m.url)).slice(0, 9);
  const photos = (await Promise.all(photoUrls.map((x) => image(x)))).filter(Boolean).slice(0, 6);
  const stages = parse(u.stages);

  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: `Unit ${u.code} progress report` } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((r) => doc.on('end', () => r(Buffer.concat(chunks))));
  const W = doc.page.width, L = 40, R = W - 40;
  const room = (h) => { if (doc.y + h > doc.page.height - 50) doc.addPage(); };
  const heading = (t) => { room(40); doc.moveDown(0.8); doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text(t, L); doc.moveDown(0.3); };
  /** A simple table: header in navy, light zebra rows. */
  const table = (cols, rows) => {
    const widths = cols.map((c) => c.w * (R - L));
    const row = (cells, head, i) => {
      const h = Math.max(18, ...cells.map((c, k) => doc.font(head ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).heightOfString(String(c ?? ''), { width: widths[k] - 10 }) + 8));
      room(h);
      const y = doc.y;
      if (head) doc.rect(L, y, R - L, h).fill(NAVY); else if (i % 2 === 0) doc.rect(L, y, R - L, h).fill('#F6F7F9');
      let x = L;
      cells.forEach((c, k) => {
        doc.font(head ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(head ? '#FFFFFF' : (cols[k].color ? cols[k].color(c) : INK))
          .text(String(c ?? ''), x + 5, y + 4, { width: widths[k] - 10 });
        x += widths[k];
      });
      doc.y = y + h; doc.x = L;
    };
    row(cols.map((c) => c.label), true, 0);
    rows.forEach((r, i) => row(r, false, i));
  };

  // Letterhead
  doc.rect(0, 0, W, 6).fill(ORANGE);
  let top = 26;
  if (logo) { try { doc.image(logo, L, top, { fit: [110, 42] }); } catch { /* bad image */ } }
  doc.font('Helvetica-Bold').fontSize(15).fillColor(INK).text(ws?.name || 'Your developer', logo ? L + 120 : L, top + 6, { width: 230 });
  doc.font('Helvetica-Bold').fontSize(13).fillColor(ORANGE).text('UNIT PROGRESS REPORT', W / 2, top, { width: R - W / 2, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor(SOFT).text(`Unit: ${u.code}\nDate: ${day(new Date())}`, W / 2, top + 18, { width: R - W / 2, align: 'right' });
  doc.y = top + 62;

  // Who and what
  const y0 = doc.y;
  doc.font('Helvetica').fontSize(8).fillColor('#8A95A5').text('PREPARED FOR', L, y0).text('PROJECT', W / 2, y0);
  doc.font('Helvetica').fontSize(11).fillColor(INK).text(u.clientName || 'The owner of this unit', L, y0 + 11, { width: W / 2 - L - 10 });
  doc.text(p.name, W / 2, y0 + 11, { width: R - W / 2 });
  doc.fontSize(9).fillColor(SOFT).text([u.block ? `Block ${u.block}` : '', u.floor ? `Floor ${u.floor}` : '', u.type || ''].filter(Boolean).join(' · ') || ' ', W / 2, y0 + 26, { width: R - W / 2 });
  doc.y = y0 + 48;

  // Progress
  const py = doc.y;
  doc.font('Helvetica-Bold').fontSize(24).fillColor(u.progress >= 100 ? '#16A34A' : ORANGE).text(`${u.progress}%`, L, py, { width: 80 });
  const label = { not_started: 'Not started', in_progress: 'In progress', snagging: 'Snagging', ready: 'Ready for handover', handed_over: 'Handed over' }[u.status] || u.status;
  doc.font('Helvetica').fontSize(10).fillColor(SOFT).text(label, L + 90, py + 2);
  doc.roundedRect(L + 90, py + 18, R - L - 90, 6, 3).fill('#EBEDF0');
  if (u.progress) doc.roundedRect(L + 90, py + 18, (R - L - 90) * (u.progress / 100), 6, 3).fill(ORANGE);
  doc.y = py + 40; doc.x = L;

  if (stages.length) table([{ label: 'Stage', w: 0.58 }, { label: 'Status', w: 0.18, color: (c) => (c === 'Done' ? '#16A34A' : '#8A95A5') }, { label: 'Completed', w: 0.24 }],
    stages.map((s) => [s.name, s.done ? 'Done' : 'Pending', s.done && s.doneAt ? day(s.doneAt) : '']));

  if (snags.length) {
    const open = snags.filter((s) => OPEN(s.status)).length;
    heading(open ? `Snags being fixed before handover (${open} open)` : 'Snags: all fixed');
    table([{ label: 'Ref', w: 0.14 }, { label: 'Snag', w: 0.46 }, { label: 'Where', w: 0.22 }, { label: 'Status', w: 0.18 }],
      snags.map((s) => [s.code || '', s.title || s.desc || '', s.location || s.area || '', OPEN(s.status) ? String(s.status).replace(/_/g, ' ') : 'Fixed']));
  }

  if (u.priceKES || invoices.length) {
    heading('Payments');
    if (u.priceKES) { doc.font('Helvetica').fontSize(10).fillColor(SOFT).text(`Price ${kes(u.priceKES)}   ·   Paid ${kes(u.paidKES || 0)}   ·   Balance ${kes(Math.max(0, u.priceKES - (u.paidKES || 0)))}`, L); doc.moveDown(0.5); }
    if (invoices.length) table([{ label: 'Payment request', w: 0.26 }, { label: 'Due', w: 0.2 }, { label: 'Amount', w: 0.2 }, { label: 'Paid', w: 0.2 }, { label: 'Status', w: 0.14 }],
      invoices.map((i) => [i.invoiceNumber, day(i.dueDate), kes(i.amount), kes(i.paidAmount || 0), i.status]));
  }

  if (updates.length) {
    heading('Latest updates');
    for (const x of updates) {
      room(30);
      const y = doc.y;
      doc.font('Helvetica').fontSize(8).fillColor('#8A95A5').text(`${day(x.createdAt)}\n${x.unitId ? 'your unit' : 'whole project'}`, L, y, { width: 80 });
      doc.font('Helvetica').fontSize(10).fillColor(INK).text(`${x.title}${x.body ? ` - ${x.body}` : ''}`.slice(0, 400), L + 90, y, { width: R - L - 90 });
      doc.y = Math.max(doc.y, y + 22) + 4; doc.x = L;
    }
  }

  if (photos.length) {
    heading('Recent photos');
    const gap = 8, cw = (R - L - gap * 2) / 3, ch = cw * 0.75;
    for (let i = 0; i < photos.length; i++) {
      if (i % 3 === 0) { if (i) doc.y += ch + gap; room(ch + 4); }
      const x = L + (i % 3) * (cw + gap), y = doc.y;
      doc.rect(x, y, cw, ch).fill('#F5F6F8');
      try { doc.image(photos[i], x, y, { fit: [cw, ch], align: 'center', valign: 'center' }); } catch { /* unreadable */ }
    }
    doc.y += ch + gap;
  }

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;  // the footer sits in the margin; don't let it start a new page
    doc.font('Helvetica').fontSize(7.5).fillColor('#8A95A5');
    doc.text(link ? `Follow unit ${u.code} live: ${link}` : `Unit ${u.code} · ${p.name}`, L, doc.page.height - 30, { width: R - L - 70, lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, R - 70, doc.page.height - 30, { width: 70, align: 'right', lineBreak: false });
  }
  doc.end();
  return done;
};
