// Labour muster: casual labourers who have no login (fundis, helpers, mason
// gangs), marked present / half day / absent each day on a site, and the wage
// bill those marks add up to. Each mark keeps the rate it was paid at, so
// changing someone's rate never rewrites last week's pay.

module.exports = function labourRoutes(app, d) {
  const { prisma, auth, currentWs } = d;
  const text = (v, max = 120) => { const s = String(v == null ? '' : v).trim(); return s ? s.slice(0, max) : null; };
  const num = (v) => { const n = Number(String(v ?? '').replace(/[, ]/g, '')); return Number.isFinite(n) && n >= 0 ? n : 0; };
  const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  const today = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const STATUS = ['present', 'half', 'absent'];
  const pay = (status, rate) => (status === 'present' ? rate : status === 'half' ? rate / 2 : 0);
  const noClients = (req, res, next) => (req.user && req.user.role === 'Client' ? res.status(403).json({ error: 'Not available to clients.' }) : next());
  async function ownProject(id) {
    if (!id) return null;
    const p = await prisma.project.findUnique({ where: { id: String(id) } });
    return p && p.workspaceId === currentWs() ? p : null;
  }
  const workerDto = (w) => ({ id: w.id, projectId: w.projectId, name: w.name, phone: w.phone, trade: w.trade, dailyRate: w.dailyRate, active: w.active });

  // Workers: everyone on this site, plus those who move between sites.
  app.get('/api/labour/workers', auth, noClients, async (req, res) => {
    try {
      const where = { active: req.query.all ? undefined : true };
      if (req.query.projectId) where.OR = [{ projectId: String(req.query.projectId) }, { projectId: null }];
      const rows = await prisma.labourer.findMany({ where, orderBy: [{ trade: 'asc' }, { name: 'asc' }] });
      res.json(rows.map(workerDto));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // One worker, or several at once ({ workers: [...] }).
  app.post('/api/labour/workers', auth, noClients, async (req, res) => {
    try {
      const list = Array.isArray(req.body?.workers) ? req.body.workers : [req.body || {}];
      const out = [];
      for (const w of list.slice(0, 200)) {
        const name = text(w.name);
        if (!name) continue;
        const p = w.projectId ? await ownProject(w.projectId) : null;
        out.push(workerDto(await prisma.labourer.create({ data: { name, phone: text(w.phone, 40), trade: text(w.trade, 60), dailyRate: num(w.dailyRate), projectId: p ? p.id : null } })));
      }
      if (!out.length) return res.status(400).json({ error: 'Give the worker a name.' });
      res.json(Array.isArray(req.body?.workers) ? out : out[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/labour/workers/:id', auth, noClients, async (req, res) => {
    try {
      const w = await prisma.labourer.findUnique({ where: { id: req.params.id } });
      if (!w) return res.status(404).json({ error: 'Worker not found' });
      const b = req.body || {}, data = {};
      if (b.name !== undefined && text(b.name)) data.name = text(b.name);
      if (b.phone !== undefined) data.phone = text(b.phone, 40);
      if (b.trade !== undefined) data.trade = text(b.trade, 60);
      if (b.dailyRate !== undefined) data.dailyRate = num(b.dailyRate);
      if (b.active !== undefined) data.active = !!b.active;
      if (b.projectId !== undefined) { const p = b.projectId ? await ownProject(b.projectId) : null; data.projectId = p ? p.id : null; }
      res.json(workerDto(await prisma.labourer.update({ where: { id: w.id }, data })));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // The muster for a site and day: every worker with today's mark (if any).
  app.get('/api/labour/muster', auth, noClients, async (req, res) => {
    try {
      const p = await ownProject(req.query.projectId);
      if (!p) return res.status(404).json({ error: 'Pick a project.' });
      const date = isDay(req.query.date) ? req.query.date : today();
      const [workers, marks] = await Promise.all([
        prisma.labourer.findMany({ where: { active: true, OR: [{ projectId: p.id }, { projectId: null }] }, orderBy: [{ trade: 'asc' }, { name: 'asc' }] }),
        prisma.labourDay.findMany({ where: { date, projectId: p.id } }),
      ]);
      // Someone marked here who has since moved site or left still shows for that day.
      const extra = marks.filter((m) => !workers.some((w) => w.id === m.labourerId)).map((m) => m.labourerId);
      const others = extra.length ? await prisma.labourer.findMany({ where: { id: { in: extra } } }) : [];
      // Marked on another site today: shown, so nobody is paid twice for one day.
      const elsewhere = await prisma.labourDay.findMany({ where: { date, projectId: { not: p.id }, labourerId: { in: workers.map((w) => w.id) }, status: { not: 'absent' } } });
      const rows = [...workers, ...others].map((w) => {
        const m = marks.find((x) => x.labourerId === w.id);
        const o = elsewhere.find((x) => x.labourerId === w.id);
        return { ...workerDto(w), status: m ? m.status : null, pay: m ? m.rate : 0, elsewhere: o ? o.projectId : null };
      });
      res.json({ date, projectId: p.id, workers: rows, present: rows.filter((r) => r.status === 'present').length, half: rows.filter((r) => r.status === 'half').length, wages: rows.reduce((s, r) => s + (r.pay || 0), 0) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Save marks: { projectId, date, marks: [{ labourerId, status }] }.
  app.post('/api/labour/muster', auth, noClients, async (req, res) => {
    try {
      const p = await ownProject(req.body?.projectId);
      if (!p) return res.status(404).json({ error: 'Pick a project.' });
      const date = isDay(req.body?.date) ? req.body.date : today();
      if (date > today()) return res.status(400).json({ error: "You can't mark a day that hasn't happened yet." });
      const marks = (Array.isArray(req.body?.marks) ? req.body.marks : []).filter((m) => m && m.labourerId && (STATUS.includes(m.status) || m.status === null));
      const ws = await prisma.labourer.findMany({ where: { id: { in: marks.map((m) => String(m.labourerId)) } } });
      let saved = 0;
      for (const m of marks) {
        const w = ws.find((x) => x.id === String(m.labourerId));
        if (!w) continue;
        if (m.status === null) { await prisma.labourDay.deleteMany({ where: { labourerId: w.id, date } }); continue; }
        const rate = pay(m.status, w.dailyRate);
        await prisma.labourDay.upsert({
          where: { labourerId_date: { labourerId: w.id, date } },
          create: { labourerId: w.id, projectId: p.id, date, status: m.status, rate, markedBy: req.user?.name || null },
          update: { projectId: p.id, status: m.status, rate, markedBy: req.user?.name || null },
        });
        saved++;
      }
      res.json({ saved });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // The wage bill for a period (default: this week, Monday to Sunday).
  app.get('/api/labour/wages', auth, noClients, async (req, res) => {
    try {
      let from = isDay(req.query.from) ? req.query.from : null, to = isDay(req.query.to) ? req.query.to : null;
      if (!from || !to) {
        const t = new Date(`${today()}T00:00:00Z`); const dow = (t.getUTCDay() + 6) % 7;
        const mon = new Date(t.getTime() - dow * 864e5);
        from = mon.toISOString().slice(0, 10); to = new Date(mon.getTime() + 6 * 864e5).toISOString().slice(0, 10);
      }
      const where = { date: { gte: from, lte: to }, status: { not: 'absent' } };
      if (req.query.projectId) { const p = await ownProject(req.query.projectId); if (!p) return res.status(404).json({ error: 'Project not found' }); where.projectId = p.id; }
      const days = await prisma.labourDay.findMany({ where, orderBy: { date: 'asc' } });
      const ws = await prisma.labourer.findMany({ where: { id: { in: [...new Set(days.map((x) => x.labourerId))] } } });
      const rows = ws.map((w) => {
        const mine = days.filter((x) => x.labourerId === w.id);
        return { id: w.id, name: w.name, phone: w.phone, trade: w.trade, dailyRate: w.dailyRate, days: mine.filter((x) => x.status === 'present').length, halfDays: mine.filter((x) => x.status === 'half').length, amount: mine.reduce((s, x) => s + x.rate, 0), dates: mine.map((x) => x.date) };
      }).sort((a, b) => String(a.trade || '').localeCompare(String(b.trade || '')) || a.name.localeCompare(b.name));
      const perDay = {};
      for (const x of days) perDay[x.date] = (perDay[x.date] || 0) + (x.status === 'half' ? 0.5 : 1);
      res.json({ from, to, rows, total: rows.reduce((s, r) => s + r.amount, 0), labourDays: days.reduce((s, x) => s + (x.status === 'half' ? 0.5 : 1), 0), perDay });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};
