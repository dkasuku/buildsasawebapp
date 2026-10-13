// Client accounts: homeowners, landowners and investors (many of them abroad)
// who follow their site in Buildsasa. A client has no workspace; the `auth`
// middleware fences them to /api/client/* (see CLIENT_ALLOWED in server.js), and
// every query here goes through prismaBase with an explicit ownership check,
// because the tenant-scoping extension only protects workspace users.
//
// Also here: the contractor side of sharing with clients (invites, progress
// updates, chat), client-posted jobs that Buildsasa approves, and Buildsasa's
// neutral site-reporting service (10% of the project cost, paid monthly).

// Stages a client can follow, from buying land to handover. Kept in step with
// src/app/components/constructai/client/clientData.ts.
const STAGES = [
  'land_purchase', 'survey', 'clearing', 'fencing', 'gate', 'water', 'foundation', 'walling', 'roofing',
  'services', 'finishes', 'solar', 'cctv', 'landscaping', 'garbage', 'handover', 'other',
];
const UPDATE_KINDS = ['progress', 'inspection', 'milestone', 'issue'];
const REPORTING_FEE_PERCENT = 10;

module.exports = function clientRoutes(app, d) {
  const { prisma, prismaBase, auth, currentWs, hasRole, CAN_SHARE_PORTAL, sendEmail, emailShell, button,
    paystackRequest, PAYSTACK_SECRET, isPlatformAdmin, portalPayload, companyPublic, APP_URL } = d;

  const text = (v, max = 2000) => { const s = String(v == null ? '' : v).trim(); return s ? s.slice(0, max) : null; };
  const parse = (v) => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
  // Only durable http(s) URLs, typed as image or video, at most 30 per post.
  const cleanMedia = (v) => {
    const arr = Array.isArray(v) ? v : parse(v);
    const out = arr.map((m) => (typeof m === 'string' ? { url: m } : m))
      .filter((m) => m && typeof m.url === 'string' && /^https?:\/\//i.test(m.url))
      .slice(0, 30)
      .map((m) => ({ url: m.url, type: m.type === 'video' || /\.(mp4|mov|webm|m4v|3gp)(\?|$)/i.test(m.url) ? 'video' : 'image' }));
    return out.length ? JSON.stringify(out) : null;
  };
  const updateDto = (u) => ({ ...u, media: parse(u.media) });
  const msgDto = (m) => ({ ...m, media: parse(m.media) });
  const kes = (n) => `KES ${Math.round(Number(n) || 0).toLocaleString('en-KE')}`;

  const requireClient = (req, res, next) => (req.user && req.user.role === 'Client' ? next() : res.status(403).json({ error: 'This page is for client accounts.' }));
  const requireStaff = (req, res, next) => (isPlatformAdmin(req.user && req.user.email) ? next() : res.status(403).json({ error: 'Only Buildsasa staff can do this.' }));
  const me = (req) => prismaBase.user.findUnique({ where: { id: req.user.sub } });

  // Claim any invites sent to this email before the account existed.
  async function claimInvites(user) {
    if (!user || !user.email) return;
    await prismaBase.projectClient.updateMany({ where: { email: user.email.toLowerCase(), userId: null }, data: { userId: user.id } }).catch(() => {});
  }
  d.claimClientInvites = claimInvites;

  async function linkedProject(req, projectId) {
    const u = await me(req);
    if (!u) return null;
    const link = await prismaBase.projectClient.findFirst({ where: { projectId, OR: [{ userId: u.id }, { email: u.email.toLowerCase() }] } });
    if (!link) return null;
    const p = await prismaBase.project.findUnique({ where: { id: projectId } });
    return p ? { p, u, link } : null;
  }

  async function activeWorkspaceIds() {
    const subs = await prismaBase.subscription.findMany({ where: { status: 'active', workspaceId: { not: null } }, select: { workspaceId: true, currentPeriodEnd: true } });
    const now = Date.now();
    return [...new Set(subs.filter((s) => !s.currentPeriodEnd || new Date(s.currentPeriodEnd).getTime() > now).map((s) => s.workspaceId))];
  }

  // Best-effort email; never blocks a request.
  const notify = (to, subject, html) => { if (to) sendEmail({ to, subject, html: emailShell(subject, html) }).catch(() => {}); };
  const p14 = (s) => `<p style="font-size:14px;color:#11161D">${s}</p>`;
  async function emailClients(projectId, subject, line) {
    const links = await prismaBase.projectClient.findMany({ where: { projectId } });
    for (const l of links) notify(l.email, subject, p14(line) + button(`${APP_URL}/?as=client`, 'Open Buildsasa'));
  }
  async function emailTeam(workspaceId, subject, line) {
    // The people who can share with clients hear from them.
    const team = await prismaBase.user.findMany({ where: { workspaceId, status: 'active', role: { in: CAN_SHARE_PORTAL } }, select: { email: true }, take: 10 });
    for (const t of team) notify(t.email, subject, p14(line) + button(APP_URL, 'Open Buildsasa'));
  }

  // ── Trust score ──
  // How far a client can trust a company, as a percentage, from three things:
  //  * Daily logs: days with a log in the last 30 days on its active projects
  //    (a site that is reported on every working day scores 100).
  //  * Handovers: projects handed over vs. projects past their target date and
  //    still not handed over.
  //  * Client ratings: the average of 1-5 stars. A bad rating pulls the score
  //    down hard, because it carries the most weight.
  // A part with no data yet is left out and the others are re-weighted, so a
  // new company isn't punished for having no history; `basis` says what counted.
  const TRUST_WEIGHTS = { logs: 0.3, handover: 0.25, rating: 0.45 };
  async function trustScores(wsIds) {
    if (!wsIds.length) return {};
    const since = new Date(Date.now() - 30 * 864e5);
    const [projects, logs, ratings] = await Promise.all([
      prismaBase.project.findMany({ where: { workspaceId: { in: wsIds } }, select: { id: true, workspaceId: true, status: true, targetEndDate: true, practicalCompletionAt: true } }),
      prismaBase.dailyLog.findMany({ where: { workspaceId: { in: wsIds }, date: { gte: since } }, select: { workspaceId: true, projectId: true, date: true } }),
      prismaBase.contractorRating.findMany({ where: { workspaceId: { in: wsIds } }, select: { workspaceId: true, stars: true } }),
    ]);
    const out = {};
    const now = Date.now();
    for (const ws of wsIds) {
      const ps = projects.filter((p) => p.workspaceId === ws);
      const handed = ps.filter((p) => p.practicalCompletionAt || /complete|handed|closed/i.test(p.status || '')).length;
      const overdue = ps.filter((p) => !p.practicalCompletionAt && !/complete|handed|closed|archiv/i.test(p.status || '') && p.targetEndDate && new Date(p.targetEndDate).getTime() < now).length;
      const active = ps.filter((p) => !p.practicalCompletionAt && !/complete|handed|closed|archiv|hold/i.test(p.status || '')).length;
      // Distinct project-days with a log, against 22 working days per active project.
      const days = new Set(logs.filter((l) => l.workspaceId === ws).map((l) => `${l.projectId}:${new Date(l.date).toISOString().slice(0, 10)}`)).size;
      const rs = ratings.filter((r) => r.workspaceId === ws);
      const parts = {
        logs: active ? Math.min(100, Math.round((days / (active * 22)) * 100)) : null,
        handover: handed + overdue ? Math.round((handed / (handed + overdue)) * 100) : null,
        rating: rs.length ? Math.round(((rs.reduce((s, r) => s + r.stars, 0) / rs.length - 1) / 4) * 100) : null,
      };
      const used = Object.keys(parts).filter((k) => parts[k] !== null);
      const wsum = used.reduce((s, k) => s + TRUST_WEIGHTS[k], 0);
      out[ws] = {
        score: used.length ? Math.round(used.reduce((s, k) => s + parts[k] * TRUST_WEIGHTS[k], 0) / wsum) : null,
        parts, basis: used,
        ratingAvg: rs.length ? Math.round((rs.reduce((s, r) => s + r.stars, 0) / rs.length) * 10) / 10 : null,
        ratingCount: rs.length, handedOver: handed, logDays30: days,
      };
    }
    return out;
  }
  d.trustScores = trustScores;

  // Can this client rate this company? Only after working with it: a project the
  // company shared with them, or a job of theirs the company was awarded.
  async function canRate(u, ws) {
    const link = await prismaBase.projectClient.findFirst({ where: { workspaceId: ws, OR: [{ userId: u.id }, { email: u.email.toLowerCase() }] } });
    if (link) return true;
    const jobs = await prismaBase.job.findMany({ where: { clientUserId: u.id }, select: { id: true } });
    return !!(jobs.length && await prismaBase.jobBid.findFirst({ where: { jobId: { in: jobs.map((j) => j.id) }, workspaceId: ws, status: 'awarded' } }));
  }

  // ───────────────────────── Client side ─────────────────────────

  // Everything the client home needs: their sites, things waiting on them, and
  // their site-reporting services.
  app.get('/api/client/home', auth, requireClient, async (req, res) => {
    try {
      const u = await me(req);
      await claimInvites(u);
      const links = await prismaBase.projectClient.findMany({ where: { OR: [{ userId: u.id }, { email: u.email.toLowerCase() }] } });
      const ids = [...new Set(links.map((l) => l.projectId))];
      const [projects, reporting, jobs] = await Promise.all([
        prismaBase.project.findMany({ where: { id: { in: ids } } }),
        prismaBase.siteReporting.findMany({ where: { clientUserId: u.id }, orderBy: { createdAt: 'desc' } }),
        prismaBase.job.findMany({ where: { clientUserId: u.id }, orderBy: { createdAt: 'desc' }, include: { _count: { select: { bids: true } } } }),
      ]);
      const wsIds = [...new Set(projects.map((p) => p.workspaceId).filter(Boolean))];
      const companies = await prismaBase.workspace.findMany({ where: { id: { in: wsIds } } });
      const byWs = Object.fromEntries(companies.map((w) => [w.id, w]));
      const [cos, sels, invs, lastUpdates] = await Promise.all([
        prismaBase.changeOrder.findMany({ where: { projectId: { in: ids }, status: 'owner_approval' }, select: { id: true, projectId: true, title: true, number: true } }),
        prismaBase.selection.findMany({ where: { projectId: { in: ids }, status: 'awaiting_client' }, select: { id: true, projectId: true, name: true } }),
        prismaBase.invoice.findMany({ where: { projectId: { in: ids }, status: { in: ['sent', 'overdue', 'partial', 'unpaid'] } }, select: { id: true, projectId: true, invoiceNumber: true, amount: true, paidAmount: true, dueDate: true } }),
        prismaBase.clientUpdate.findMany({ where: { projectId: { in: ids } }, orderBy: { createdAt: 'desc' }, take: 40 }),
      ]);
      const todo = [
        ...cos.map((c) => ({ kind: 'change_order', projectId: c.projectId, label: `Approve or reject change order ${c.number || ''}: ${c.title}`.replace('  ', ' ') })),
        ...sels.map((s) => ({ kind: 'selection', projectId: s.projectId, label: `Choose or approve a finish: ${s.name}` })),
        ...invs.map((i) => ({ kind: 'invoice', projectId: i.projectId, label: `Invoice ${i.invoiceNumber}: ${kes((i.amount || 0) - (i.paidAmount || 0))} to pay${i.dueDate ? `, due ${String(i.dueDate).slice(0, 10)}` : ''}` })),
        ...reporting.filter((r) => r.status === 'approved').map((r) => ({ kind: 'reporting_payment', reportingId: r.id, label: `Pay the first month of site reporting for ${r.siteName} (${kes(r.monthlyFeeKES)}) to start visits` })),
      ];
      res.json({
        user: { name: u.name, email: u.email, phone: u.phone, country: u.country },
        projects: projects.map((p) => ({
          id: p.id, name: p.name, city: p.city, status: p.status, progress: p.progress, startDate: p.startDate, targetEndDate: p.targetEndDate,
          cover: parse(p.images)[0] || null, company: companyPublic(byWs[p.workspaceId]),
          lastUpdate: (() => { const x = lastUpdates.find((l) => l.projectId === p.id); return x ? { title: x.title, stage: x.stage, createdAt: x.createdAt } : null; })(),
        })),
        todo,
        reporting,
        jobs: jobs.map((j) => ({ id: j.id, title: j.title, category: j.category, location: j.location, status: j.status, approval: j.approval, bidCount: j._count.bids, createdAt: j.createdAt })),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/client/me', auth, requireClient, async (req, res) => {
    try {
      const b = req.body || {};
      const data = {};
      if (b.name !== undefined && text(b.name, 120)) data.name = text(b.name, 120);
      if (b.phone !== undefined) data.phone = text(b.phone, 40);
      if (b.country !== undefined) data.country = text(b.country, 80);
      const u = await prismaBase.user.update({ where: { id: req.user.sub }, data });
      res.json({ name: u.name, email: u.email, phone: u.phone, country: u.country });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // One site: the portal data (timeline, photos, change orders, selections,
  // invoices), plus the shared feed, shared daily logs and shared inspections.
  app.get('/api/client/projects/:id', auth, requireClient, async (req, res) => {
    try {
      const hit = await linkedProject(req, req.params.id);
      if (!hit) return res.status(404).json({ error: 'This site isn\'t linked to your account. Ask your contractor to invite you with this email address.' });
      const { p } = hit;
      // The approval buttons reuse the portal endpoints, so a linked client always has a token.
      let token = p.portalToken;
      if (!token) {
        token = require('crypto').randomBytes(12).toString('base64url');
        await prismaBase.project.update({ where: { id: p.id }, data: { portalToken: token, portalSharedAt: new Date() } });
      }
      const [portal, updates, logs, inspections] = await Promise.all([
        portalPayload({ ...p, portalToken: token }),
        prismaBase.clientUpdate.findMany({ where: { projectId: p.id }, orderBy: { createdAt: 'desc' }, take: 200 }),
        prismaBase.dailyLog.findMany({ where: { projectId: p.id, clientVisible: true }, orderBy: { date: 'desc' }, take: 90 }),
        prismaBase.inspection.findMany({ where: { projectId: p.id, clientVisible: true }, orderBy: { createdAt: 'desc' }, take: 100 }),
      ]);
      const urls = (raw) => parse(raw).filter((x) => typeof x === 'string' && /^https?:\/\//i.test(x));
      res.json({
        id: p.id, companyId: p.workspaceId, portalToken: token, ...portal,
        updates: updates.map(updateDto),
        // Daily logs ARE shared (a client abroad wants to know the site was worked
        // on, by how many people, in what weather) but the free-text notes are
        // written for the site team, so only the summary fields leave.
        dailyLogs: logs.map((l) => ({
          id: l.id, date: l.date, weather: l.weather, workers: l.headcount ?? null,
          location: l.placeName || l.location, photos: urls(l.photos), videos: urls(l.videos),
        })),
        inspections: inspections.map((i) => ({
          id: i.id, type: i.type, inspector: i.inspector, date: i.date, status: i.status, notes: i.notes,
          photos: urls(i.photos), videos: urls(i.videos), checklist: parse(i.checklist),
        })),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Chat with the contractor's team on a site.
  app.get('/api/client/projects/:id/messages', auth, requireClient, async (req, res) => {
    try {
      const hit = await linkedProject(req, req.params.id);
      if (!hit) return res.status(404).json({ error: 'This site isn\'t linked to your account.' });
      const rows = await prismaBase.clientMessage.findMany({ where: { projectId: hit.p.id }, orderBy: { createdAt: 'asc' }, take: 500 });
      res.json(rows.map(msgDto));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/client/projects/:id/messages', auth, requireClient, async (req, res) => {
    try {
      const hit = await linkedProject(req, req.params.id);
      if (!hit) return res.status(404).json({ error: 'This site isn\'t linked to your account.' });
      const body = text(req.body?.body, 4000); const media = cleanMedia(req.body?.media);
      if (!body && !media) return res.status(400).json({ error: 'Write a message or attach a photo.' });
      const row = await prismaBase.clientMessage.create({ data: { workspaceId: hit.p.workspaceId, projectId: hit.p.id, senderType: 'client', senderId: hit.u.id, senderName: hit.u.name, body, media } });
      emailTeam(hit.p.workspaceId, `New message from your client on ${hit.p.name}`, `<b>${hit.u.name}</b> wrote: “${(body || 'sent photos').slice(0, 300)}”. Reply from the project's Client tab.`);
      res.json(msgDto(row));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Companies a client can pick: workspaces with an active Buildsasa subscription.
  app.get('/api/client/companies', auth, requireClient, async (req, res) => {
    try {
      const ids = await activeWorkspaceIds();
      const rows = await prismaBase.workspace.findMany({ where: { id: { in: ids } }, orderBy: { name: 'asc' } });
      const counts = await prismaBase.project.groupBy({ by: ['workspaceId'], where: { workspaceId: { in: ids } }, _count: { _all: true } }).catch(() => []);
      const n = Object.fromEntries(counts.map((c) => [c.workspaceId, c._count._all]));
      const trust = await trustScores(rows.map((w) => w.id));
      const u = await me(req);
      const mine = await prismaBase.contractorRating.findMany({ where: { clientUserId: u.id } });
      const myStars = Object.fromEntries(mine.map((r) => [r.workspaceId, r.stars]));
      const list = rows.map((w) => ({ id: w.id, ...companyPublic(w), kraPin: undefined, paymentDetails: undefined, services: parse(w.services), about: w.about || null, projects: n[w.id] || 0, trust: trust[w.id], myRating: myStars[w.id] || null }));
      // Highest trust first; companies with no history yet go last, by name.
      list.sort((a, b) => (b.trust.score ?? -1) - (a.trust.score ?? -1) || a.name.localeCompare(b.name));
      res.json(list);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // A client posts a job. Buildsasa approves it before any contractor sees it.
  app.post('/api/client/jobs', auth, requireClient, async (req, res) => {
    try {
      const u = await me(req); const b = req.body || {};
      const title = text(b.title, 200); const description = text(b.description, 8000); const category = text(b.category, 120);
      if (!title || !description || !category) return res.status(400).json({ error: 'Give the job a title, a type of work and a description.' });
      let target = null;
      if (b.targetWorkspaceId) {
        const ids = await activeWorkspaceIds();
        if (!ids.includes(b.targetWorkspaceId)) return res.status(400).json({ error: 'That company isn\'t available right now. Choose another, or send the job to all contractors.' });
        target = b.targetWorkspaceId;
      }
      const job = await prismaBase.job.create({ data: {
        title, description, category, location: text(b.location, 300),
        budgetKES: Number(b.budgetKES) > 0 ? Number(b.budgetKES) : null,
        deadline: /^\d{4}-\d{2}-\d{2}$/.test(String(b.deadline || '')) ? b.deadline : null,
        attachments: (() => { const m = cleanMedia(b.media); return m ? JSON.stringify(parse(m).map((x, i) => ({ name: `${x.type === 'video' ? 'Video' : 'Photo'} ${i + 1}`, url: x.url }))) : null; })(),
        clientName: u.name, clientEmail: u.email, clientPhone: text(b.phone, 40) || u.phone || null,
        clientUserId: u.id, targetWorkspaceId: target, approval: 'pending', status: 'open', createdBy: u.email,
      } });
      if (process.env.LEADS_NOTIFY_EMAIL) notify(process.env.LEADS_NOTIFY_EMAIL, `Client job waiting for approval: ${title}`, p14(`<b>${u.name}</b> (${u.email}) posted “${title}” (${category}). Approve it in the admin panel under Jobs so contractors can bid.`));
      res.json(job);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/client/companies/:id/rating', auth, requireClient, async (req, res) => {
    try {
      const u = await me(req);
      const stars = parseInt(req.body?.stars, 10);
      if (!(stars >= 1 && stars <= 5)) return res.status(400).json({ error: 'Choose between 1 and 5 stars.' });
      if (!(await canRate(u, req.params.id))) return res.status(403).json({ error: 'You can rate a company once it has shared a project with you or you have awarded it a job.' });
      const comment = text(req.body?.comment, 1000);
      const row = await prismaBase.contractorRating.upsert({
        where: { workspaceId_clientUserId: { workspaceId: req.params.id, clientUserId: u.id } },
        create: { workspaceId: req.params.id, clientUserId: u.id, clientName: u.name, stars, comment },
        update: { stars, comment, clientName: u.name },
      });
      if (stars <= 2) emailTeam(req.params.id, `A client rated your company ${stars}/5`, `<b>${u.name}</b> gave your company ${stars} star${stars > 1 ? 's' : ''}${comment ? `: “${comment.slice(0, 300)}”` : '.'} Low ratings lower your trust score on Buildsasa. Reach out to the client to put things right.`);
      res.json(row);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // The client awards a bid on a job they posted, to a company that is still
  // subscribed. The company gets the client's contact details by email.
  app.post('/api/client/jobs/:id/bids/:bidId/award', auth, requireClient, async (req, res) => {
    try {
      const u = await me(req);
      const job = await prismaBase.job.findUnique({ where: { id: req.params.id } });
      if (!job || job.clientUserId !== u.id) return res.status(404).json({ error: 'Job not found.' });
      if (job.approval !== 'approved') return res.status(409).json({ error: 'Buildsasa is still reviewing this job.' });
      if (job.status === 'awarded') return res.status(409).json({ error: 'This job has already been awarded.' });
      const bid = await prismaBase.jobBid.findUnique({ where: { id: req.params.bidId } });
      if (!bid || bid.jobId !== job.id) return res.status(404).json({ error: 'Bid not found.' });
      if (!(await activeWorkspaceIds()).includes(bid.workspaceId)) return res.status(409).json({ error: `${bid.companyName}'s Buildsasa subscription isn't active, so the job can't be awarded to them right now. Choose another bid, or ask them to renew.` });
      await prismaBase.jobBid.update({ where: { id: bid.id }, data: { status: 'awarded' } });
      await prismaBase.jobBid.updateMany({ where: { jobId: job.id, id: { not: bid.id }, status: { in: ['submitted', 'shortlisted'] } }, data: { status: 'rejected' } });
      await prismaBase.job.update({ where: { id: job.id }, data: { status: 'awarded' } });
      if (bid.email) notify(bid.email, `You won the job: ${job.title}`, p14(`<b>${u.name}</b> awarded <b>${bid.companyName}</b> the job “${job.title}” for KES ${Math.round(bid.amountKES).toLocaleString('en-KE')}. Contact them: ${u.email}${job.clientPhone ? `, ${job.clientPhone}` : ''}. Tip: create the project in Buildsasa and invite ${u.email} from its Client tab so they can follow the work.`));
      if (process.env.LEADS_NOTIFY_EMAIL) notify(process.env.LEADS_NOTIFY_EMAIL, `Client awarded a job: ${job.title}`, p14(`${u.name} awarded “${job.title}” to ${bid.companyName} (KES ${Math.round(bid.amountKES).toLocaleString('en-KE')}).`));
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/client/jobs/:id/bids', auth, requireClient, async (req, res) => {
    try {
      const job = await prismaBase.job.findUnique({ where: { id: req.params.id } });
      if (!job || job.clientUserId !== req.user.sub) return res.status(404).json({ error: 'Job not found.' });
      const bids = await prismaBase.jobBid.findMany({ where: { jobId: job.id }, orderBy: { amountKES: 'asc' } });
      const active = new Set(await activeWorkspaceIds());
      const trust = await trustScores([...new Set(bids.map((b) => b.workspaceId))]);
      res.json(bids.map((b) => ({ id: b.id, workspaceId: b.workspaceId, companyName: b.companyName, contactName: b.contactName, phone: b.phone, email: b.email, amountKES: b.amountKES, timelineDays: b.timelineDays, message: b.message, status: b.status, createdAt: b.createdAt, canAward: active.has(b.workspaceId), trust: trust[b.workspaceId] })));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Buildsasa site reporting (client side) ──
  const reportingDto = (r) => ({ ...r, stages: parse(r.stages) });

  app.post('/api/client/reporting', auth, requireClient, async (req, res) => {
    try {
      const u = await me(req); const b = req.body || {};
      const siteName = text(b.siteName, 200); const location = text(b.location, 300);
      const cost = Number(b.projectCostKES); const months = Math.max(1, Math.min(60, parseInt(b.months, 10) || 0));
      if (!siteName || !location) return res.status(400).json({ error: 'Tell us the site name and where it is.' });
      if (!cost || cost < 10000) return res.status(400).json({ error: 'Enter the total project cost in KES (what the work is expected to cost).' });
      if (!months) return res.status(400).json({ error: 'How many months should we report for?' });
      if (req.body?.agreeFee !== true) return res.status(400).json({ error: 'Please confirm that you agree to pay 10% of the project cost, monthly, plus transport and lunch for each visit.' });
      let projectId = null;
      if (b.projectId) { const hit = await linkedProject(req, b.projectId); if (hit) projectId = hit.p.id; }
      const row = await prismaBase.siteReporting.create({ data: {
        clientUserId: u.id, clientName: u.name, clientEmail: u.email, clientPhone: text(b.phone, 40) || u.phone || null,
        projectId, siteName, location, lat: Number.isFinite(Number(b.lat)) && b.lat !== null && b.lat !== '' ? Number(b.lat) : null, lng: Number.isFinite(Number(b.lng)) && b.lng !== null && b.lng !== '' ? Number(b.lng) : null,
        stages: JSON.stringify((Array.isArray(b.stages) ? b.stages : []).filter((s) => STAGES.includes(s))), notes: text(b.notes, 4000),
        projectCostKES: cost, months, feePercent: REPORTING_FEE_PERCENT, feeAgreedAt: new Date(),
        monthlyFeeKES: Math.round((cost * REPORTING_FEE_PERCENT) / 100 / months),
      } });
      if (process.env.LEADS_NOTIFY_EMAIL) notify(process.env.LEADS_NOTIFY_EMAIL, `Site reporting request: ${siteName}`, p14(`<b>${u.name}</b> (${u.email}${row.clientPhone ? `, ${row.clientPhone}` : ''}) wants Buildsasa to report on <b>${siteName}</b>, ${location}. Project cost ${kes(cost)} over ${months} months: ${kes(row.monthlyFeeKES)} a month. Review it in the admin panel under Site reporting.`));
      notify(u.email, 'We received your site reporting request', p14(`Thank you, ${u.name}. Our team will call you within one working day to confirm the details of <b>${siteName}</b>. Once approved, you pay ${kes(row.monthlyFeeKES)} a month (10% of the project cost over ${months} months), plus transport and lunch for each site visit, and every report reaches you in Buildsasa.`));
      res.json(reportingDto(row));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  async function ownReporting(req, id) {
    const r = await prismaBase.siteReporting.findUnique({ where: { id } });
    return r && r.clientUserId === req.user.sub ? r : null;
  }

  app.get('/api/client/reporting/:id', auth, requireClient, async (req, res) => {
    try {
      const r = await ownReporting(req, req.params.id);
      if (!r) return res.status(404).json({ error: 'Not found.' });
      const [updates, payments] = await Promise.all([
        prismaBase.clientUpdate.findMany({ where: { reportingId: r.id }, orderBy: { createdAt: 'desc' } }),
        prismaBase.siteReportingPayment.findMany({ where: { reportingId: r.id, status: 'paid' }, orderBy: { paidAt: 'desc' } }),
      ]);
      res.json({ ...reportingDto(r), updates: updates.map(updateDto), payments });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/client/reporting/:id/messages', auth, requireClient, async (req, res) => {
    try {
      const r = await ownReporting(req, req.params.id);
      if (!r) return res.status(404).json({ error: 'Not found.' });
      res.json((await prismaBase.clientMessage.findMany({ where: { reportingId: r.id }, orderBy: { createdAt: 'asc' }, take: 500 })).map(msgDto));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/client/reporting/:id/messages', auth, requireClient, async (req, res) => {
    try {
      const r = await ownReporting(req, req.params.id);
      if (!r) return res.status(404).json({ error: 'Not found.' });
      const body = text(req.body?.body, 4000); const media = cleanMedia(req.body?.media);
      if (!body && !media) return res.status(400).json({ error: 'Write a message or attach a photo.' });
      const row = await prismaBase.clientMessage.create({ data: { reportingId: r.id, senderType: 'client', senderId: req.user.sub, senderName: r.clientName, body, media } });
      if (process.env.LEADS_NOTIFY_EMAIL) notify(process.env.LEADS_NOTIFY_EMAIL, `Site reporting message: ${r.siteName}`, p14(`<b>${r.clientName}</b>: “${(body || 'sent photos').slice(0, 300)}”. Reply in the admin panel under Site reporting.`));
      res.json(msgDto(row));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Pay one or more months through Paystack (M-Pesa or card).
  app.post('/api/client/reporting/:id/pay', auth, requireClient, async (req, res) => {
    try {
      const r = await ownReporting(req, req.params.id);
      if (!r) return res.status(404).json({ error: 'Not found.' });
      if (!['approved', 'active', 'paused'].includes(r.status)) return res.status(409).json({ error: r.status === 'requested' ? 'Our team will confirm your request first. You can pay once it is approved.' : 'This service is not open for payment.' });
      const months = Math.max(1, Math.min(r.months - r.paidMonths || 1, parseInt(req.body?.months, 10) || 1));
      if (r.paidMonths >= r.months) return res.status(409).json({ error: 'All months of this service are already paid.' });
      if (!PAYSTACK_SECRET) return res.status(400).json({ error: 'Online payments aren\'t set up yet. Call or WhatsApp Buildsasa to pay.' });
      const amount = Math.round(r.monthlyFeeKES * months);
      const init = await paystackRequest('/transaction/initialize', 'POST', {
        email: r.clientEmail, amount: amount * 100, currency: 'KES',
        callback_url: `${APP_URL}/?reporting=${r.id}`,
        metadata: { kind: 'site_reporting', reportingId: r.id, months },
      });
      if (!init.status) return res.status(502).json({ error: init.message || 'The payment couldn\'t be started. Please try again.' });
      await prismaBase.siteReportingPayment.create({ data: { reportingId: r.id, amountKES: amount, months, paystackRef: init.data.reference } });
      res.json({ authorizationUrl: init.data.authorization_url, reference: init.data.reference });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /** Mark a site-reporting payment paid exactly once (verify and webhook can both arrive). */
  async function applyReportingPayment(data) {
    const md = (data && data.metadata) || {};
    if (md.kind !== 'site_reporting' || !data.reference) return null;
    const pay = await prismaBase.siteReportingPayment.findUnique({ where: { paystackRef: data.reference } });
    if (!pay) return null;
    const done = await prismaBase.siteReportingPayment.updateMany({ where: { id: pay.id, status: 'pending' }, data: { status: 'paid', paidAt: new Date() } });
    if (!done.count) return { already: true };
    const r = await prismaBase.siteReporting.update({ where: { id: pay.reportingId }, data: { paidMonths: { increment: pay.months } } });
    if (r.status === 'approved') await prismaBase.siteReporting.update({ where: { id: r.id }, data: { status: 'active' } });
    if (process.env.LEADS_NOTIFY_EMAIL) notify(process.env.LEADS_NOTIFY_EMAIL, `Site reporting paid: ${r.siteName}`, p14(`${r.clientName} paid ${kes(pay.amountKES)} (${pay.months} month${pay.months > 1 ? 's' : ''}).`));
    return { paid: true, months: pay.months };
  }
  d.applyReportingPayment = applyReportingPayment;

  app.post('/api/client/reporting/verify', auth, requireClient, async (req, res) => {
    try {
      if (!PAYSTACK_SECRET) return res.status(400).json({ error: 'Payments aren\'t configured.' });
      const ref = String(req.body?.reference || '');
      const v = await paystackRequest(`/transaction/verify/${encodeURIComponent(ref)}`, 'GET');
      if (!(v.status && v.data && v.data.status === 'success')) return res.json({ ok: false, status: v.data?.status || 'failed' });
      const pay = await prismaBase.siteReportingPayment.findUnique({ where: { paystackRef: ref } });
      const r = pay && await ownReporting(req, pay.reportingId);
      if (!r) return res.status(403).json({ error: 'This payment belongs to another account.' });
      res.json({ ok: true, ...(await applyReportingPayment(v.data)) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ───────────────────────── Contractor side ─────────────────────────

  app.get('/api/company/trust', auth, async (req, res) => {
    try {
      const ws = currentWs();
      if (!ws) return res.status(404).json({ error: 'No company for this account' });
      const t = (await trustScores([ws]))[ws];
      const reviews = await prismaBase.contractorRating.findMany({ where: { workspaceId: ws }, orderBy: { updatedAt: 'desc' }, take: 20, select: { clientName: true, stars: true, comment: true, updatedAt: true } });
      res.json({ ...t, reviews, listed: (await activeWorkspaceIds()).includes(ws) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  // Every route below runs as a workspace user; `prisma` is tenant-scoped, and
  // the new tables are checked against currentWs() by hand.

  async function ownProject(projectId) {
    const p = await prisma.project.findUnique({ where: { id: projectId } });
    return p && p.workspaceId === currentWs() ? p : null;
  }

  app.get('/api/projects/:projectId/clients', auth, async (req, res) => {
    try {
      const p = await ownProject(req.params.projectId);
      if (!p) return res.status(404).json({ error: 'Project not found' });
      const rows = await prismaBase.projectClient.findMany({ where: { projectId: p.id }, orderBy: { createdAt: 'asc' } });
      res.json(rows.map((r) => ({ id: r.id, email: r.email, name: r.name, joined: !!r.userId, createdAt: r.createdAt })));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/projects/:projectId/clients', auth, async (req, res) => {
    try {
      if (!hasRole(req, CAN_SHARE_PORTAL)) return res.status(403).json({ error: 'Your role cannot invite clients.' });
      const p = await ownProject(req.params.projectId);
      if (!p) return res.status(404).json({ error: 'Project not found' });
      const email = String(req.body?.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter the client\'s email address.' });
      const existingUser = await prismaBase.user.findUnique({ where: { email } });
      if (existingUser && existingUser.role !== 'Client') return res.status(409).json({ error: 'That email belongs to a company account, not a client. Ask the client for a personal email.' });
      const name = text(req.body?.name, 120);
      const row = await prismaBase.projectClient.upsert({
        where: { projectId_email: { projectId: p.id, email } },
        create: { workspaceId: p.workspaceId, projectId: p.id, email, name, userId: existingUser ? existingUser.id : null, invitedBy: req.user.name || null },
        update: { name: name || undefined },
      });
      const company = await prismaBase.workspace.findUnique({ where: { id: p.workspaceId } });
      const link = `${APP_URL}/?as=client&email=${encodeURIComponent(email)}`;
      notify(email, `${company ? company.name : 'Your contractor'} invited you to follow ${p.name}`,
        p14(`Hi${name ? ` ${name}` : ''}, <b>${company ? company.name : 'your contractor'}</b> is sharing <b>${p.name}</b> with you on Buildsasa. You'll see site photos and short videos of every stage, daily logs, inspections and invoices, approve changes, and chat with the team, from anywhere in the world.`)
        + button(link, existingUser ? 'Open Buildsasa' : 'Create your free client account')
        + `<p style="font-size:12px;color:#8A95A5">Sign up or sign in with ${email} and the project appears automatically.</p>`);
      res.json({ id: row.id, email: row.email, name: row.name, joined: !!row.userId, createdAt: row.createdAt });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/projects/:projectId/clients/:id', auth, async (req, res) => {
    try {
      if (!hasRole(req, CAN_SHARE_PORTAL)) return res.status(403).json({ error: 'Your role cannot remove clients.' });
      const p = await ownProject(req.params.projectId);
      if (!p) return res.status(404).json({ error: 'Project not found' });
      await prismaBase.projectClient.deleteMany({ where: { id: req.params.id, projectId: p.id } });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Progress updates shared with the client. Any team member can post (site
  // managers, foremen, an inspector the contractor added to the team).
  app.get('/api/projects/:projectId/client-updates', auth, async (req, res) => {
    try {
      const p = await ownProject(req.params.projectId);
      if (!p) return res.status(404).json({ error: 'Project not found' });
      res.json((await prismaBase.clientUpdate.findMany({ where: { projectId: p.id }, orderBy: { createdAt: 'desc' }, take: 200 })).map(updateDto));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/projects/:projectId/client-updates', auth, async (req, res) => {
    try {
      const p = await ownProject(req.params.projectId);
      if (!p) return res.status(404).json({ error: 'Project not found' });
      const b = req.body || {};
      const title = text(b.title, 200);
      if (!title) return res.status(400).json({ error: 'Give the update a short title, e.g. "Fence posts set on the north side".' });
      const stage = STAGES.includes(b.stage) ? b.stage : 'other';
      const row = await prismaBase.clientUpdate.create({ data: {
        workspaceId: p.workspaceId, projectId: p.id, stage, kind: UPDATE_KINDS.includes(b.kind) ? b.kind : 'progress',
        title, body: text(b.body, 6000), media: cleanMedia(b.media),
        authorId: req.user.sub, authorName: req.user.name || null, authorRole: req.user.role || null,
      } });
      emailClients(p.id, `New update on ${p.name}: ${title}`, `<b>${req.user.name || 'Your contractor'}</b> shared an update on <b>${p.name}</b>: “${title}”${parse(row.media).length ? ` with ${parse(row.media).length} photo${parse(row.media).length > 1 ? 's/videos' : ''}` : ''}.`);
      res.json(updateDto(row));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/projects/:projectId/client-updates/:id', auth, async (req, res) => {
    try {
      const p = await ownProject(req.params.projectId);
      if (!p) return res.status(404).json({ error: 'Project not found' });
      const u = await prismaBase.clientUpdate.findUnique({ where: { id: req.params.id } });
      if (!u || u.projectId !== p.id) return res.status(404).json({ error: 'Update not found' });
      if (u.authorId !== req.user.sub && !hasRole(req, CAN_SHARE_PORTAL)) return res.status(403).json({ error: 'Only the author or a manager can remove this update.' });
      await prismaBase.clientUpdate.delete({ where: { id: u.id } });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/projects/:projectId/client-messages', auth, async (req, res) => {
    try {
      const p = await ownProject(req.params.projectId);
      if (!p) return res.status(404).json({ error: 'Project not found' });
      res.json((await prismaBase.clientMessage.findMany({ where: { projectId: p.id }, orderBy: { createdAt: 'asc' }, take: 500 })).map(msgDto));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/projects/:projectId/client-messages', auth, async (req, res) => {
    try {
      const p = await ownProject(req.params.projectId);
      if (!p) return res.status(404).json({ error: 'Project not found' });
      const body = text(req.body?.body, 4000); const media = cleanMedia(req.body?.media);
      if (!body && !media) return res.status(400).json({ error: 'Write a message or attach a photo.' });
      const row = await prismaBase.clientMessage.create({ data: { workspaceId: p.workspaceId, projectId: p.id, senderType: 'team', senderId: req.user.sub, senderName: req.user.name || 'Site team', body, media } });
      emailClients(p.id, `New message about ${p.name}`, `<b>${req.user.name || 'Your contractor'}</b>: “${(body || 'sent photos').slice(0, 300)}”`);
      res.json(msgDto(row));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Share or unshare an inspection with the client.
  app.post('/api/inspections/:id/client-visible', auth, async (req, res) => {
    try {
      const i = await prisma.inspection.findUnique({ where: { id: req.params.id } });
      if (!i) return res.status(404).json({ error: 'Inspection not found' });
      const visible = !!req.body?.visible;
      await prisma.inspection.update({ where: { id: i.id }, data: { clientVisible: visible } });
      if (visible && !i.clientVisible) {
        const p = await prismaBase.project.findUnique({ where: { id: i.projectId } });
        if (p) emailClients(p.id, `Inspection shared on ${p.name}`, `The <b>${i.type}</b> inspection (${i.status.replace(/_/g, ' ')}) is now visible to you in Buildsasa.`);
      }
      res.json({ ok: true, clientVisible: visible });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ───────────────────────── Buildsasa staff ─────────────────────────

  app.get('/api/admin/site-reporting', auth, requireStaff, async (_req, res) => {
    try { res.json((await prismaBase.siteReporting.findMany({ orderBy: { createdAt: 'desc' } })).map(reportingDto)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/admin/site-reporting/:id', auth, requireStaff, async (req, res) => {
    try {
      const r = await prismaBase.siteReporting.findUnique({ where: { id: req.params.id } });
      if (!r) return res.status(404).json({ error: 'Not found' });
      const [updates, messages, payments] = await Promise.all([
        prismaBase.clientUpdate.findMany({ where: { reportingId: r.id }, orderBy: { createdAt: 'desc' } }),
        prismaBase.clientMessage.findMany({ where: { reportingId: r.id }, orderBy: { createdAt: 'asc' } }),
        prismaBase.siteReportingPayment.findMany({ where: { reportingId: r.id }, orderBy: { createdAt: 'desc' } }),
      ]);
      res.json({ ...reportingDto(r), updates: updates.map(updateDto), messages: messages.map(msgDto), payments });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/admin/site-reporting/:id', auth, requireStaff, async (req, res) => {
    try {
      const b = req.body || {}; const data = {};
      const before = await prismaBase.siteReporting.findUnique({ where: { id: req.params.id } });
      if (!before) return res.status(404).json({ error: 'Not found' });
      if (['requested', 'approved', 'active', 'paused', 'ended', 'declined'].includes(b.status)) data.status = b.status;
      if (b.adminNote !== undefined) data.adminNote = text(b.adminNote, 4000);
      if (b.inspectorName !== undefined) data.inspectorName = text(b.inspectorName, 120);
      if (b.monthlyFeeKES !== undefined && Number(b.monthlyFeeKES) > 0) data.monthlyFeeKES = Math.round(Number(b.monthlyFeeKES));
      if (b.months !== undefined && parseInt(b.months, 10) > 0) data.months = Math.min(60, parseInt(b.months, 10));
      if (b.paidMonths !== undefined && parseInt(b.paidMonths, 10) >= 0) data.paidMonths = parseInt(b.paidMonths, 10); // offline payments
      const r = await prismaBase.siteReporting.update({ where: { id: before.id }, data });
      if (data.status === 'approved' && before.status !== 'approved') {
        notify(r.clientEmail, `Site reporting approved: ${r.siteName}`, p14(`Good news, ${r.clientName}. We'll report on <b>${r.siteName}</b>${r.inspectorName ? `, with ${r.inspectorName} as your site reporter` : ''}. Pay the first month (${kes(r.monthlyFeeKES)}) in Buildsasa to start visits. Transport and lunch for each visit are paid separately, as agreed with our team.`) + button(`${APP_URL}/?as=client`, 'Open Buildsasa'));
      }
      res.json(reportingDto(r));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/admin/site-reporting/:id/updates', auth, requireStaff, async (req, res) => {
    try {
      const r = await prismaBase.siteReporting.findUnique({ where: { id: req.params.id } });
      if (!r) return res.status(404).json({ error: 'Not found' });
      const b = req.body || {}; const title = text(b.title, 200);
      if (!title) return res.status(400).json({ error: 'Give the report a title.' });
      const row = await prismaBase.clientUpdate.create({ data: {
        reportingId: r.id, projectId: null, stage: STAGES.includes(b.stage) ? b.stage : 'other', kind: UPDATE_KINDS.includes(b.kind) ? b.kind : 'inspection',
        title, body: text(b.body, 8000), media: cleanMedia(b.media), authorId: req.user.sub, authorName: text(b.authorName, 120) || r.inspectorName || req.user.name || 'Buildsasa', authorRole: 'Buildsasa',
      } });
      notify(r.clientEmail, `New site report: ${r.siteName}`, p14(`Buildsasa visited <b>${r.siteName}</b>: “${title}”. See the photos and full report in Buildsasa.`) + button(`${APP_URL}/?as=client`, 'View the report'));
      res.json(updateDto(row));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/admin/site-reporting/:id/updates/:uid', auth, requireStaff, async (req, res) => {
    try { await prismaBase.clientUpdate.deleteMany({ where: { id: req.params.uid, reportingId: req.params.id } }); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/admin/site-reporting/:id/messages', auth, requireStaff, async (req, res) => {
    try {
      const r = await prismaBase.siteReporting.findUnique({ where: { id: req.params.id } });
      if (!r) return res.status(404).json({ error: 'Not found' });
      const body = text(req.body?.body, 4000); const media = cleanMedia(req.body?.media);
      if (!body && !media) return res.status(400).json({ error: 'Write a message or attach a photo.' });
      const row = await prismaBase.clientMessage.create({ data: { reportingId: r.id, senderType: 'buildsasa', senderId: req.user.sub, senderName: 'Buildsasa team', body, media } });
      notify(r.clientEmail, `Message from Buildsasa about ${r.siteName}`, p14(`“${(body || 'sent photos').slice(0, 300)}”`) + button(`${APP_URL}/?as=client`, 'Reply in Buildsasa'));
      res.json(msgDto(row));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/admin/clients', auth, requireStaff, async (_req, res) => {
    try {
      const rows = await prismaBase.user.findMany({ where: { role: 'Client' }, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, email: true, phone: true, country: true, createdAt: true, status: true } });
      const links = await prismaBase.projectClient.groupBy({ by: ['userId'], where: { userId: { in: rows.map((r) => r.id) } }, _count: { _all: true } }).catch(() => []);
      const n = Object.fromEntries(links.map((l) => [l.userId, l._count._all]));
      res.json(rows.map((r) => ({ ...r, projects: n[r.id] || 0 })));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};

module.exports.STAGES = STAGES;
