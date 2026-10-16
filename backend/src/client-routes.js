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
const UPDATE_KINDS = ['progress', 'inspection', 'milestone', 'issue', 'report', 'document'];
const COMMENT_TARGETS = ['update', 'inspection', 'dailylog', 'quote', 'changeorder', 'selection', 'invoice'];
const REPORTING_FEE_PERCENT = 10;

module.exports = function clientRoutes(app, d) {
  const { prisma, prismaBase, auth, currentWs, hasRole, CAN_SHARE_PORTAL, sendEmail, emailShell, button,
    paystackRequest, PAYSTACK_SECRET, isPlatformAdmin, portalPayload, companyPublic, APP_URL, freeAccessEmails } = d;

  const text = (v, max = 2000) => { const s = String(v == null ? '' : v).trim(); return s ? s.slice(0, max) : null; };
  const parse = (v) => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
  // Only durable http(s) URLs, typed as image or video, at most 30 per post.
  const cleanMedia = (v) => {
    const arr = Array.isArray(v) ? v : parse(v);
    const out = arr.map((m) => (typeof m === 'string' ? { url: m } : m))
      .filter((m) => m && typeof m.url === 'string' && /^https?:\/\//i.test(m.url))
      .slice(0, 30)
      .map((m) => ({ url: m.url, name: m.name ? String(m.name).slice(0, 160) : undefined, type: m.type === 'video' || /\.(mp4|mov|webm|m4v|3gp)(\?|$)/i.test(m.url) ? 'video' : m.type === 'file' || /\.(pdf|docx?|xlsx?|pptx?|csv|txt|dwg|dxf|zip)(\?|$)/i.test(m.url) ? 'file' : 'image' }));
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
    // Comped companies (Buildsasa staff, FREE_ACCESS_EMAILS) never pay, so they have
    // no subscription row but are just as active.
    const comped = freeAccessEmails ? await prismaBase.user.findMany({ where: { email: { in: freeAccessEmails() }, workspaceId: { not: null } }, select: { workspaceId: true } }) : [];
    // Companies still inside their free trial (see TRIAL_DAYS in server.js).
    const trialDays = d.trialDays || 0;
    const trial = trialDays ? await prismaBase.workspace.findMany({ where: { createdAt: { gt: new Date(now - trialDays * 864e5) } }, select: { id: true } }) : [];
    return [...new Set([...subs.filter((s) => !s.currentPeriodEnd || new Date(s.currentPeriodEnd).getTime() > now).map((s) => s.workspaceId), ...comped.map((u) => u.workspaceId), ...trial.map((w) => w.id)])];
  }

  // Best-effort email; never blocks a request.
  const notify = (to, subject, html) => { if (to) sendEmail({ to, subject, html: emailShell(subject, html) }).catch(() => {}); };
  const p14 = (s) => `<p style="font-size:14px;color:#11161D">${s}</p>`;
  async function emailClients(projectId, subject, line) {
    const links = await prismaBase.projectClient.findMany({ where: { projectId } });
    for (const l of links) notify(l.email, subject, p14(line) + button(`${APP_URL}/?as=client&project=${projectId}`, 'Open Buildsasa'));
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
  d.activeWorkspaceIds = activeWorkspaceIds;

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
      if (u.workspaceId) {
        const assigned = await prismaBase.assignment.findMany({ where: { userId: u.id }, select: { projectId: true } });
        for (const a of assigned) {
          await prismaBase.projectClient.upsert({ where: { projectId_email: { projectId: a.projectId, email: u.email.toLowerCase() } }, create: { workspaceId: u.workspaceId, projectId: a.projectId, email: u.email.toLowerCase(), name: u.name, userId: u.id, invitedBy: 'Team' }, update: { userId: u.id } }).catch(() => {});
        }
      }
      const links = await prismaBase.projectClient.findMany({ where: { OR: [{ userId: u.id }, { email: u.email.toLowerCase() }] } });
      const ids = [...new Set(links.map((l) => l.projectId))];
      const [projects, reporting, jobs] = await Promise.all([
        prismaBase.project.findMany({ where: { id: { in: ids } } }),
        prismaBase.siteReporting.findMany({ where: { clientUserId: u.id }, orderBy: { createdAt: 'desc' } }),
        prismaBase.job.findMany({ where: { clientUserId: u.id }, orderBy: { createdAt: 'desc' }, include: { _count: { select: { bids: true } } } }),
      ]);
      const awarded = jobs.length ? await prismaBase.jobBid.findMany({ where: { jobId: { in: jobs.map((j) => j.id) }, status: 'awarded' } }) : [];
      const wsIds = [...new Set(projects.map((p) => p.workspaceId).filter(Boolean))];
      const companies = await prismaBase.workspace.findMany({ where: { id: { in: wsIds } } });
      const activeWs = new Set(await activeWorkspaceIds());
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
      ];
      res.json({
        user: { name: u.name, email: u.email, phone: u.phone, country: u.country },
        projects: projects.map((p) => ({
          id: p.id, name: p.name, city: p.city, status: p.status, progress: p.progress, startDate: p.startDate, targetEndDate: p.targetEndDate,
          cover: parse(p.images)[0] || null, company: companyPublic(byWs[p.workspaceId]), companyActive: activeWs.has(p.workspaceId),
          lastUpdate: (() => { const x = lastUpdates.find((l) => l.projectId === p.id); return x ? { title: x.title, stage: x.stage, createdAt: x.createdAt } : null; })(),
        })),
        todo,
        reporting,
        jobs: jobs.map((j) => {
          const w = awarded.find((b) => b.jobId === j.id);
          return {
            id: j.id, title: j.title, category: j.category, location: j.location, description: j.description, budgetKES: j.budgetKES, deadline: j.deadline,
            targetWorkspaceId: j.targetWorkspaceId, status: j.status, approval: j.approval, bidCount: j._count.bids, createdAt: j.createdAt,
            awardedBid: w ? { id: w.id, workspaceId: w.workspaceId, companyName: w.companyName, contactName: w.contactName, phone: w.phone, email: w.email, amountKES: w.amountKES, timelineDays: w.timelineDays } : null,
            sharedProjectId: w ? (projects.find((p) => p.workspaceId === w.workspaceId) || {}).id || null : null,
          };
        }),
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
        // A lapsed contractor subscription never locks the client out: what was
        // shared stays theirs to see. The flag only explains why the team may be
        // slow to reply and why new updates may pause.
        id: p.id, companyId: p.workspaceId, companyActive: (await activeWorkspaceIds()).includes(p.workspaceId), portalToken: token, ...portal,
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
      const thread = req.query.thread && req.query.thread !== 'group' ? String(req.query.thread) : null;
      const rows = await prismaBase.clientMessage.findMany({ where: { projectId: hit.p.id, threadUserId: thread }, orderBy: { createdAt: 'asc' }, take: 500 });
      res.json(rows.map(msgDto));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/client/projects/:id/messages', auth, requireClient, async (req, res) => {
    try {
      const hit = await linkedProject(req, req.params.id);
      if (!hit) return res.status(404).json({ error: 'This site isn\'t linked to your account.' });
      const body = text(req.body?.body, 4000); const media = cleanMedia(req.body?.media);
      if (!body && !media) return res.status(400).json({ error: 'Write a message or attach a photo.' });
      // A private reply is only allowed into a thread a team member opened.
      let thread = req.body?.threadUserId ? String(req.body.threadUserId) : null;
      if (thread && !(await prismaBase.clientMessage.findFirst({ where: { projectId: hit.p.id, threadUserId: thread } }))) thread = null;
      const row = await prismaBase.clientMessage.create({ data: { workspaceId: hit.p.workspaceId, projectId: hit.p.id, threadUserId: thread, senderType: 'client', senderId: hit.u.id, senderName: hit.u.name, body, media } });
      if (thread) {
        const t = await prismaBase.user.findUnique({ where: { id: thread }, select: { email: true } });
        if (t) notify(t.email, `Private message from your client on ${hit.p.name}`, p14(`<b>${hit.u.name}</b> wrote: “${(body || 'sent photos').slice(0, 300)}”. Reply in the project's Client tab, Private chat.`) + button(APP_URL, 'Open Buildsasa'));
      } else emailTeam(hit.p.workspaceId, `New message from your client on ${hit.p.name}`, `<b>${hit.u.name}</b> wrote: “${(body || 'sent photos').slice(0, 300)}”. Reply from the project's Client tab.`);
      res.json(msgDto(row));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Private chats a team member has opened with this client on a site.
  app.get('/api/client/projects/:id/threads', auth, requireClient, async (req, res) => {
    try {
      const hit = await linkedProject(req, req.params.id);
      if (!hit) return res.status(404).json({ error: 'This site isn\'t linked to your account.' });
      const rows = await prismaBase.clientMessage.findMany({ where: { projectId: hit.p.id, threadUserId: { not: null } }, select: { threadUserId: true, createdAt: true }, orderBy: { createdAt: 'desc' } });
      const ids = [...new Set(rows.map((r) => r.threadUserId))];
      const users = await prismaBase.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, role: true } });
      res.json(ids.map((id) => { const u = users.find((x) => x.id === id); return { userId: id, name: u ? u.name : 'Team member', role: u ? u.role : null }; }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Comments on shared items, all of a site's at once (the client app groups them).
  app.get('/api/client/projects/:id/comments', auth, requireClient, async (req, res) => {
    try {
      const hit = await linkedProject(req, req.params.id);
      if (!hit) return res.status(404).json({ error: 'This site isn\'t linked to your account.' });
      res.json((await prismaBase.clientComment.findMany({ where: { projectId: hit.p.id }, orderBy: { createdAt: 'asc' }, take: 1000 })).map(msgDto));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/client/projects/:id/comments', auth, requireClient, async (req, res) => {
    try {
      const hit = await linkedProject(req, req.params.id);
      if (!hit) return res.status(404).json({ error: 'This site isn\'t linked to your account.' });
      const b = req.body || {};
      if (!COMMENT_TARGETS.includes(b.targetType) || !b.targetId) return res.status(400).json({ error: 'What are you commenting on?' });
      const body = text(b.body, 3000); const media = cleanMedia(b.media);
      if (!body && !media) return res.status(400).json({ error: 'Write a comment or attach a photo.' });
      const row = await prismaBase.clientComment.create({ data: { workspaceId: hit.p.workspaceId, projectId: hit.p.id, targetType: b.targetType, targetId: String(b.targetId), authorType: 'client', authorId: hit.u.id, authorName: hit.u.name, body, media } });
      emailTeam(hit.p.workspaceId, `Your client commented on ${hit.p.name}`, `<b>${hit.u.name}</b> commented on a shared ${b.targetType === 'dailylog' ? 'daily log' : b.targetType === 'changeorder' ? 'change order' : b.targetType}: “${(body || 'sent photos').slice(0, 300)}”. Reply from the project's Client tab, Client feedback.`);
      res.json(msgDto(row));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Quotes and proposals sent to this client's email, from any company.
  app.get('/api/client/quotes', auth, requireClient, async (req, res) => {
    try {
      const u = await me(req);
      const qs = await prismaBase.quote.findMany({ where: { clientEmail: { equals: u.email, mode: 'insensitive' }, publicToken: { not: null }, status: { in: ['sent', 'accepted', 'declined'] } }, orderBy: { createdAt: 'desc' } });
      const ws = await prismaBase.workspace.findMany({ where: { id: { in: qs.map((q) => q.workspaceId).filter(Boolean) } }, select: { id: true, name: true } });
      const comments = await prismaBase.clientComment.findMany({ where: { targetType: 'quote', targetId: { in: qs.map((q) => q.id) } }, orderBy: { createdAt: 'asc' } });
      res.json(qs.map((q) => ({ id: q.id, token: q.publicToken, quoteNumber: q.quoteNumber, title: q.title, total: q.total, status: q.status, validUntil: q.validUntil, sentAt: q.sentAt, company: (ws.find((w) => w.id === q.workspaceId) || {}).name || 'Your contractor', comments: comments.filter((c) => c.targetId === q.id).map(msgDto) })));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/client/quotes/:id/comments', auth, requireClient, async (req, res) => {
    try {
      const u = await me(req);
      const q = await prismaBase.quote.findUnique({ where: { id: req.params.id } });
      if (!q || !q.clientEmail || q.clientEmail.toLowerCase() !== u.email.toLowerCase() || !q.publicToken) return res.status(404).json({ error: 'Quote not found.' });
      const body = text(req.body?.body, 3000); const media = cleanMedia(req.body?.media);
      if (!body && !media) return res.status(400).json({ error: 'Write a comment or attach a photo.' });
      const row = await prismaBase.clientComment.create({ data: { workspaceId: q.workspaceId, projectId: q.projectId || null, targetType: 'quote', targetId: q.id, authorType: 'client', authorId: u.id, authorName: u.name, body, media } });
      emailTeam(q.workspaceId, `${u.name} commented on quote ${q.quoteNumber}`, `“${(body || 'sent photos').slice(0, 300)}” on <b>${q.title}</b>. Open Quotes in Buildsasa to reply or revise it.`);
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
      if (stars <= 2) emailTeam(req.params.id, `A client rated your company ${stars}/5`, `<b>${u.name}</b> gave your company ${stars} star${stars > 1 ? 's' : ''}${comment ? `: “${comment.slice(0, 300)}”` : '.'} Reach out to the client to put things right.`);
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

  async function ownJob(req) {
    const job = await prismaBase.job.findUnique({ where: { id: req.params.id } });
    return job && job.clientUserId === req.user.sub ? job : null;
  }

  // Decline one bid on your own job. The company is told politely.
  app.post('/api/client/jobs/:id/bids/:bidId/decline', auth, requireClient, async (req, res) => {
    try {
      const job = await ownJob(req);
      if (!job) return res.status(404).json({ error: 'Job not found.' });
      const bid = await prismaBase.jobBid.findUnique({ where: { id: req.params.bidId } });
      if (!bid || bid.jobId !== job.id) return res.status(404).json({ error: 'Bid not found.' });
      if (bid.status === 'awarded') return res.status(409).json({ error: 'This bid was awarded and can\'t be declined here. Message Buildsasa if plans changed.' });
      await prismaBase.jobBid.update({ where: { id: bid.id }, data: { status: 'rejected' } });
      if (bid.email) notify(bid.email, `Update on your bid: ${job.title}`, p14(`Thank you for bidding on “${job.title}”. The client has chosen not to go ahead with your bid this time. Keep logging your site work and keeping clients happy on Buildsasa; it helps you win the next one.`));
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Edit your own job before it's awarded. Changes go back to Buildsasa for a quick check.
  app.put('/api/client/jobs/:id', auth, requireClient, async (req, res) => {
    try {
      const job = await ownJob(req);
      if (!job) return res.status(404).json({ error: 'Job not found.' });
      if (job.status === 'awarded') return res.status(409).json({ error: 'This job has been awarded, so it can\'t be edited.' });
      const b = req.body || {};
      const data = {};
      for (const k of ['title', 'category', 'location']) if (b[k] !== undefined) data[k] = text(b[k], k === 'location' ? 300 : 200);
      if (b.description !== undefined) data.description = text(b.description, 8000);
      if (data.title === null || data.description === null || data.category === null) return res.status(400).json({ error: 'A job needs a title, a type of work and a description.' });
      if (b.budgetKES !== undefined) data.budgetKES = Number(b.budgetKES) > 0 ? Number(b.budgetKES) : null;
      if (b.deadline !== undefined) data.deadline = /^\d{4}-\d{2}-\d{2}$/.test(String(b.deadline || '')) ? b.deadline : null;
      if (b.targetWorkspaceId !== undefined) {
        if (b.targetWorkspaceId && !(await activeWorkspaceIds()).includes(b.targetWorkspaceId)) return res.status(400).json({ error: 'That company isn\'t available right now.' });
        data.targetWorkspaceId = b.targetWorkspaceId || null;
      }
      // Approved jobs that change go back for a quick check, so contractors never see unchecked text.
      if (job.approval === 'approved' && (data.title || data.description)) data.approval = 'pending';
      const row = await prismaBase.job.update({ where: { id: job.id }, data });
      if (data.approval === 'pending' && process.env.LEADS_NOTIFY_EMAIL) notify(process.env.LEADS_NOTIFY_EMAIL, `Client edited a job: ${row.title}`, p14('Re-approve it in the admin panel under Jobs.'));
      res.json(row);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Delete your own job (not once it's awarded: that's a commitment to a company).
  app.delete('/api/client/jobs/:id', auth, requireClient, async (req, res) => {
    try {
      const job = await ownJob(req);
      if (!job) return res.status(404).json({ error: 'Job not found.' });
      if (job.status === 'awarded') return res.status(409).json({ error: 'This job has been awarded, so it can\'t be deleted. Message Buildsasa if plans changed.' });
      const bids = await prismaBase.jobBid.findMany({ where: { jobId: job.id }, select: { email: true } });
      await prismaBase.job.delete({ where: { id: job.id } });
      for (const bd of bids) if (bd.email) notify(bd.email, `Job withdrawn: ${job.title}`, p14(`The client has withdrawn “${job.title}”, so your bid is closed. Thank you for bidding.`));
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Stop following a project someone shared with you.
  app.delete('/api/client/projects/:id', auth, requireClient, async (req, res) => {
    try {
      const u = await me(req);
      await prismaBase.projectClient.deleteMany({ where: { projectId: req.params.id, OR: [{ userId: u.id }, { email: u.email.toLowerCase() }] } });
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
        prismaBase.siteReportingPayment.findMany({ where: { reportingId: r.id, status: 'paid' }, orderBy: { paidAt: 'desc' } }).then((ps) => ps.map((p) => ({ id: p.id, amountKES: p.amountKES, months: p.months, paidAt: p.paidAt, method: p.paystackRef.startsWith('offline:') ? p.paystackRef.split(':')[1] : 'Online' }))),
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

  // Site reporting is paid off the platform (M-Pesa, bank, Wise…) after a call
  // with the Buildsasa team, who record each payment in the admin panel. The
  // client never starts a payment here; there is deliberately no checkout route.

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


  async function ownProject(projectId) {
    const p = await prisma.project.findUnique({ where: { id: projectId } });
    return p && p.workspaceId === currentWs() ? p : null;
  }
  // Sharing needs someone to share with: an invited client (joined or not yet).
  // Without one, updates and messages would be saved for nobody.
  const NO_CLIENT = 'Invite the client to this project first (Client access, above). Then updates and messages reach them.';
  const hasClient = async (projectId) => !!(await prismaBase.projectClient.findFirst({ where: { projectId }, select: { id: true } }));

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
      if (existingUser && existingUser.role !== 'Client') {
        // Someone the contractor added to its own team (often as a viewer) can be
        // moved to a client account, keeping their login, so they get the client panel.
        const sameTeam = existingUser.workspaceId === p.workspaceId;
        const owner = ['Contractor', 'Owner', 'Executive'].includes(existingUser.role);
        if (sameTeam && !owner && req.body?.convert === true) {
          await prismaBase.user.update({ where: { id: existingUser.id }, data: { role: 'Client' } });
          existingUser.role = 'Client';
        } else if (sameTeam && !owner) {
          return res.status(409).json({ code: 'team_member', error: `${existingUser.name} is on your team as ${existingUser.role}. Move them to a client account so they get the client panel? They keep the same login.` });
        } else return res.status(409).json({ error: 'That email belongs to a company account, not a client. Ask the client for a personal email.' });
      }
      const name = text(req.body?.name, 120);
      const row = await prismaBase.projectClient.upsert({
        where: { projectId_email: { projectId: p.id, email } },
        create: { workspaceId: p.workspaceId, projectId: p.id, email, name, userId: existingUser ? existingUser.id : null, invitedBy: req.user.name || null },
        update: { name: name || undefined, ...(existingUser ? { userId: existingUser.id } : {}) },
      });
      const company = await prismaBase.workspace.findUnique({ where: { id: p.workspaceId } });
      // Existing clients go to sign-in, new ones to sign-up; both open this project.
      const link = `${APP_URL}/?as=client&email=${encodeURIComponent(email)}&project=${p.id}${existingUser ? '' : '&signup=1'}`;
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
      if (!(await hasClient(p.id))) return res.status(409).json({ error: NO_CLIENT });
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
      // The team chat is visible to everyone on the team; a private chat only to its owner.
      const thread = req.query.thread === 'private' ? req.user.sub : null;
      res.json((await prismaBase.clientMessage.findMany({ where: { projectId: p.id, threadUserId: thread }, orderBy: { createdAt: 'asc' }, take: 500 })).map(msgDto));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/projects/:projectId/client-messages', auth, async (req, res) => {
    try {
      const p = await ownProject(req.params.projectId);
      if (!p) return res.status(404).json({ error: 'Project not found' });
      if (!(await hasClient(p.id))) return res.status(409).json({ error: NO_CLIENT });
      const body = text(req.body?.body, 4000); const media = cleanMedia(req.body?.media);
      if (!body && !media) return res.status(400).json({ error: 'Write a message or attach a photo.' });
      const row = await prismaBase.clientMessage.create({ data: { workspaceId: p.workspaceId, projectId: p.id, threadUserId: req.body?.private ? req.user.sub : null, senderType: 'team', senderId: req.user.sub, senderName: req.user.name || 'Site team', body, media } });
      emailClients(p.id, `New message about ${p.name}`, `<b>${req.user.name || 'Your contractor'}</b>: “${(body || 'sent photos').slice(0, 300)}”`);
      res.json(msgDto(row));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/projects/:projectId/client-comments', auth, async (req, res) => {
    try {
      const p = await ownProject(req.params.projectId);
      if (!p) return res.status(404).json({ error: 'Project not found' });
      res.json((await prismaBase.clientComment.findMany({ where: { projectId: p.id }, orderBy: { createdAt: 'asc' }, take: 1000 })).map(msgDto));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/projects/:projectId/client-comments', auth, async (req, res) => {
    try {
      const p = await ownProject(req.params.projectId);
      if (!p) return res.status(404).json({ error: 'Project not found' });
      const b = req.body || {};
      if (!COMMENT_TARGETS.includes(b.targetType) || !b.targetId) return res.status(400).json({ error: 'What are you replying to?' });
      const body = text(b.body, 3000); const media = cleanMedia(b.media);
      if (!body && !media) return res.status(400).json({ error: 'Write a reply or attach a photo.' });
      const row = await prismaBase.clientComment.create({ data: { workspaceId: p.workspaceId, projectId: p.id, targetType: b.targetType, targetId: String(b.targetId), authorType: 'team', authorId: req.user.sub, authorName: req.user.name || 'Site team', body, media } });
      emailClients(p.id, `${req.user.name || 'Your contractor'} replied on ${p.name}`, `“${(body || 'sent photos').slice(0, 300)}”`);
      res.json(msgDto(row));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Client comments on a quote, and the team's reply (Quotes page).
  app.get('/api/quotes/:id/client-comments', auth, async (req, res) => {
    try {
      const q = await prisma.quote.findUnique({ where: { id: req.params.id } });
      if (!q || q.workspaceId !== currentWs()) return res.status(404).json({ error: 'Quote not found' });
      res.json((await prismaBase.clientComment.findMany({ where: { targetType: 'quote', targetId: q.id }, orderBy: { createdAt: 'asc' } })).map(msgDto));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/quotes/:id/client-comments', auth, async (req, res) => {
    try {
      const q = await prisma.quote.findUnique({ where: { id: req.params.id } });
      if (!q || q.workspaceId !== currentWs()) return res.status(404).json({ error: 'Quote not found' });
      const body = text(req.body?.body, 3000); const media = cleanMedia(req.body?.media);
      if (!body && !media) return res.status(400).json({ error: 'Write a reply or attach a photo.' });
      const row = await prismaBase.clientComment.create({ data: { workspaceId: q.workspaceId, projectId: q.projectId || null, targetType: 'quote', targetId: q.id, authorType: 'team', authorId: req.user.sub, authorName: req.user.name || 'Your contractor', body, media } });
      if (q.clientEmail) notify(q.clientEmail, `Reply about quote ${q.quoteNumber}`, p14(`“${(body || 'sent photos').slice(0, 300)}”`) + button(`${APP_URL}/?as=client`, 'Open Buildsasa'));
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
        notify(r.clientEmail, `Site reporting approved: ${r.siteName}`, p14(`Good news, ${r.clientName}. We'll report on <b>${r.siteName}</b>${r.inspectorName ? `, with ${r.inspectorName} as your site reporter` : ''}. Our team will share how to pay the first month (${kes(r.monthlyFeeKES)}); visits start once it is received. Transport and lunch for each visit are paid separately, as agreed with our team.`) + button(`${APP_URL}/?as=client`, 'Open Buildsasa'));
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

  // Record a payment received off the platform. Adds the months, starts an
  // approved service, and the client sees it as a receipt.
  app.post('/api/admin/site-reporting/:id/payments', auth, requireStaff, async (req, res) => {
    try {
      const r = await prismaBase.siteReporting.findUnique({ where: { id: req.params.id } });
      if (!r) return res.status(404).json({ error: 'Not found' });
      const months = Math.max(1, Math.min(60, parseInt(req.body?.months, 10) || 1));
      const amountKES = Number(req.body?.amountKES);
      if (!(amountKES > 0)) return res.status(400).json({ error: 'Enter the amount received in KES.' });
      const method = text(req.body?.method, 60) || 'Offline';
      const reference = text(req.body?.reference, 120);
      const pay = await prismaBase.siteReportingPayment.create({ data: {
        reportingId: r.id, amountKES, months, status: 'paid', paidAt: new Date(),
        // paystackRef is unique and required; offline payments get their own key.
        paystackRef: `offline:${method}:${reference || ''}:${Date.now()}`,
      } });
      const next = await prismaBase.siteReporting.update({ where: { id: r.id }, data: { paidMonths: { increment: months }, ...(r.status === 'approved' || r.status === 'requested' ? { status: 'active' } : {}) } });
      notify(r.clientEmail, `Payment received: ${r.siteName}`, p14(`Thank you, ${r.clientName}. We received ${kes(amountKES)} (${method}${reference ? `, ref ${reference}` : ''}) for ${months} month${months > 1 ? 's' : ''} of site reporting on <b>${r.siteName}</b>. ${next.paidMonths} of ${next.months} months are now paid.`) + button(`${APP_URL}/?as=client`, 'Open Buildsasa'));
      res.json({ payment: pay, reporting: reportingDto(next) });
    } catch (e) { res.status(500).json({ error: e.message }); }
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
