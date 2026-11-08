// Units: apartment blocks, estates and any project with many houses or flats,
// each sold to (or built for) a different client. Every unit has its own
// fit-out stages, its own progress, its own buyer and its own private link, so
// each buyer follows their unit, gets reports about it, and never sees what
// belongs to the other buyers. News about the whole building (the roof, the
// lifts, the compound) is posted once and reaches everyone.
//
// Mounted from client-routes.js, which passes its helpers in.

const APARTMENT_STAGES = ['Blockwork & partitions', 'Electrical first fix', 'Plumbing first fix', 'Plaster & screed', 'Ceiling', 'Tiling', 'Doors & windows', 'Kitchen & wardrobes', 'Painting', 'Fittings & fixtures', 'Snagging & cleaning', 'Handover'];
const HOUSE_STAGES = ['Foundation', 'Walling', 'Roofing', 'Plumbing & electrical', 'Plaster', 'Floors & tiling', 'Doors & windows', 'Kitchen & wardrobes', 'Painting', 'External works', 'Snagging', 'Handover'];
const UNIT_STATUS = ['not_started', 'in_progress', 'snagging', 'ready', 'handed_over'];
const STATUS_LABEL = { not_started: 'Not started', in_progress: 'In progress', snagging: 'Snagging', ready: 'Ready for handover', handed_over: 'Handed over' };
const OPEN_SNAG = { notIn: ['resolved', 'closed', 'rejected'] };
const isHouse = (type) => /house|villa|bungalow|maisonette|town ?house|mansion|cottage/i.test(type || '');
const templateFor = (type) => (isHouse(type) ? HOUSE_STAGES : APARTMENT_STAGES).map((name) => ({ name, done: false }));

module.exports = function unitRoutes(app, h) {
  const { prisma, prismaBase, auth, hasRole, CAN_SHARE_PORTAL, APP_URL, companyPublic, text, parse, cleanMedia, updateDto, notify, p14, button, ownProject, kes, STAGES, UPDATE_KINDS } = h;
  const crypto = require('crypto');

  const cleanStages = (v) => (Array.isArray(v) ? v : parse(v))
    .filter((s) => s && text(s.name, 80))
    .slice(0, 40)
    .map((s) => ({ name: text(s.name, 80), done: !!s.done, ...(s.done ? { doneAt: s.doneAt || new Date().toISOString() } : {}) }));
  const pct = (stages) => (stages.length ? Math.round((stages.filter((s) => s.done).length / stages.length) * 100) : 0);
  /** Status follows the stages unless someone set snagging or handed over. */
  const autoStatus = (current, progress, explicit) => {
    if (explicit && UNIT_STATUS.includes(explicit)) return explicit;
    if (current === 'handed_over') return current;
    if (progress >= 100) return current === 'snagging' ? 'snagging' : 'ready';
    if (progress > 0) return current === 'snagging' ? 'snagging' : 'in_progress';
    return 'not_started';
  };
  const unitLink = (u) => (u.shareToken ? `${APP_URL}/?unit=${u.shareToken}` : null);
  const dto = (u, extra = {}) => ({ ...u, stages: parse(u.stages), link: unitLink(u), statusLabel: STATUS_LABEL[u.status] || u.status, ...extra });
  const email = (v) => { const s = String(v || '').trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null; };
  const num = (v) => { const n = Number(String(v ?? '').replace(/[, ]/g, '')); return Number.isFinite(n) && String(v ?? '').trim() !== '' ? n : null; };

  async function ownUnit(projectId, id) {
    const p = await ownProject(projectId);
    if (!p) return {};
    const u = await prisma.projectUnit.findUnique({ where: { id } });
    return u && u.projectId === p.id ? { p, u } : { p };
  }
  /** Everyone who should hear about one unit: its buyer's email and any client account linked to it. */
  async function unitRecipients(u) {
    const links = await prismaBase.projectClient.findMany({ where: { projectId: u.projectId, unitId: u.id }, select: { email: true } });
    return [...new Set([u.clientEmail, ...links.map((l) => l.email)].filter(Boolean).map((e) => e.toLowerCase()))];
  }
  async function ensureToken(u) {
    if (u.shareToken) return u;
    return prisma.projectUnit.update({ where: { id: u.id }, data: { shareToken: crypto.randomBytes(12).toString('base64url') } });
  }
  const openSnags = (u) => prismaBase.punchItem.count({ where: { unitId: u.id, status: OPEN_SNAG } });
  /** A short progress report for one unit, as WhatsApp text and as an email. */
  async function reportFor(p, u, pdfUrl) {
    const snags = await openSnags(u);
    const stages = parse(u.stages);
    const done = stages.filter((s) => s.done).map((s) => s.name);
    const next = stages.filter((s) => !s.done).slice(0, 2).map((s) => s.name);
    const latest = await prismaBase.clientUpdate.findFirst({ where: { projectId: p.id, OR: [{ unitId: u.id }, { unitId: null }] }, orderBy: { createdAt: 'desc' } });
    const company = await prismaBase.workspace.findUnique({ where: { id: p.workspaceId } });
    const link = unitLink(u);
    const lines = [
      `Hi${u.clientName ? ` ${u.clientName.split(' ')[0]}` : ''}, here's the latest on your unit ${u.code} at ${p.name}.`,
      `Progress: ${u.progress}% (${STATUS_LABEL[u.status] || u.status}).`,
      done.length ? `Done: ${done.slice(-4).join(', ')}.` : null,
      next.length ? `Next: ${next.join(', ')}.` : null,
      latest ? `Latest news: ${latest.title}.` : null,
      snags ? `Snags being fixed before handover: ${snags}.` : null,
      pdfUrl ? `PDF report: ${pdfUrl}` : null,
      link ? `See photos and every update here: ${link}` : null,
      company ? `- ${company.name}` : null,
    ].filter(Boolean);
    const html = p14(lines.slice(0, -2).filter((l) => !l.startsWith('See photos') && !l.startsWith('PDF report')).join('<br/>'))
      + `<div style="margin:14px 0;height:10px;border-radius:6px;background:#EEE"><div style="height:10px;width:${u.progress}%;border-radius:6px;background:#FF6B1A"></div></div>`
      + (link ? button(link, `Open unit ${u.code}`) : '')
      + (pdfUrl ? `<p style="font-size:13px"><a href="${pdfUrl}">Download the PDF report</a></p>` : '');
    return { text: lines.join('\n'), html, link };
  }

  // ── Team side ──
  app.get('/api/projects/:projectId/units', auth, async (req, res) => {
    try {
      const p = await ownProject(req.params.projectId);
      if (!p) return res.status(404).json({ error: 'Project not found' });
      const [units, links, counts] = await Promise.all([
        prisma.projectUnit.findMany({ where: { projectId: p.id }, orderBy: [{ block: 'asc' }, { code: 'asc' }] }),
        prismaBase.projectClient.findMany({ where: { projectId: p.id, unitId: { not: null } }, select: { unitId: true, email: true, userId: true } }),
        prismaBase.clientUpdate.groupBy({ by: ['unitId'], where: { projectId: p.id, unitId: { not: null } }, _count: { _all: true } }).catch(() => []),
      ]);
      const snagRows = await prismaBase.punchItem.groupBy({ by: ['unitId'], where: { projectId: p.id, unitId: { not: null }, status: OPEN_SNAG }, _count: { _all: true } }).catch(() => []);
      const sn = Object.fromEntries(snagRows.map((c) => [c.unitId, c._count._all]));
      const n = Object.fromEntries(counts.map((c) => [c.unitId, c._count._all]));
      // Natural order: A-2 before A-10.
      units.sort((a, b) => String(a.block || '').localeCompare(String(b.block || ''), undefined, { numeric: true }) || a.code.localeCompare(b.code, undefined, { numeric: true }));
      res.json(units.map((u) => dto(u, { openSnags: sn[u.id] || 0, updates: n[u.id] || 0, accounts: links.filter((l) => l.unitId === u.id).map((l) => ({ email: l.email, joined: !!l.userId })) })));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Add one unit, a list, or generate a block: { generate: { block, floors, perFloor, groundFloor, type } }
  // makes A-G01…A-504; { generate: { count, prefix: "House ", type } } makes House 1…House 40.
  app.post('/api/projects/:projectId/units', auth, async (req, res) => {
    try {
      const p = await ownProject(req.params.projectId);
      if (!p) return res.status(404).json({ error: 'Project not found' });
      const b = req.body || {};
      let rows = [];
      if (b.generate) {
        const g = b.generate;
        const type = text(g.type, 60);
        if (g.count) {
          const count = Math.min(500, Math.max(1, parseInt(g.count, 10) || 0));
          const start = Math.max(1, parseInt(g.start, 10) || 1);
          const prefix = text(g.prefix, 30) ?? (isHouse(type) ? 'House ' : 'Unit ');
          for (let i = 0; i < count; i++) rows.push({ code: `${prefix}${start + i}`.trim(), block: text(g.block, 40), type });
        } else {
          const floors = Math.min(60, Math.max(1, parseInt(g.floors, 10) || 0));
          const per = Math.min(40, Math.max(1, parseInt(g.perFloor, 10) || 0));
          const block = text(g.block, 40);
          const ground = g.groundFloor !== false;
          // `floors` counts floors above ground; the ground floor is extra.
          for (let f = ground ? 0 : 1; f <= floors; f++) {
            for (let i = 1; i <= per; i++) {
              const code = `${block ? `${block}-` : ''}${f === 0 ? 'G' : f}${String(i).padStart(2, '0')}`;
              rows.push({ code, block, floor: f === 0 ? 'Ground' : String(f), type });
            }
          }
        }
      } else {
        const list = Array.isArray(b.units) ? b.units : [b];
        rows = list.slice(0, 500).map((x) => ({
          code: text(x.code, 40), block: text(x.block, 40), floor: text(x.floor, 20), type: text(x.type, 60), sizeSqm: num(x.sizeSqm),
          clientName: text(x.clientName, 120), clientEmail: email(x.clientEmail), clientPhone: text(x.clientPhone, 40), priceKES: num(x.priceKES), paidKES: num(x.paidKES), notes: text(x.notes, 2000),
        })).filter((x) => x.code);
      }
      if (!rows.length) return res.status(400).json({ error: 'Give the unit a number (e.g. A-12 or House 7), or say how many floors and units per floor.' });
      if (rows.length > 500) rows = rows.slice(0, 500);
      const existing = await prisma.projectUnit.count({ where: { projectId: p.id } });
      if (existing + rows.length > 2000) return res.status(400).json({ error: 'A project can hold up to 2,000 units.' });
      const taken = new Set((await prisma.projectUnit.findMany({ where: { projectId: p.id }, select: { code: true } })).map((u) => u.code.toLowerCase()));
      const fresh = rows.filter((r) => { const k = r.code.toLowerCase(); if (taken.has(k)) return false; taken.add(k); return true; });
      const stagesFrom = Array.isArray(b.stages) && b.stages.length ? cleanStages(b.stages.map((s) => (typeof s === 'string' ? { name: s } : s))) : null;
      for (const r of fresh) {
        const stages = stagesFrom ? stagesFrom.map((s) => ({ ...s, done: false })) : templateFor(r.type);
        await prisma.projectUnit.create({ data: { ...r, projectId: p.id, stages: JSON.stringify(stages) } });
      }
      res.json({ added: fresh.length, skipped: rows.length - fresh.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/projects/:projectId/units/:id', auth, async (req, res) => {
    try {
      const { u } = await ownUnit(req.params.projectId, req.params.id);
      if (!u) return res.status(404).json({ error: 'Unit not found' });
      const b = req.body || {};
      const data = {};
      for (const k of ['code', 'block', 'floor', 'type', 'clientName', 'clientPhone', 'notes']) if (b[k] !== undefined) data[k] = text(b[k], k === 'notes' ? 2000 : 120);
      if (data.code === null) delete data.code;
      if (b.clientEmail !== undefined) data.clientEmail = email(b.clientEmail);
      for (const k of ['sizeSqm', 'priceKES', 'paidKES']) if (b[k] !== undefined) data[k] = num(b[k]);
      let stages = parse(u.stages);
      if (Array.isArray(b.stages)) stages = cleanStages(b.stages);
      // Tick or untick stages by name: { done: ["Tiling"], undone: ["Painting"] }.
      const match = (n) => (s) => s.name.toLowerCase() === String(n).toLowerCase();
      for (const n of Array.isArray(b.done) ? b.done : []) { const s = stages.find(match(n)); if (s && !s.done) { s.done = true; s.doneAt = new Date().toISOString(); } }
      for (const n of Array.isArray(b.undone) ? b.undone : []) { const s = stages.find(match(n)); if (s) { s.done = false; delete s.doneAt; } }
      data.stages = JSON.stringify(stages);
      data.progress = b.progress !== undefined && !stages.length ? Math.min(100, Math.max(0, parseInt(b.progress, 10) || 0)) : pct(stages);
      data.status = autoStatus(u.status, data.progress, b.status);
      if (['ready', 'handed_over'].includes(data.status)) {
        const open = await openSnags(u);
        if (open && b.status && ['ready', 'handed_over'].includes(b.status)) return res.status(409).json({ error: `Unit ${u.code} still has ${open} open snag${open === 1 ? '' : 's'}. Close ${open === 1 ? 'it' : 'them'} before marking it ${b.status === 'ready' ? 'ready' : 'handed over'}.`, openSnags: open });
        if (open) data.status = 'snagging';
      }
      const row = await prisma.projectUnit.update({ where: { id: u.id }, data });
      res.json(dto(row, { openSnags: await openSnags(row) }));
    } catch (e) {
      if (e.code === 'P2002') return res.status(409).json({ error: 'Another unit already has that number.' });
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/projects/:projectId/units/:id', auth, async (req, res) => {
    try {
      const { u } = await ownUnit(req.params.projectId, req.params.id);
      if (!u) return res.status(404).json({ error: 'Unit not found' });
      if (!hasRole(req, CAN_SHARE_PORTAL)) return res.status(403).json({ error: 'Your role cannot remove units.' });
      // The buyer was only on this project for this unit.
      await prismaBase.projectClient.deleteMany({ where: { projectId: u.projectId, unitId: u.id } }).catch(() => {});
      await prisma.projectUnit.delete({ where: { id: u.id } });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // The unit's private link (no account needed). With { invite: true } the buyer
  // also gets a free client account invite, fenced to this unit.
  app.post('/api/projects/:projectId/units/:id/share', auth, async (req, res) => {
    try {
      if (!hasRole(req, CAN_SHARE_PORTAL)) return res.status(403).json({ error: 'Your role cannot share with clients.' });
      const found = await ownUnit(req.params.projectId, req.params.id);
      if (!found.u) return res.status(404).json({ error: 'Unit not found' });
      const p = found.p;
      const u = await ensureToken(found.u);
      let invited = null;
      if (req.body?.invite) {
        const to = email(req.body.email) || u.clientEmail;
        if (!to) return res.status(400).json({ error: `Add the buyer's email to unit ${u.code} first.` });
        const existing = await prismaBase.user.findUnique({ where: { email: to } });
        if (existing && existing.role !== 'Client') return res.status(409).json({ error: 'That email belongs to a company account, not a client. Ask the buyer for a personal email.' });
        // One email can own several units: the invite row is per project, so the last unit wins for that email.
        await prismaBase.projectClient.upsert({
          where: { projectId_email: { projectId: p.id, email: to } },
          create: { workspaceId: p.workspaceId, projectId: p.id, email: to, name: u.clientName, userId: existing ? existing.id : null, invitedBy: req.user.name || null, unitId: u.id },
          update: { unitId: u.id, name: u.clientName || undefined },
        });
        const company = await prismaBase.workspace.findUnique({ where: { id: p.workspaceId } });
        const link = `${APP_URL}/?as=client&email=${encodeURIComponent(to)}&project=${p.id}${existing ? '' : '&signup=1'}`;
        notify(to, `Follow your unit ${u.code} at ${p.name}`, p14(`Hi${u.clientName ? ` ${u.clientName.split(' ')[0]}` : ''}, <b>${company ? company.name : 'your developer'}</b> is sharing the progress of <b>unit ${u.code}</b> at <b>${p.name}</b> with you on Buildsasa: photos, stage-by-stage progress, invoices for your unit, and a private chat with the team.`) + button(link, existing ? 'Open Buildsasa' : 'Create your free client account'));
        invited = to;
      }
      res.json({ ...dto(u), invited });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Send the buyer a progress report now (email), and hand back WhatsApp text.
  app.post('/api/projects/:projectId/units/:id/report', auth, async (req, res) => {
    try {
      if (!hasRole(req, CAN_SHARE_PORTAL)) return res.status(403).json({ error: 'Your role cannot share with clients.' });
      const found = await ownUnit(req.params.projectId, req.params.id);
      if (!found.u) return res.status(404).json({ error: 'Unit not found' });
      const u = await ensureToken(found.u);
      const pdfUrl = /^https?:\/\/\S+$/i.test(String(req.body?.pdfUrl || '')) ? String(req.body.pdfUrl) : null;
      const r = await reportFor(found.p, u, pdfUrl);
      const to = await unitRecipients(u);
      if (req.body?.email !== false) for (const e of to) notify(e, `Progress on your unit ${u.code}: ${u.progress}%`, r.html);
      await prisma.projectUnit.update({ where: { id: u.id }, data: { lastReportAt: new Date() } });
      res.json({ text: r.text, link: r.link, emailed: req.body?.email === false ? [] : to, phone: u.clientPhone || null });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Every buyer with an email gets their own unit's report, in one go.
  app.post('/api/projects/:projectId/units/report-all', auth, async (req, res) => {
    try {
      if (!hasRole(req, CAN_SHARE_PORTAL)) return res.status(403).json({ error: 'Your role cannot share with clients.' });
      const p = await ownProject(req.params.projectId);
      if (!p) return res.status(404).json({ error: 'Project not found' });
      const units = await prisma.projectUnit.findMany({ where: { projectId: p.id } });
      let sent = 0, skipped = 0;
      for (let u of units) {
        const to = await unitRecipients(u);
        if (!to.length) { skipped++; continue; }
        u = await ensureToken(u);
        const r = await reportFor(p, u);
        for (const e of to) notify(e, `Progress on your unit ${u.code}: ${u.progress}%`, r.html);
        await prisma.projectUnit.update({ where: { id: u.id }, data: { lastReportAt: new Date() } });
        sent++;
      }
      res.json({ sent, skipped });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // An update for one unit only (photos of A-12's kitchen go to A-12's buyer).
  app.post('/api/projects/:projectId/units/:id/updates', auth, async (req, res) => {
    try {
      const found = await ownUnit(req.params.projectId, req.params.id);
      if (!found.u) return res.status(404).json({ error: 'Unit not found' });
      const { p } = found;
      const u = await ensureToken(found.u);
      const b = req.body || {};
      const title = text(b.title, 200);
      if (!title) return res.status(400).json({ error: 'Give the update a short title, e.g. "Kitchen tiles done".' });
      const row = await prismaBase.clientUpdate.create({ data: {
        workspaceId: p.workspaceId, projectId: p.id, unitId: u.id, stage: STAGES.includes(b.stage) ? b.stage : 'finishes',
        kind: UPDATE_KINDS.includes(b.kind) ? b.kind : 'progress', title, body: text(b.body, 6000), media: cleanMedia(b.media),
        authorId: req.user.sub, authorName: req.user.name || null, authorRole: req.user.role || null,
      } });
      if (b.notify !== false) {
        const link = unitLink(u);
        for (const e of await unitRecipients(u)) notify(e, `New update on your unit ${u.code}: ${title}`, p14(`<b>${req.user.name || 'Your developer'}</b> shared an update on unit <b>${u.code}</b> at <b>${p.name}</b>: “${title}”.`) + (link ? button(link, 'See it') : ''));
      }
      res.json(updateDto(row));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── The buyer's private page, no account needed ──
  app.get('/api/public/unit/:token', async (req, res) => {
    try {
      const u = await prismaBase.projectUnit.findUnique({ where: { shareToken: String(req.params.token) } });
      if (!u) return res.status(404).json({ error: 'This unit link is no longer active. Please ask your developer for a new one.' });
      const p = await prismaBase.project.findUnique({ where: { id: u.projectId } });
      if (!p) return res.status(404).json({ error: 'This project is no longer available.' });
      const [logs, snags] = await Promise.all([
        prismaBase.dailyLog.findMany({ where: { projectId: p.id, clientVisible: true }, orderBy: { date: 'desc' }, take: 40 }),
        prismaBase.punchItem.findMany({ where: { unitId: u.id, isPrivate: { not: true } }, orderBy: { createdAt: 'desc' }, take: 100 }),
      ]);
      const urls = (raw) => parse(raw).filter((x) => typeof x === 'string' && /^https?:\/\//i.test(x));
      const photos = logs.filter((l) => { const a = parse(l.unitIds); return !a.length || a.includes(u.id); })
        .map((l) => ({ date: l.date, photos: urls(l.photos), videos: urls(l.videos), scope: parse(l.unitIds).length ? 'unit' : 'project' }))
        .filter((l) => l.photos.length || l.videos.length).slice(0, 20);
      const [ws, updates, invoices, all] = await Promise.all([
        prismaBase.workspace.findUnique({ where: { id: p.workspaceId } }),
        prismaBase.clientUpdate.findMany({ where: { projectId: p.id, OR: [{ unitId: u.id }, { unitId: null }] }, orderBy: { createdAt: 'desc' }, take: 120 }),
        prismaBase.invoice.findMany({ where: { projectId: p.id, unitId: u.id, status: { not: 'draft' } }, orderBy: { createdAt: 'desc' } }),
        prismaBase.projectUnit.findMany({ where: { projectId: p.id }, select: { progress: true } }),
      ]);
      const building = all.length ? Math.round(all.reduce((s, x) => s + x.progress, 0) / all.length) : p.progress;
      res.json({
        company: companyPublic(ws),
        project: { name: p.name, city: p.city, status: p.status, progress: building, targetEndDate: p.targetEndDate, images: parse(p.images).filter((x) => typeof x === 'string' && /^https?:/i.test(x)).slice(0, 6) },
        unit: { code: u.code, block: u.block, floor: u.floor, type: u.type, sizeSqm: u.sizeSqm, status: u.status, statusLabel: STATUS_LABEL[u.status] || u.status, progress: u.progress, stages: parse(u.stages), clientName: u.clientName, priceKES: u.priceKES, paidKES: u.paidKES, updatedAt: u.updatedAt },
        updates: updates.map((x) => ({ ...updateDto(x), scope: x.unitId ? 'unit' : 'project' })),
        photos,
        snags: snags.map((x) => ({ code: x.code, title: x.title || x.desc, area: x.area, status: x.status, photos: urls(x.photos) })),
        invoices: invoices.map((i) => ({ invoiceNumber: i.invoiceNumber, amount: i.amount, paidAmount: i.paidAmount || 0, status: i.status, issueDate: i.issueDate, dueDate: i.dueDate })),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/projects/:projectId/units-settings', auth, async (req, res) => {
    const p = await ownProject(req.params.projectId);
    if (!p) return res.status(404).json({ error: 'Project not found' });
    res.json({ frequency: p.unitReportFrequency || null, lastAt: p.unitReportLastAt });
  });
  app.put('/api/projects/:projectId/units-settings', auth, async (req, res) => {
    try {
      if (!hasRole(req, CAN_SHARE_PORTAL)) return res.status(403).json({ error: 'Your role cannot change client reports.' });
      const p = await ownProject(req.params.projectId);
      if (!p) return res.status(404).json({ error: 'Project not found' });
      const f = ['weekly', 'monthly'].includes(req.body?.frequency) ? req.body.frequency : null;
      // The first automatic report goes one period from now ("Send reports" sends one today).
      const row = await prismaBase.project.update({ where: { id: p.id }, data: { unitReportFrequency: f, unitReportLastAt: f ? (p.unitReportLastAt || new Date()) : p.unitReportLastAt } });
      res.json({ frequency: row.unitReportFrequency, lastAt: row.unitReportLastAt });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /** Email every unit client of every project that is due a weekly or monthly report. */
  async function runAutoReports() {
    const nairobiHour = (new Date().getUTCHours() + 3) % 24;
    if (nairobiHour < 8 || nairobiHour > 17) return;  // in working hours only
    const now = Date.now();
    const projects = await prismaBase.project.findMany({ where: { unitReportFrequency: { in: ['weekly', 'monthly'] } } });
    for (const p of projects) {
      const days = p.unitReportFrequency === 'weekly' ? 7 : 30;
      if (p.unitReportLastAt && now - new Date(p.unitReportLastAt).getTime() < days * 864e5 - 3600e3) continue;
      // Claim the run first, so two servers never send twice.
      const claimed = await prismaBase.project.updateMany({ where: { id: p.id, unitReportLastAt: p.unitReportLastAt }, data: { unitReportLastAt: new Date() } });
      if (!claimed.count) continue;
      const list = await prismaBase.projectUnit.findMany({ where: { projectId: p.id } });
      let sent = 0;
      for (let u of list) {
        const to = await unitRecipients(u);
        if (!to.length) continue;
        if (!u.shareToken) u = await prismaBase.projectUnit.update({ where: { id: u.id }, data: { shareToken: crypto.randomBytes(12).toString('base64url') } });
        const r = await reportFor(p, u);
        for (const e of to) notify(e, `${p.unitReportFrequency === 'weekly' ? 'Weekly' : 'Monthly'} progress on your unit ${u.code}: ${u.progress}%`, r.html);
        await prismaBase.projectUnit.update({ where: { id: u.id }, data: { lastReportAt: new Date() } });
        sent++;
      }
      console.log(`[unit-reports] ${p.name}: ${sent} report(s) sent`);
    }
  }
  const tick = () => runAutoReports().catch((e) => console.error('[unit-reports]', e.message));
  setInterval(tick, 60 * 60 * 1000).unref();
  setTimeout(tick, 60 * 1000).unref();  // soon after a deploy too, so a restart never skips a due report
  h.runUnitAutoReports = runAutoReports;

  return { unitRecipients, unitLink, kes, runAutoReports };
};
module.exports.APARTMENT_STAGES = APARTMENT_STAGES;
module.exports.HOUSE_STAGES = HOUSE_STAGES;
