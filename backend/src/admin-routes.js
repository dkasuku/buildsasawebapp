// ===========================================================================
// PLATFORM ADMIN + PUBLIC LEAD ROUTES
//
// Two groups of endpoints live here:
//
//   /api/public/*  — no auth. Called by the marketing site to submit contact
//                    forms and demo requests, and to read editable content.
//                    Rate-limited and field-capped since anyone can hit them.
//
//   /api/admin/*   — platform staff only (PLATFORM_ADMIN_EMAILS). Manages the
//                    lead inbox, customer workspaces/users, billing, and site
//                    content.
//
// IMPORTANT — why every admin query uses `prismaBase` and not `prisma`:
// server.js wraps Prisma in an extension that force-scopes tenant models to the
// caller's workspaceId (from their JWT). That is exactly what we want for
// customer requests, but an admin needs to see ACROSS all workspaces. The
// scoped client would silently filter every User/Subscription/Invoice query
// down to the admin's own workspace and the panel would look empty. So admin
// handlers deliberately use the unscoped client, with the requirePlatformAdmin
// guard as the thing standing between them and the data.
// ===========================================================================

module.exports = function mountAdminRoutes(app, deps) {
  const {
    prismaBase,   // unscoped Prisma client — see note above
    auth,         // JWT middleware from server.js
    isPlatformAdmin,
    isRootAdmin,        // email is in PLATFORM_ADMIN_EMAILS (immutable, env-set)
    refreshDbAdmins,    // re-sync the in-memory DB-admin cache after a change
    platformAdminEnv,   // array of lowercased env-var admin emails
    bcrypt,
    sendEmail,
    emailShell,
  } = deps;

  const db = prismaBase;

  // ---------------------------------------------------------------- helpers

  const clientIp = (req) =>
    String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    (req.socket && req.socket.remoteAddress) ||
    '';

  // Trim + hard-cap a string so a hostile submitter can't push 10MB into a
  // column. Returns null for empty values so they stay NULL in the DB.
  const str = (v, max = 500) => {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    if (!s) return null;
    return s.slice(0, max);
  };

  const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || ''));

  const LEAD_KINDS = ['contact', 'demo'];
  const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost'];

  // Naive in-memory rate limiter. Enough to stop casual form spam; a real
  // scaling story would move this to Redis, but the public surface here is two
  // endpoints and the cost of a false negative is one junk row.
  const hits = new Map();
  function rateLimit({ windowMs, max }) {
    return (req, res, next) => {
      const key = `${req.path}:${clientIp(req)}`;
      const now = Date.now();
      const rec = hits.get(key);
      if (!rec || now > rec.reset) {
        hits.set(key, { count: 1, reset: now + windowMs });
        return next();
      }
      rec.count += 1;
      if (rec.count > max) {
        return res.status(429).json({ error: 'Too many submissions. Please try again in a few minutes.' });
      }
      next();
    };
  }

  // Keep the limiter map from growing without bound.
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
  }, 10 * 60 * 1000).unref();

  // Gate for everything under /api/admin. Runs after `auth`, so req.user is the
  // verified JWT payload. Being a workspace "owner" does NOT qualify — only
  // emails listed in PLATFORM_ADMIN_EMAILS get through.
  function requirePlatformAdmin(req, res, next) {
    const email = req.user && req.user.email;
    if (!isPlatformAdmin(email)) {
      return res.status(403).json({ error: 'Forbidden: platform admin access required' });
    }
    next();
  }

  const adminOnly = [auth, requirePlatformAdmin];

  // Append-only audit trail. Never allowed to break the request it describes.
  async function audit(req, action, targetType, targetId, meta) {
    try {
      await db.adminAudit.create({
        data: {
          actorEmail: (req.user && req.user.email) || 'unknown',
          action,
          targetType: targetType || null,
          targetId: targetId || null,
          meta: meta ? JSON.stringify(meta).slice(0, 4000) : null,
          ip: clientIp(req),
        },
      });
    } catch (e) {
      console.error('[ADMIN AUDIT] failed:', e && e.message);
    }
  }

  const fail = (res) => (e) => res.status(500).json({ error: e.message });

  // =========================================================================
  // PUBLIC — marketing site
  // =========================================================================

  // Submit a lead. `kind` is 'contact' (contact form) or 'demo' (demo request).
  // Only ever creates a Lead row — no auth token is involved, so there is no
  // wsStore and the Prisma extension is a pass-through. We never echo back
  // anything from the DB beyond an acknowledgement.
  app.post('/api/public/leads', rateLimit({ windowMs: 10 * 60 * 1000, max: 5 }), async (req, res) => {
    try {
      const b = req.body || {};

      // Honeypot: a hidden field real users never fill in. Bots do. Pretend it
      // worked so the bot doesn't retry, but persist nothing.
      if (str(b.website)) return res.json({ ok: true });

      const kind = LEAD_KINDS.includes(b.kind) ? b.kind : 'contact';
      const name = str(b.name, 120);
      const email = str(b.email, 200);
      if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });
      if (!isEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address' });

      let preferredDate = null;
      if (b.preferredDate) {
        const d = new Date(b.preferredDate);
        if (!isNaN(d.getTime())) preferredDate = d;
      }

      const lead = await db.lead.create({
        data: {
          kind,
          name,
          email: email.toLowerCase(),
          phone: str(b.phone, 40),
          company: str(b.company, 160),
          interest: str(b.interest, 80),
          message: str(b.message, 5000),
          companySize: str(b.companySize, 40),
          role: str(b.role, 120),
          preferredDate,
          useCase: str(b.useCase, 2000),
          source: kind === 'demo' ? 'landing_demo' : 'website',
          pageUrl: str(b.pageUrl, 400),
          referrer: str(req.headers.referer, 400),
          ip: clientIp(req),
          userAgent: str(req.headers['user-agent'], 400),
        },
      });

      // Notify the team, but never let a mail failure fail the submission —
      // the lead is already safely in the database at this point.
      const notify = String(process.env.LEADS_NOTIFY_EMAIL || '').trim();
      if (notify) {
        const label = kind === 'demo' ? 'demo request' : 'contact form submission';
        const rows = [
          ['Name', lead.name],
          ['Email', lead.email],
          ['Phone', lead.phone],
          ['Company', lead.company],
          ['Interest', lead.interest],
          ['Company size', lead.companySize],
          ['Role', lead.role],
          ['Preferred date', lead.preferredDate ? lead.preferredDate.toDateString() : null],
          ['Message', lead.message || lead.useCase],
        ].filter(([, v]) => v);
        sendEmail({
          to: notify,
          subject: `New ${label} — ${lead.name}`,
          html: emailShell(
            `New ${label}`,
            `<table cellpadding="6">${rows
              .map(([k, v]) => `<tr><td><strong>${k}</strong></td><td>${String(v).replace(/</g, '&lt;')}</td></tr>`)
              .join('')}</table>`
          ),
        }).catch((e) => console.error('[LEAD] notify email failed:', e && e.message));
      }

      res.json({ ok: true, id: lead.id });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Read a block of editable site content by key. Returns {} when nothing has
  // been published yet, so the landing page can fall back to its hardcoded copy.
  app.get('/api/public/content/:key', async (req, res) => {
    try {
      const row = await db.siteContent.findUnique({ where: { key: req.params.key } });
      if (!row) return res.json({});
      try {
        return res.json(JSON.parse(row.value));
      } catch {
        return res.json({});
      }
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // =========================================================================
  // ADMIN — session
  // =========================================================================

  // The panel calls this right after login. A 403 here means "you authenticated
  // fine, but you are a customer, not platform staff" — the panel logs you out.
  app.get('/api/admin/me', ...adminOnly, async (req, res) => {
    try {
      const u = await db.user.findUnique({
        where: { id: req.user.sub },
        select: { id: true, name: true, email: true, role: true, avatar: true },
      });
      res.json({ ...(u || {}), platformAdmin: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // =========================================================================
  // ADMIN — dashboard metrics
  // =========================================================================

  app.get('/api/admin/metrics', ...adminOnly, async (_req, res) => {
    try {
      const now = new Date();
      const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const [
        totalLeads, newLeads, leads7, demoRequests,
        workspaces, users, activeUsers7,
        projects, activeSubs, unpaidInvoices,
        paidInvoices, recentLeads, recentSignups,
      ] = await Promise.all([
        db.lead.count(),
        db.lead.count({ where: { status: 'new' } }),
        db.lead.count({ where: { createdAt: { gte: d7 } } }),
        db.lead.count({ where: { kind: 'demo' } }),
        db.workspace.count(),
        db.user.count(),
        db.accessLog.findMany({ where: { createdAt: { gte: d7 } }, select: { userId: true }, distinct: ['userId'] }),
        db.project.count(),
        db.subscription.count({ where: { status: 'active' } }),
        db.billingInvoice.count({ where: { status: 'unpaid' } }),
        db.billingInvoice.findMany({ where: { status: 'paid', paidAt: { gte: d30 } }, select: { amountKES: true, amountUSD: true } }),
        db.lead.findMany({ orderBy: { createdAt: 'desc' }, take: 8 }),
        db.user.findMany({ orderBy: { createdAt: 'desc' }, take: 8, select: { id: true, name: true, email: true, role: true, createdAt: true, workspaceId: true } }),
      ]);

      const revenue30KES = paidInvoices.reduce((s, i) => s + (i.amountKES || 0), 0);
      const revenue30USD = paidInvoices.reduce((s, i) => s + (i.amountUSD || 0), 0);

      // Leads per day for the last 14 days — drives the dashboard sparkline.
      // Bucketed in JS rather than SQL to stay portable across Prisma versions.
      const d14 = new Date(now.getTime() - 13 * 24 * 60 * 60 * 1000);
      const since14 = await db.lead.findMany({
        where: { createdAt: { gte: new Date(d14.toDateString()) } },
        select: { createdAt: true, kind: true },
      });
      const series = [];
      for (let i = 13; i >= 0; i--) {
        const day = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const key = day.toISOString().slice(0, 10);
        series.push({
          date: key,
          contact: since14.filter((l) => l.createdAt.toISOString().slice(0, 10) === key && l.kind === 'contact').length,
          demo: since14.filter((l) => l.createdAt.toISOString().slice(0, 10) === key && l.kind === 'demo').length,
        });
      }

      res.json({
        leads: { total: totalLeads, new: newLeads, last7: leads7, demoRequests },
        tenants: { workspaces, users, activeUsers7: activeUsers7.length, projects },
        billing: { activeSubscriptions: activeSubs, unpaidInvoices, revenue30KES, revenue30USD },
        series,
        recentLeads,
        recentSignups,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // =========================================================================
  // ADMIN — leads (contact submissions + demo requests)
  // =========================================================================

  app.get('/api/admin/leads', ...adminOnly, async (req, res) => {
    try {
      const { kind, status, q, assignedTo } = req.query;
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 25));

      const where = {};
      if (LEAD_KINDS.includes(kind)) where.kind = kind;
      if (LEAD_STATUSES.includes(status)) where.status = status;
      if (assignedTo) where.assignedTo = String(assignedTo);
      if (q) {
        const term = String(q).slice(0, 100);
        where.OR = [
          { name: { contains: term, mode: 'insensitive' } },
          { email: { contains: term, mode: 'insensitive' } },
          { company: { contains: term, mode: 'insensitive' } },
          { message: { contains: term, mode: 'insensitive' } },
        ];
      }

      const [items, total] = await Promise.all([
        db.lead.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { _count: { select: { notes: true } } },
        }),
        db.lead.count({ where }),
      ]);

      res.json({ items, total, page, pageSize, pages: Math.ceil(total / pageSize) || 1 });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/admin/leads/export.csv', ...adminOnly, async (req, res) => {
    try {
      const where = {};
      if (LEAD_KINDS.includes(req.query.kind)) where.kind = req.query.kind;
      if (LEAD_STATUSES.includes(req.query.status)) where.status = req.query.status;

      const leads = await db.lead.findMany({ where, orderBy: { createdAt: 'desc' }, take: 5000 });
      const cols = ['createdAt', 'kind', 'status', 'name', 'email', 'phone', 'company', 'interest', 'companySize', 'role', 'preferredDate', 'message', 'useCase', 'assignedTo', 'source'];

      // Prefixing a lone ' to values starting with =, +, -, @ stops Excel from
      // evaluating a lead's message as a formula (CSV injection).
      const esc = (v) => {
        if (v === null || v === undefined) return '';
        let s = v instanceof Date ? v.toISOString() : String(v);
        if (/^[=+\-@]/.test(s)) s = `'${s}`;
        return `"${s.replace(/"/g, '""')}"`;
      };

      const csv = [cols.join(','), ...leads.map((l) => cols.map((c) => esc(l[c])).join(','))].join('\n');
      await audit(req, 'lead.export', 'Lead', null, { count: leads.length, where });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.send(csv);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/admin/leads/:id', ...adminOnly, async (req, res) => {
    try {
      const lead = await db.lead.findUnique({
        where: { id: req.params.id },
        include: { notes: { orderBy: { createdAt: 'desc' } } },
      });
      if (!lead) return res.status(404).json({ error: 'Lead not found' });
      res.json(lead);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch('/api/admin/leads/:id', ...adminOnly, async (req, res) => {
    try {
      const { status, assignedTo } = req.body || {};
      const data = {};
      if (status !== undefined) {
        if (!LEAD_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
        data.status = status;
        // Stamp the first move out of 'new' so we can measure response time.
        if (status === 'contacted') data.contactedAt = new Date();
      }
      if (assignedTo !== undefined) data.assignedTo = str(assignedTo, 200);
      if (!Object.keys(data).length) return res.status(400).json({ error: 'Nothing to update' });

      const lead = await db.lead.update({ where: { id: req.params.id }, data });
      await audit(req, 'lead.update', 'Lead', lead.id, data);
      res.json(lead);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/admin/leads/:id/notes', ...adminOnly, async (req, res) => {
    try {
      const body = str(req.body && req.body.body, 4000);
      if (!body) return res.status(400).json({ error: 'Note body is required' });
      const note = await db.leadNote.create({
        data: { leadId: req.params.id, author: req.user.email, body },
      });
      await audit(req, 'lead.note', 'Lead', req.params.id, null);
      res.json(note);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/admin/leads/:id', ...adminOnly, async (req, res) => {
    try {
      await db.lead.delete({ where: { id: req.params.id } });
      await audit(req, 'lead.delete', 'Lead', req.params.id, null);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // =========================================================================
  // ADMIN — tenants (workspaces) and their users
  // =========================================================================

  app.get('/api/admin/workspaces', ...adminOnly, async (req, res) => {
    try {
      const q = req.query.q ? String(req.query.q).slice(0, 100) : null;
      const where = q ? { name: { contains: q, mode: 'insensitive' } } : {};
      const workspaces = await db.workspace.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });

      // Workspace has no relation fields back to User/Project (tenancy is by a
      // plain workspaceId column), so counts are gathered with groupBy rather
      // than an include.
      const ids = workspaces.map((w) => w.id);
      const [userCounts, projectCounts, subs] = await Promise.all([
        db.user.groupBy({ by: ['workspaceId'], where: { workspaceId: { in: ids } }, _count: { _all: true } }),
        db.project.groupBy({ by: ['workspaceId'], where: { workspaceId: { in: ids } }, _count: { _all: true } }),
        db.subscription.findMany({ where: { workspaceId: { in: ids } } }),
      ]);
      const uMap = Object.fromEntries(userCounts.map((r) => [r.workspaceId, r._count._all]));
      const pMap = Object.fromEntries(projectCounts.map((r) => [r.workspaceId, r._count._all]));
      const sMap = Object.fromEntries(subs.map((s) => [s.workspaceId, s]));

      res.json(
        workspaces.map((w) => ({
          ...w,
          userCount: uMap[w.id] || 0,
          projectCount: pMap[w.id] || 0,
          subscription: sMap[w.id] || null,
        }))
      );
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/admin/workspaces/:id', ...adminOnly, async (req, res) => {
    try {
      const ws = await db.workspace.findUnique({ where: { id: req.params.id } });
      if (!ws) return res.status(404).json({ error: 'Workspace not found' });
      const [users, projects, subscription, invoices] = await Promise.all([
        db.user.findMany({
          where: { workspaceId: ws.id },
          orderBy: { createdAt: 'asc' },
          select: { id: true, name: true, email: true, role: true, status: true, emailVerified: true, createdAt: true, avatar: true },
        }),
        db.project.findMany({ where: { workspaceId: ws.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
        db.subscription.findFirst({ where: { workspaceId: ws.id } }),
        db.billingInvoice.findMany({ where: { workspaceId: ws.id }, orderBy: { issuedAt: 'desc' }, take: 50 }),
      ]);
      res.json({ ...ws, users, projects, subscription, invoices });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch('/api/admin/workspaces/:id', ...adminOnly, async (req, res) => {
    try {
      const name = str(req.body && req.body.name, 160);
      if (!name) return res.status(400).json({ error: 'Name is required' });
      const ws = await db.workspace.update({ where: { id: req.params.id }, data: { name } });
      await audit(req, 'workspace.rename', 'Workspace', ws.id, { name });
      res.json(ws);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/admin/users', ...adminOnly, async (req, res) => {
    try {
      const { q, workspaceId, status } = req.query;
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 25));

      const where = {};
      if (workspaceId) where.workspaceId = String(workspaceId);
      if (status) where.status = String(status);
      if (q) {
        const term = String(q).slice(0, 100);
        where.OR = [
          { name: { contains: term, mode: 'insensitive' } },
          { email: { contains: term, mode: 'insensitive' } },
        ];
      }

      const [items, total] = await Promise.all([
        db.user.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: { id: true, name: true, email: true, role: true, status: true, emailVerified: true, phone: true, trade: true, avatar: true, workspaceId: true, createdAt: true },
        }),
        db.user.count({ where }),
      ]);

      // Attach the company name so the table can show it without an N+1.
      const wsIds = [...new Set(items.map((u) => u.workspaceId).filter(Boolean))];
      const wss = await db.workspace.findMany({ where: { id: { in: wsIds } }, select: { id: true, name: true } });
      const wsMap = Object.fromEntries(wss.map((w) => [w.id, w.name]));

      res.json({
        items: items.map((u) => ({
          ...u,
          workspaceName: u.workspaceId ? wsMap[u.workspaceId] || null : null,
          platformAdmin: isPlatformAdmin(u.email),
          platformAdminRoot: typeof isRootAdmin === 'function' ? isRootAdmin(u.email) : false,
        })),
        total, page, pageSize, pages: Math.ceil(total / pageSize) || 1,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Create a user directly from the panel. Mirrors public signup but is
  // admin-initiated: an admin can drop someone into an existing company
  // (workspaceId) or spin up a fresh one, and optionally grant platform-admin
  // access in the same step. The user is created email-verified since an admin
  // is vouching for them.
  app.post('/api/admin/users', ...adminOnly, async (req, res) => {
    try {
      const b = req.body || {};
      const name = str(b.name, 120);
      const email = str(b.email, 200);
      const password = b.password ? String(b.password) : '';
      if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });
      if (!isEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address' });
      if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

      const em = email.toLowerCase();
      if (await db.user.findUnique({ where: { email: em } })) {
        return res.status(409).json({ error: 'A user with this email already exists' });
      }

      // Join an existing workspace if one is named; otherwise create a new one.
      let workspaceId = b.workspaceId ? String(b.workspaceId) : null;
      if (workspaceId) {
        const ws = await db.workspace.findUnique({ where: { id: workspaceId } });
        if (!ws) return res.status(400).json({ error: 'Workspace not found' });
      } else {
        const ws = await db.workspace.create({ data: { name: str(b.company, 160) || `${name}'s company` } });
        workspaceId = ws.id;
      }

      const user = await db.user.create({
        data: {
          name,
          email: em,
          passwordHash: bcrypt.hashSync(password, 10),
          role: str(b.role, 60) || 'Contractor',
          status: 'active',
          emailVerified: true,
          workspaceId,
        },
        select: { id: true, name: true, email: true, role: true, status: true, emailVerified: true, workspaceId: true, createdAt: true },
      });

      // Optionally make them a platform admin in the same action.
      let platformAdmin = isPlatformAdmin(em);
      if (b.platformAdmin && !platformAdmin) {
        await db.platformAdmin.upsert({ where: { email: em }, create: { email: em, addedBy: req.user.email }, update: {} });
        if (typeof refreshDbAdmins === 'function') await refreshDbAdmins();
        platformAdmin = true;
        await audit(req, 'admin.add', 'PlatformAdmin', em, { via: 'user.create' });
      }

      await audit(req, 'user.create', 'User', user.id, { email: em, role: user.role, workspaceId });
      const wsRow = await db.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } });
      res.json({ ...user, workspaceName: wsRow ? wsRow.name : null, platformAdmin, platformAdminRoot: typeof isRootAdmin === 'function' ? isRootAdmin(em) : false });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch('/api/admin/users/:id', ...adminOnly, async (req, res) => {
    try {
      const { role, status, name } = req.body || {};
      const target = await db.user.findUnique({ where: { id: req.params.id } });
      if (!target) return res.status(404).json({ error: 'User not found' });

      // A platform admin must not be able to lock themselves or a colleague out
      // of the panel by suspending a platform-admin account.
      if (status === 'suspended' && isPlatformAdmin(target.email)) {
        return res.status(400).json({ error: 'Platform admin accounts cannot be suspended' });
      }

      const data = {};
      if (role !== undefined) data.role = str(role, 60);
      if (name !== undefined) data.name = str(name, 120);
      if (status !== undefined) {
        if (!['active', 'suspended'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
        data.status = status;
      }
      if (!Object.keys(data).length) return res.status(400).json({ error: 'Nothing to update' });

      const user = await db.user.update({
        where: { id: req.params.id },
        data,
        select: { id: true, name: true, email: true, role: true, status: true, workspaceId: true, createdAt: true },
      });
      await audit(req, 'user.update', 'User', user.id, data);
      res.json(user);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Set a new password for a user. Used for support ("I can't get in") — the new
  // password is returned once, to the admin, and never stored in plaintext.
  app.post('/api/admin/users/:id/reset-password', ...adminOnly, async (req, res) => {
    try {
      const password = str(req.body && req.body.password, 100);
      if (!password || password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }
      const user = await db.user.update({
        where: { id: req.params.id },
        data: { passwordHash: bcrypt.hashSync(password, 10) },
        select: { id: true, email: true, name: true },
      });
      await audit(req, 'user.reset_password', 'User', user.id, null);
      res.json({ ok: true, user });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/admin/users/:id', ...adminOnly, async (req, res) => {
    try {
      const target = await db.user.findUnique({ where: { id: req.params.id } });
      if (!target) return res.status(404).json({ error: 'User not found' });
      if (isPlatformAdmin(target.email)) {
        return res.status(400).json({ error: 'Platform admin accounts cannot be deleted here' });
      }
      await db.user.delete({ where: { id: req.params.id } });
      await audit(req, 'user.delete', 'User', req.params.id, { email: target.email });
      res.json({ ok: true });
    } catch (e) {
      // A user with assignments/messages will fail the FK constraint. Suspending
      // is the safe path, so say so rather than leaking a Prisma error.
      res.status(400).json({ error: 'This user has activity in the system and cannot be deleted. Suspend them instead.' });
    }
  });

  // =========================================================================
  // ADMIN — billing
  // =========================================================================

  app.get('/api/admin/subscriptions', ...adminOnly, async (req, res) => {
    try {
      const where = {};
      if (req.query.status) where.status = String(req.query.status);
      const subs = await db.subscription.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });

      const wsIds = [...new Set(subs.map((s) => s.workspaceId).filter(Boolean))];
      const userIds = [...new Set(subs.map((s) => s.userId).filter(Boolean))];
      const [wss, users] = await Promise.all([
        db.workspace.findMany({ where: { id: { in: wsIds } }, select: { id: true, name: true } }),
        db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }),
      ]);
      const wsMap = Object.fromEntries(wss.map((w) => [w.id, w.name]));
      const uMap = Object.fromEntries(users.map((u) => [u.id, u]));

      res.json(
        subs.map((s) => ({
          ...s,
          workspaceName: s.workspaceId ? wsMap[s.workspaceId] || null : null,
          owner: uMap[s.userId] || null,
        }))
      );
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch('/api/admin/subscriptions/:id', ...adminOnly, async (req, res) => {
    try {
      const { status, plan, currentPeriodEnd, amountUSD } = req.body || {};
      const data = {};
      if (status !== undefined) {
        if (!['inactive', 'active', 'past_due', 'cancelled'].includes(status)) {
          return res.status(400).json({ error: 'Invalid status' });
        }
        data.status = status;
      }
      if (plan !== undefined) {
        if (!['monthly', 'yearly'].includes(plan)) return res.status(400).json({ error: 'Invalid plan' });
        data.plan = plan;
      }
      if (amountUSD !== undefined) data.amountUSD = Math.max(0, parseInt(amountUSD, 10) || 0);
      if (currentPeriodEnd !== undefined) {
        const d = new Date(currentPeriodEnd);
        if (isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid date' });
        data.currentPeriodEnd = d;
      }
      if (!Object.keys(data).length) return res.status(400).json({ error: 'Nothing to update' });

      const sub = await db.subscription.update({ where: { id: req.params.id }, data });
      await audit(req, 'subscription.update', 'Subscription', sub.id, data);
      res.json(sub);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/admin/invoices', ...adminOnly, async (req, res) => {
    try {
      const where = {};
      if (req.query.status) where.status = String(req.query.status);
      if (req.query.workspaceId) where.workspaceId = String(req.query.workspaceId);
      const invoices = await db.billingInvoice.findMany({ where, orderBy: { issuedAt: 'desc' }, take: 200 });

      const wsIds = [...new Set(invoices.map((i) => i.workspaceId).filter(Boolean))];
      const wss = await db.workspace.findMany({ where: { id: { in: wsIds } }, select: { id: true, name: true } });
      const wsMap = Object.fromEntries(wss.map((w) => [w.id, w.name]));

      res.json(invoices.map((i) => ({ ...i, workspaceName: i.workspaceId ? wsMap[i.workspaceId] || null : null })));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/admin/invoices', ...adminOnly, async (req, res) => {
    try {
      const { userId, workspaceId, plan, description, amountKES, amountUSD, currency, dueDate } = req.body || {};
      if (!userId) return res.status(400).json({ error: 'userId (the workspace owner being billed) is required' });

      const due = dueDate ? new Date(dueDate) : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      if (isNaN(due.getTime())) return res.status(400).json({ error: 'Invalid due date' });

      const count = await db.billingInvoice.count();
      const number = `BS-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;

      const invoice = await db.billingInvoice.create({
        data: {
          userId: String(userId),
          workspaceId: workspaceId ? String(workspaceId) : null,
          number,
          plan: plan ? String(plan) : null,
          description: str(description, 500),
          amountKES: Math.max(0, parseInt(amountKES, 10) || 0),
          amountUSD: Math.max(0, parseInt(amountUSD, 10) || 0),
          currency: currency === 'USD' ? 'USD' : 'KES',
          dueDate: due,
        },
      });
      await audit(req, 'invoice.create', 'BillingInvoice', invoice.id, { number, amountKES: invoice.amountKES });
      res.json(invoice);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Mark an invoice paid (offline bank transfer) or void it. This is the
  // billing override the PLATFORM_ADMIN_EMAILS list was introduced to protect.
  app.patch('/api/admin/invoices/:id', ...adminOnly, async (req, res) => {
    try {
      const { status } = req.body || {};
      if (!['unpaid', 'paid', 'void'].includes(status)) return res.status(400).json({ error: 'Invalid status' });

      const data = { status };
      data.paidAt = status === 'paid' ? new Date() : null;

      const invoice = await db.billingInvoice.update({ where: { id: req.params.id }, data });
      await audit(req, `invoice.${status}`, 'BillingInvoice', invoice.id, { number: invoice.number });
      res.json(invoice);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // =========================================================================
  // ADMIN — subscription packages (the plan catalogue shown on the SaaS)
  //
  // These rows ARE the pricing screen: the SaaS reads them through
  // /api/billing/plans and checkout prices against them. Editing here changes
  // what customers see and pay, with no deploy.
  // =========================================================================

  const PKG_CYCLES = ['weekly', 'monthly', 'yearly'];
  const slugify = (v) =>
    String(v || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);

  // Accept an array of non-empty strings; store as JSON. Returns undefined to
  // mean "leave unchanged" and null to mean "clear".
  const featuresJson = (v) => {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    const arr = Array.isArray(v) ? v : [];
    const clean = arr.map((s) => str(s, 200)).filter(Boolean).slice(0, 20);
    return clean.length ? JSON.stringify(clean) : null;
  };

  app.get('/api/admin/packages', ...adminOnly, async (_req, res) => {
    try {
      const rows = await db.subscriptionPackage.findMany({
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/admin/packages', ...adminOnly, async (req, res) => {
    try {
      const b = req.body || {};
      const name = str(b.name, 160);
      if (!name) return res.status(400).json({ error: 'Name is required' });

      const id = slugify(b.id || b.name);
      if (!id) return res.status(400).json({ error: 'A valid id/slug is required' });

      const existing = await db.subscriptionPackage.findUnique({ where: { id } });
      if (existing) return res.status(409).json({ error: `A package with id "${id}" already exists` });

      const cycle = PKG_CYCLES.includes(b.cycle) ? b.cycle : 'monthly';
      const usd = Math.max(0, parseInt(b.usd, 10) || 0);
      const days = Math.max(1, parseInt(b.days, 10) || (cycle === 'yearly' ? 365 : cycle === 'weekly' ? 7 : 30));

      const pkg = await db.subscriptionPackage.create({
        data: {
          id,
          name,
          cycle,
          usd,
          days,
          note: str(b.note, 300),
          features: featuresJson(b.features) || null,
          active: b.active === undefined ? true : !!b.active,
          sortOrder: parseInt(b.sortOrder, 10) || 0,
        },
      });
      await audit(req, 'package.create', 'SubscriptionPackage', pkg.id, { name, usd, cycle });
      res.json(pkg);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch('/api/admin/packages/:id', ...adminOnly, async (req, res) => {
    try {
      const b = req.body || {};
      const data = {};
      if (b.name !== undefined) {
        const name = str(b.name, 160);
        if (!name) return res.status(400).json({ error: 'Name cannot be empty' });
        data.name = name;
      }
      if (b.cycle !== undefined) {
        if (!PKG_CYCLES.includes(b.cycle)) return res.status(400).json({ error: 'Invalid billing cycle' });
        data.cycle = b.cycle;
      }
      if (b.usd !== undefined) data.usd = Math.max(0, parseInt(b.usd, 10) || 0);
      if (b.days !== undefined) data.days = Math.max(1, parseInt(b.days, 10) || 30);
      if (b.note !== undefined) data.note = str(b.note, 300);
      if (b.features !== undefined) data.features = featuresJson(b.features);
      if (b.active !== undefined) data.active = !!b.active;
      if (b.sortOrder !== undefined) data.sortOrder = parseInt(b.sortOrder, 10) || 0;
      if (!Object.keys(data).length) return res.status(400).json({ error: 'Nothing to update' });

      const pkg = await db.subscriptionPackage.update({ where: { id: req.params.id }, data });
      await audit(req, 'package.update', 'SubscriptionPackage', pkg.id, data);
      res.json(pkg);
    } catch (e) {
      if (e.code === 'P2025') return res.status(404).json({ error: 'Package not found' });
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/admin/packages/:id', ...adminOnly, async (req, res) => {
    try {
      await db.subscriptionPackage.delete({ where: { id: req.params.id } });
      await audit(req, 'package.delete', 'SubscriptionPackage', req.params.id, null);
      res.json({ ok: true });
    } catch (e) {
      if (e.code === 'P2025') return res.status(404).json({ error: 'Package not found' });
      res.status(500).json({ error: e.message });
    }
  });

  // =========================================================================
  // ADMIN — platform admins (who can access this panel)
  //
  // Two tiers: "root" admins come from the PLATFORM_ADMIN_EMAILS env var and are
  // immutable here (bootstrap + lockout protection); everyone else lives in the
  // PlatformAdmin table and is editable below. Access still requires the person
  // to have a Buildsasa user account to log in with — adding an email here only
  // grants the platform-admin capability, it does not create a login.
  // =========================================================================

  const envAdmins = () => (Array.isArray(platformAdminEnv) ? platformAdminEnv : []);

  // Annotate a set of admin emails with whether a login account exists for each.
  async function annotateAccounts(emails) {
    const list = [...new Set(emails.map((e) => String(e).toLowerCase()))];
    if (!list.length) return {};
    const users = await db.user.findMany({
      where: { email: { in: list } },
      select: { email: true, name: true, status: true },
    });
    return Object.fromEntries(users.map((u) => [String(u.email).toLowerCase(), u]));
  }

  app.get('/api/admin/admins', ...adminOnly, async (_req, res) => {
    try {
      const dbRows = await db.platformAdmin.findMany({ orderBy: { createdAt: 'asc' } });
      const emails = [...envAdmins(), ...dbRows.map((r) => r.email)];
      const accounts = await annotateAccounts(emails);

      const seen = new Set();
      const out = [];
      for (const email of envAdmins()) {
        const key = email.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const acct = accounts[key];
        out.push({ email: key, root: true, addedBy: 'PLATFORM_ADMIN_EMAILS', createdAt: null, hasAccount: !!acct, name: acct ? acct.name : null });
      }
      for (const r of dbRows) {
        const key = String(r.email).toLowerCase();
        if (seen.has(key)) continue; // env root wins if listed in both
        seen.add(key);
        const acct = accounts[key];
        out.push({ email: key, root: false, addedBy: r.addedBy || null, createdAt: r.createdAt, hasAccount: !!acct, name: acct ? acct.name : null });
      }
      res.json(out);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/admin/admins', ...adminOnly, async (req, res) => {
    try {
      const email = String((req.body && req.body.email) || '').trim().toLowerCase();
      if (!email || !isEmail(email)) return res.status(400).json({ error: 'A valid email is required' });
      if (email.length > 200) return res.status(400).json({ error: 'Email is too long' });

      if (envAdmins().includes(email)) {
        return res.status(409).json({ error: 'This email is already a root admin (set via PLATFORM_ADMIN_EMAILS)' });
      }
      const existing = await db.platformAdmin.findUnique({ where: { email } });
      if (existing) return res.status(409).json({ error: 'This email is already an admin' });

      const row = await db.platformAdmin.create({ data: { email, addedBy: req.user.email } });
      if (typeof refreshDbAdmins === 'function') await refreshDbAdmins();
      await audit(req, 'admin.add', 'PlatformAdmin', email, null);

      const acct = (await annotateAccounts([email]))[email];
      res.json({ email, root: false, addedBy: row.addedBy, createdAt: row.createdAt, hasAccount: !!acct, name: acct ? acct.name : null });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/admin/admins/:email', ...adminOnly, async (req, res) => {
    try {
      const email = String(req.params.email || '').trim().toLowerCase();
      // Root admins are env-set and can never be removed here — this is the
      // guarantee that there is always a way back into the panel.
      if (isRootAdmin(email)) {
        return res.status(400).json({ error: 'Root admins are set via PLATFORM_ADMIN_EMAILS and cannot be removed here' });
      }
      // Don't let an admin lock themselves out by accident.
      if (email === String(req.user.email || '').toLowerCase()) {
        return res.status(400).json({ error: 'You cannot remove your own admin access' });
      }
      const existing = await db.platformAdmin.findUnique({ where: { email } });
      if (!existing) return res.status(404).json({ error: 'Not a managed admin' });

      await db.platformAdmin.delete({ where: { email } });
      if (typeof refreshDbAdmins === 'function') await refreshDbAdmins();
      await audit(req, 'admin.remove', 'PlatformAdmin', email, null);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // =========================================================================
  // ADMIN — platform ops
  // =========================================================================

  app.get('/api/admin/access-logs', ...adminOnly, async (req, res) => {
    try {
      const take = Math.min(500, Math.max(1, parseInt(req.query.take, 10) || 200));
      res.json(await db.accessLog.findMany({ orderBy: { createdAt: 'desc' }, take }));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/admin/audit', ...adminOnly, async (req, res) => {
    try {
      const take = Math.min(500, Math.max(1, parseInt(req.query.take, 10) || 200));
      res.json(await db.adminAudit.findMany({ orderBy: { createdAt: 'desc' }, take }));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Announcements. Passing a workspaceId targets one company; omitting it
  // creates a platform-wide announcement (workspaceId stays null).
  app.get('/api/admin/announcements', ...adminOnly, async (req, res) => {
    try {
      const where = {};
      if (req.query.workspaceId) where.workspaceId = String(req.query.workspaceId);
      res.json(await db.announcement.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 }));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/admin/announcements', ...adminOnly, async (req, res) => {
    try {
      const { title, body, priority, pinned, workspaceId } = req.body || {};
      const t = str(title, 200);
      if (!t) return res.status(400).json({ error: 'Title is required' });

      const a = await db.announcement.create({
        data: {
          title: t,
          body: str(body, 5000),
          priority: ['low', 'normal', 'high', 'urgent'].includes(priority) ? priority : 'normal',
          pinned: !!pinned,
          audience: 'company',
          author: req.user.name || req.user.email,
          authorRole: 'Buildsasa',
          date: new Date().toISOString().slice(0, 10),
          workspaceId: workspaceId ? String(workspaceId) : null,
        },
      });
      await audit(req, 'announcement.create', 'Announcement', a.id, { title: t, workspaceId: workspaceId || 'all' });
      res.json(a);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/admin/announcements/:id', ...adminOnly, async (req, res) => {
    try {
      await db.announcement.delete({ where: { id: req.params.id } });
      await audit(req, 'announcement.delete', 'Announcement', req.params.id, null);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Editable landing page content.
  app.get('/api/admin/content', ...adminOnly, async (_req, res) => {
    try {
      const rows = await db.siteContent.findMany({ orderBy: { key: 'asc' } });
      res.json(
        rows.map((r) => {
          let value = {};
          try { value = JSON.parse(r.value); } catch { /* keep {} on bad JSON */ }
          return { ...r, value };
        })
      );
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/admin/content/:key', ...adminOnly, async (req, res) => {
    try {
      const value = req.body && req.body.value;
      if (value === undefined) return res.status(400).json({ error: 'value is required' });
      const json = JSON.stringify(value);
      if (json.length > 100000) return res.status(400).json({ error: 'Content block is too large' });

      const key = String(req.params.key).slice(0, 100);
      const row = await db.siteContent.upsert({
        where: { key },
        create: { key, value: json, updatedBy: req.user.email },
        update: { value: json, updatedBy: req.user.email },
      });
      await audit(req, 'content.update', 'SiteContent', key, null);
      res.json({ ...row, value });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/admin/content/:key', ...adminOnly, async (req, res) => {
    try {
      await db.siteContent.delete({ where: { key: String(req.params.key) } });
      await audit(req, 'content.delete', 'SiteContent', req.params.key, null);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  console.log('[ADMIN] platform admin routes mounted at /api/admin/*');
};
