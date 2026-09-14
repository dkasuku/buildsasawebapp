// ===========================================================================
// PROJECT HUB
//
// Everything about one construction project, reachable from the project card
// without hopping between modules:
//
//   GET  /api/projects/:id/hub               one call: contract, documents by
//                                            folder, drawings with versions, BOQ
//                                            summary + revisions, variations with
//                                            the running total, certificates with
//                                            cumulative valuation, site diary,
//                                            defects, H&S, and cost control.
//   documents                                 folders + linking to a record
//   BOQ import / revisions / rate library
//   subcontractor database + payment recording
//
// The individual modules (Plans, Change Orders, Financials…) keep working on the
// same rows — this is a different door into the same data, not a copy of it.
// ===========================================================================

module.exports = function mountProjectHub(app, deps) {
  const {
    prisma, auth, hasRole,
    CAN_MANAGE_BIDS, CAN_REVIEW_FINANCE, CAN_CREATE_CO,
    logCO, recomputeCommitment, boqAmount, projectDto,
  } = deps;

  const USD_TO_KES = Number(process.env.USD_TO_KES) || 130;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const round2 = (v) => Math.round(num(v) * 100) / 100;
  const safe = async (fn, fallback) => { try { return await fn(); } catch { return fallback; } };
  const who = (req) => (req.user && (req.user.name || req.user.email)) || null;
  const parseJsonArray = (s) => { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };

  // A variation's value in KES. New rows carry amountKES; rows created by the
  // Change Orders module before that column existed only have costUSD.
  const variationKES = (co) => (co.amountKES != null ? num(co.amountKES) : num(co.costUSD) * USD_TO_KES);
  const APPROVED_CO = new Set(['approved']);
  const PENDING_CO = new Set(['drafted', 'pm_review', 'owner_approval']);

  // Only the folders the hub knows about. Anything else lands in "general" so a
  // typo cannot create a folder nobody can find.
  const DOC_CATEGORIES = new Set(['contract', 'drawing', 'boq', 'variation', 'certificate', 'site', 'general']);
  const docCategory = (c) => (DOC_CATEGORIES.has(String(c || '')) ? String(c) : 'general');

  // ── Cost control ──────────────────────────────────────────────────────────
  // One place that turns the raw rows into the figures a QS actually asks for.
  // Everything is KES. Ledger and expense categories are stored in USD elsewhere
  // in the product, so they are converted on the way in.
  function costControl({ project, boqTotal, expenses, ledger, commitments, changeOrders, certificates }) {
    const contractSum = project.contractSumKES != null ? num(project.contractSumKES) : null;
    const approvedVariations = changeOrders.filter((c) => APPROVED_CO.has(c.status)).reduce((s, c) => s + variationKES(c), 0);
    const pendingVariations = changeOrders.filter((c) => PENDING_CO.has(c.status)).reduce((s, c) => s + variationKES(c), 0);
    const revisedContractSum = contractSum != null ? contractSum + approvedVariations : null;

    // The budget is what was estimated: the BOQ when there is one, otherwise the
    // category budgets typed into Financials.
    const budgetFromCategories = expenses.reduce((s, e) => s + num(e.budgetUSD) * USD_TO_KES, 0);
    const originalBudget = boqTotal > 0 ? boqTotal : budgetFromCategories;
    const revisedBudget = originalBudget + approvedVariations;

    const actual = expenses.reduce((s, e) => s + num(e.actualUSD) * USD_TO_KES, 0);
    const committed = commitments.reduce((s, c) => s + num(c.contractValue) + num(c.approvedVariations), 0);
    const paidToSubs = commitments.reduce((s, c) => s + num(c.paidToDate), 0);

    // Cost to complete: whatever is still expected to be spent. Committed money not
    // yet booked as actual will be spent; so will the part of the budget nobody has
    // committed yet. Floors at zero so an overspent job does not show a negative
    // amount "to complete".
    const costToComplete = Math.max(0, Math.max(revisedBudget, committed) - actual);
    const forecastFinalCost = actual + costToComplete;
    const variance = revisedBudget - forecastFinalCost; // positive = under budget

    const certifiedToDate = certificates.reduce((s, c) => s + num(c.requestedAmount), 0);
    const paidToDate = certificates.filter((c) => c.status === 'paid').reduce((s, c) => s + num(c.netPayable), 0);
    const retentionHeld = certificates.reduce((s, c) => s + num(c.retentionAmount), 0);

    // ── Cash flow by month ──
    // Actuals from the ledger; income from certificates. Then the forecast: what
    // is still to be spent, spread evenly over the months left on the programme
    // (or the next 3 months when there is no end date to aim at).
    const monthKey = (d) => { const x = new Date(d); return isNaN(x.getTime()) ? null : `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`; };
    const months = {};
    const bucket = (k) => { if (!k) return null; if (!months[k]) months[k] = { month: k, cashIn: 0, cashOut: 0, certified: 0, forecastOut: 0, forecastIn: 0 }; return months[k]; };
    for (const l of ledger) {
      const b = bucket(monthKey(l.date)); if (!b) continue;
      if (l.type === 'in') b.cashIn += num(l.amountUSD) * USD_TO_KES; else b.cashOut += num(l.amountUSD) * USD_TO_KES;
    }
    for (const c of certificates) {
      const b = bucket(monthKey(c.periodEnd || c.createdAt)); if (!b) continue;
      b.certified += num(c.requestedAmount);
    }
    const today = new Date();
    const end = project.targetEndDate ? new Date(project.targetEndDate) : null;
    let monthsLeft = 3;
    if (end && !isNaN(end.getTime()) && end > today) {
      monthsLeft = Math.max(1, (end.getFullYear() - today.getFullYear()) * 12 + (end.getMonth() - today.getMonth()) + 1);
    }
    const remainingIncome = revisedContractSum != null ? Math.max(0, revisedContractSum - certifiedToDate) : 0;
    for (let i = 0; i < monthsLeft; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
      const b = bucket(monthKey(d));
      b.forecastOut += costToComplete / monthsLeft;
      b.forecastIn += remainingIncome / monthsLeft;
    }
    const cashflow = Object.values(months).sort((a, b) => a.month.localeCompare(b.month));
    let run = 0;
    for (const m of cashflow) {
      m.cashIn = round2(m.cashIn); m.cashOut = round2(m.cashOut); m.certified = round2(m.certified);
      m.forecastOut = round2(m.forecastOut); m.forecastIn = round2(m.forecastIn);
      run += m.cashIn - m.cashOut + m.forecastIn - m.forecastOut;
      m.cumulative = round2(run);
    }

    return {
      contractSum, approvedVariations: round2(approvedVariations), pendingVariations: round2(pendingVariations), revisedContractSum,
      originalBudget: round2(originalBudget), budgetSource: boqTotal > 0 ? 'boq' : (budgetFromCategories > 0 ? 'categories' : 'none'),
      revisedBudget: round2(revisedBudget), actual: round2(actual), committed: round2(committed), paidToSubs: round2(paidToSubs),
      costToComplete: round2(costToComplete), forecastFinalCost: round2(forecastFinalCost), variance: round2(variance),
      certifiedToDate: round2(certifiedToDate), paidToDate: round2(paidToDate), retentionHeld: round2(retentionHeld),
      categories: expenses.map((e) => ({ id: e.id, name: e.name, budget: round2(num(e.budgetUSD) * USD_TO_KES), actual: round2(num(e.actualUSD) * USD_TO_KES) })),
      cashflow,
    };
  }

  // ── The hub itself ────────────────────────────────────────────────────────
  app.get('/api/projects/:projectId/hub', auth, async (req, res) => {
    const projectId = req.params.projectId;
    try {
      const project = await prisma.project.findUnique({ where: { id: projectId }, include: { assignments: true } });
      if (!project) return res.status(404).json({ error: 'Project not found' });

      const [
        documents, drawings, boqSections, boqRevisions, changeOrders, certificates,
        dailyLogs, punchItems, safetyIncidents, schedule, expenses, ledger, commitments, inspections,
      ] = await Promise.all([
        safe(() => prisma.document.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } }), []),
        safe(() => prisma.drawing.findMany({ where: { projectId }, orderBy: [{ number: 'asc' }, { rev: 'desc' }] }), []),
        safe(() => prisma.boqSection.findMany({ where: { projectId }, include: { items: true } }), []),
        safe(() => prisma.boqRevision.findMany({ where: { projectId }, orderBy: { version: 'desc' }, select: { id: true, version: true, label: true, note: true, total: true, itemCount: true, createdBy: true, createdAt: true } }), []),
        safe(() => prisma.changeOrder.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } }), []),
        // Main-contract certificates: payment applications not tied to a subcontract.
        safe(() => prisma.paymentApplication.findMany({ where: { projectId, commitmentId: null }, orderBy: { createdAt: 'asc' } }), []),
        safe(() => prisma.dailyLog.findMany({ where: { projectId }, orderBy: { date: 'desc' }, take: 60 }), []),
        safe(() => prisma.punchItem.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } }), []),
        safe(() => prisma.safetyIncident.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } }), []),
        safe(() => prisma.scheduleItem.findMany({ where: { projectId }, orderBy: { startDate: 'asc' } }), []),
        safe(() => prisma.expenseCategory.findMany({ where: { projectId } }), []),
        safe(() => prisma.ledgerEntry.findMany({ where: { projectId }, orderBy: { date: 'asc' } }), []),
        safe(() => prisma.commitment.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } }), []),
        safe(() => prisma.inspection.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 20 }), []),
      ]);

      // Drawings grouped by sheet number: one card per sheet, every revision inside
      // it, newest first. A "version" is simply another Drawing row with the same
      // number and a higher rev.
      const sheets = {};
      for (const d of drawings) {
        const key = String(d.number || d.title).trim().toLowerCase();
        if (!sheets[key]) sheets[key] = { number: d.number, title: d.title, discipline: d.discipline, latest: null, versions: [] };
        sheets[key].versions.push(d);
      }
      const drawingSheets = Object.values(sheets).map((s) => {
        s.versions.sort((a, b) => num(b.rev) - num(a.rev) || new Date(b.createdAt) - new Date(a.createdAt));
        s.latest = s.versions[0];
        s.title = s.latest.title; s.discipline = s.latest.discipline; s.status = s.latest.status;
        return s;
      }).sort((a, b) => String(a.number).localeCompare(String(b.number)));

      const boqTotal = round2(boqSections.reduce((a, s) => a + s.items.reduce((x, i) => x + num(i.amount), 0), 0));
      const boqItemCount = boqSections.reduce((a, s) => a + s.items.length, 0);

      // Variations with the running total: each row carries the revised contract
      // sum after it, so the list reads like a ledger.
      const contractSum = project.contractSumKES != null ? num(project.contractSumKES) : null;
      let running = contractSum != null ? contractSum : 0;
      const variations = changeOrders.map((c) => {
        const amount = round2(variationKES(c));
        if (APPROVED_CO.has(c.status)) running += amount;
        return {
          ...c, amountKES: amount,
          runningTotal: contractSum != null ? round2(running) : null,
          documents: documents.filter((d) => d.linkedType === 'variation' && d.linkedId === c.id),
        };
      });

      // Certificates with cumulative valuation and share of the (revised) contract.
      const revisedContractSum = contractSum != null ? contractSum + variations.filter((v) => APPROVED_CO.has(v.status)).reduce((s, v) => s + v.amountKES, 0) : null;
      let cumulative = 0;
      const certificateRows = certificates.map((c) => {
        cumulative += num(c.requestedAmount);
        return {
          ...c,
          cumulative: round2(cumulative),
          pctOfContract: revisedContractSum ? Math.round((cumulative / revisedContractSum) * 1000) / 10 : null,
          documents: documents.filter((d) => d.linkedType === 'certificate' && d.linkedId === c.id),
        };
      });

      const today = new Date();
      const openPunch = punchItems.filter((p) => !['closed', 'resolved', 'Closed', 'Resolved'].includes(p.status));
      const scheduleProgress = schedule.length ? Math.round(schedule.reduce((s, i) => s + num(i.percent), 0) / schedule.length) : null;

      // Timeline: how far through the programme we are, by calendar.
      const start = project.startDate ? new Date(project.startDate) : null;
      const end = project.targetEndDate ? new Date(project.targetEndDate) : null;
      const dayMs = 86400000;
      const durationDays = start && end ? Math.max(0, Math.round((end - start) / dayMs)) : null;
      const elapsedDays = start ? Math.max(0, Math.round((today - start) / dayMs)) : null;
      const remainingDays = end ? Math.round((end - today) / dayMs) : null;
      const elapsedPct = durationDays && elapsedDays != null ? Math.min(100, Math.max(0, Math.round((elapsedDays / durationDays) * 100))) : null;

      res.json({
        project: projectDto(project),
        team: project.assignments || [],
        timeline: { startDate: project.startDate, targetEndDate: project.targetEndDate, durationDays, elapsedDays, remainingDays, elapsedPct },
        progress: {
          reported: num(project.progress), schedule: scheduleProgress, scheduleItems: schedule.length,
          milestonesDone: schedule.filter((i) => i.type === 'milestone' && num(i.percent) >= 100).length,
          milestonesTotal: schedule.filter((i) => i.type === 'milestone').length,
          overdueItems: schedule.filter((i) => i.endDate && new Date(i.endDate) < today && num(i.percent) < 100).length,
          blockedItems: schedule.filter((i) => i.status === 'blocked').length,
        },
        schedule: schedule.slice(0, 60),
        documents,
        drawings: drawingSheets,
        boq: { total: boqTotal, itemCount: boqItemCount, sections: boqSections.length, revisions: boqRevisions },
        variations,
        certificates: certificateRows,
        site: {
          dailyLogs: dailyLogs.map((l) => ({ ...l, photos: parseJsonArray(l.photos) })),
          punchItems: punchItems.map((p) => ({ ...p, photos: parseJsonArray(p.photos), assignees: parseJsonArray(p.assignees) })),
          punchOpen: openPunch.length,
          safetyIncidents,
          inspections,
        },
        commitments,
        costs: costControl({ project, boqTotal, expenses, ledger, commitments, changeOrders, certificates }),
        counts: {
          documents: documents.length, drawings: drawings.length, sheets: drawingSheets.length, variations: changeOrders.length,
          certificates: certificates.length, dailyLogs: dailyLogs.length, punchOpen: openPunch.length, punchTotal: punchItems.length,
          safetyIncidents: safetyIncidents.length, commitments: commitments.length,
        },
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Contract sum lives on the project; editable from the hub header.
  app.put('/api/projects/:projectId/contract', auth, async (req, res) => {
    try {
      if (!hasRole(req, CAN_MANAGE_BIDS)) return res.status(403).json({ error: 'Forbidden: ' + ((req.user && req.user.role) || 'this role') + ' cannot set the contract sum' });
      const { contractSumKES, startDate, targetEndDate } = req.body || {};
      const data = {};
      if (contractSumKES !== undefined) data.contractSumKES = contractSumKES == null || contractSumKES === '' ? null : num(contractSumKES);
      if (startDate !== undefined) data.startDate = startDate ? new Date(startDate) : null;
      if (targetEndDate !== undefined) data.targetEndDate = targetEndDate ? new Date(targetEndDate) : null;
      const p = await prisma.project.update({ where: { id: req.params.projectId }, data });
      res.json(projectDto(p));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Documents: folders and links ──────────────────────────────────────────
  // The list/create/delete routes in server.js predate folders. These add the
  // filtered list and the ability to move a file or link it to a record.
  app.get('/api/projects/:projectId/documents', auth, async (req, res) => {
    try {
      const where = { projectId: req.params.projectId };
      if (req.query.category) where.category = docCategory(req.query.category);
      if (req.query.linkedType) where.linkedType = String(req.query.linkedType);
      if (req.query.linkedId) where.linkedId = String(req.query.linkedId);
      res.json(await prisma.document.findMany({ where, orderBy: { createdAt: 'desc' } }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/projects/:projectId/documents', auth, async (req, res) => {
    try {
      const b = req.body || {};
      if (!b.url || !b.name) return res.status(400).json({ error: 'name and url are required' });
      const row = await prisma.document.create({ data: {
        name: String(b.name).slice(0, 300), url: String(b.url),
        size: String(b.size || '—'), updated: String(b.updated || 'Just now'),
        category: docCategory(b.category),
        linkedType: b.linkedType || null, linkedId: b.linkedId || null,
        note: b.note || null, uploadedBy: who(req),
        projectId: req.params.projectId,
      } });
      res.json(row);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.put('/api/documents/:id', auth, async (req, res) => {
    try {
      const b = req.body || {};
      const data = {};
      if (b.name !== undefined) data.name = String(b.name).slice(0, 300);
      if (b.category !== undefined) data.category = docCategory(b.category);
      if (b.linkedType !== undefined) data.linkedType = b.linkedType || null;
      if (b.linkedId !== undefined) data.linkedId = b.linkedId || null;
      if (b.note !== undefined) data.note = b.note || null;
      res.json(await prisma.document.update({ where: { id: req.params.id }, data }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Drawings: a new revision of an existing sheet ─────────────────────────
  // Same sheet number, rev = highest + 1. The previous revision stays as it was,
  // which is the whole point of version tracking.
  app.post('/api/projects/:projectId/drawings/:number/revisions', auth, async (req, res) => {
    try {
      const projectId = req.params.projectId;
      const number = decodeURIComponent(req.params.number);
      const { fileUrl, fileName, fileSize, title, status } = req.body || {};
      if (!fileUrl) return res.status(400).json({ error: 'fileUrl is required' });
      const existing = await prisma.drawing.findMany({ where: { projectId, number }, orderBy: { rev: 'desc' } });
      if (!existing.length) return res.status(404).json({ error: 'No sheet with that number on this project' });
      const latest = existing[0];
      const row = await prisma.drawing.create({ data: {
        number, title: title || latest.title, discipline: latest.discipline,
        rev: num(latest.rev) + 1, status: status || 'Draft',
        fileUrl, fileName: fileName || null, fileSize: Number.isFinite(Number(fileSize)) ? Number(fileSize) : null,
        uploadedBy: req.user && req.user.email ? req.user.email : null, projectId,
      } });
      res.json(row);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── BOQ: revisions ────────────────────────────────────────────────────────
  async function snapshotBoq(projectId, { label, note, createdBy }) {
    const sections = await prisma.boqSection.findMany({
      where: { projectId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: { items: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } },
    });
    const itemCount = sections.reduce((a, s) => a + s.items.length, 0);
    if (!itemCount) return null; // nothing to freeze
    const total = round2(sections.reduce((a, s) => a + s.items.reduce((x, i) => x + num(i.amount), 0), 0));
    const last = await prisma.boqRevision.findFirst({ where: { projectId }, orderBy: { version: 'desc' } });
    const snapshot = sections.map((s) => ({
      code: s.code, title: s.title,
      items: s.items.map((i) => ({ code: i.code, description: i.description, unit: i.unit, quantity: i.quantity, rate: i.rate, amount: i.amount, costCodeId: i.costCodeId })),
    }));
    return prisma.boqRevision.create({ data: {
      projectId, version: (last ? last.version : 0) + 1, label: label || null, note: note || null,
      snapshot: JSON.stringify(snapshot), total, itemCount, createdBy: createdBy || null,
    } });
  }

  // Replace the working bill with a set of sections. Used by import and restore.
  async function writeBoq(projectId, sections) {
    await prisma.boqSection.deleteMany({ where: { projectId } }); // items cascade
    let pos = 0;
    for (const s of sections) {
      const items = Array.isArray(s.items) ? s.items : [];
      await prisma.boqSection.create({ data: {
        projectId, code: s.code ? String(s.code) : null, title: String(s.title || 'Untitled section').slice(0, 300), position: pos++,
        items: { create: items.filter((i) => String(i.description || '').trim()).map((i, idx) => ({
          code: i.code ? String(i.code) : null,
          description: String(i.description).trim().slice(0, 1000),
          unit: String(i.unit || 'item').slice(0, 20),
          quantity: num(i.quantity), rate: num(i.rate), amount: boqAmount(i.quantity, i.rate),
          costCodeId: i.costCodeId || null, position: idx,
        })) },
      } });
    }
  }

  app.get('/api/projects/:projectId/boq/revisions', auth, async (req, res) => {
    try {
      res.json(await prisma.boqRevision.findMany({
        where: { projectId: req.params.projectId }, orderBy: { version: 'desc' },
        select: { id: true, version: true, label: true, note: true, total: true, itemCount: true, createdBy: true, createdAt: true },
      }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/projects/:projectId/boq/revisions', auth, async (req, res) => {
    try {
      if (!hasRole(req, CAN_MANAGE_BIDS)) return res.status(403).json({ error: 'Not allowed' });
      const rev = await snapshotBoq(req.params.projectId, { label: (req.body || {}).label, note: (req.body || {}).note, createdBy: who(req) });
      if (!rev) return res.status(400).json({ error: 'The bill is empty — there is nothing to save as a revision' });
      res.json(rev);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.get('/api/boq/revisions/:id', auth, async (req, res) => {
    try {
      const r = await prisma.boqRevision.findUnique({ where: { id: req.params.id } });
      if (!r) return res.status(404).json({ error: 'Not found' });
      res.json({ ...r, snapshot: JSON.parse(r.snapshot || '[]') });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  // Restoring an old revision first freezes the current bill, so nothing is lost
  // either way.
  app.post('/api/boq/revisions/:id/restore', auth, async (req, res) => {
    try {
      if (!hasRole(req, CAN_MANAGE_BIDS)) return res.status(403).json({ error: 'Not allowed' });
      const r = await prisma.boqRevision.findUnique({ where: { id: req.params.id } });
      if (!r) return res.status(404).json({ error: 'Not found' });
      await snapshotBoq(r.projectId, { label: `Before restoring V${r.version}`, createdBy: who(req) });
      await writeBoq(r.projectId, JSON.parse(r.snapshot || '[]'));
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Import a bill parsed in the browser (xlsx/csv → rows). `mode` "replace"
  // snapshots the current bill as a revision first; "append" adds sections.
  app.post('/api/projects/:projectId/boq/import', auth, async (req, res) => {
    try {
      if (!hasRole(req, CAN_MANAGE_BIDS)) return res.status(403).json({ error: 'Forbidden: ' + ((req.user && req.user.role) || 'this role') + ' cannot import a bill of quantities' });
      const projectId = req.params.projectId;
      const b = req.body || {};
      const sections = Array.isArray(b.sections) ? b.sections : [];
      const itemCount = sections.reduce((a, s) => a + (Array.isArray(s.items) ? s.items.length : 0), 0);
      if (!itemCount) return res.status(400).json({ error: 'No priced items were found in the file' });
      const mode = b.mode === 'append' ? 'append' : 'replace';
      let revision = null;
      if (mode === 'replace') {
        revision = await snapshotBoq(projectId, { label: b.label || 'Before import', createdBy: who(req) });
        await writeBoq(projectId, sections);
      } else {
        const count = await prisma.boqSection.count({ where: { projectId } });
        let pos = count;
        for (const s of sections) {
          const items = Array.isArray(s.items) ? s.items : [];
          await prisma.boqSection.create({ data: {
            projectId, code: s.code ? String(s.code) : null, title: String(s.title || 'Imported').slice(0, 300), position: pos++,
            items: { create: items.filter((i) => String(i.description || '').trim()).map((i, idx) => ({
              code: i.code ? String(i.code) : null, description: String(i.description).trim().slice(0, 1000),
              unit: String(i.unit || 'item').slice(0, 20), quantity: num(i.quantity), rate: num(i.rate), amount: boqAmount(i.quantity, i.rate), position: idx,
            })) },
          } });
        }
      }
      res.json({ ok: true, mode, sections: sections.length, items: itemCount, snapshotVersion: revision ? revision.version : null });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Rate library ──────────────────────────────────────────────────────────
  app.get('/api/rate-library', auth, async (req, res) => {
    try {
      const q = String(req.query.q || '').trim().toLowerCase();
      const rows = await prisma.rateLibraryItem.findMany({ orderBy: [{ category: 'asc' }, { description: 'asc' }] });
      res.json(q ? rows.filter((r) => `${r.code || ''} ${r.description} ${r.unit} ${r.category || ''}`.toLowerCase().includes(q)) : rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  const pickRate = (b) => ({
    code: b.code ? String(b.code).slice(0, 40) : null,
    description: String(b.description || '').trim().slice(0, 500),
    unit: String(b.unit || 'item').slice(0, 20),
    rate: num(b.rate), category: b.category ? String(b.category).slice(0, 80) : null,
    source: b.source ? String(b.source).slice(0, 200) : null, notes: b.notes ? String(b.notes).slice(0, 1000) : null,
  });
  app.post('/api/rate-library', auth, async (req, res) => {
    try {
      if (!hasRole(req, CAN_MANAGE_BIDS)) return res.status(403).json({ error: 'Not allowed' });
      const d = pickRate(req.body || {});
      if (!d.description) return res.status(400).json({ error: 'Describe the item' });
      res.json(await prisma.rateLibraryItem.create({ data: d }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.put('/api/rate-library/:id', auth, async (req, res) => {
    try {
      if (!hasRole(req, CAN_MANAGE_BIDS)) return res.status(403).json({ error: 'Not allowed' });
      const b = req.body || {};
      const d = {};
      for (const [k, v] of Object.entries(pickRate(b))) if (b[k] !== undefined) d[k] = v;
      res.json(await prisma.rateLibraryItem.update({ where: { id: req.params.id }, data: d }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.delete('/api/rate-library/:id', auth, async (req, res) => {
    try {
      if (!hasRole(req, CAN_MANAGE_BIDS)) return res.status(403).json({ error: 'Not allowed' });
      await prisma.rateLibraryItem.delete({ where: { id: req.params.id } });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  // Starter set of common items so the library is useful on day one. Figures are
  // indicative Nairobi-area rates and are meant to be edited to the company's own
  // market — the point is a reference to check a quote against, not a price list.
  const STARTER_RATES = [
    ['Substructure', 'Site clearance and grubbing', 'm2', 120],
    ['Substructure', 'Excavate for foundations, not exceeding 1.5m deep', 'm3', 850],
    ['Substructure', 'Backfill with selected excavated material, compacted', 'm3', 650],
    ['Substructure', 'Hardcore filling 300mm thick, compacted', 'm3', 2800],
    ['Substructure', 'Anti-termite treatment to blinding', 'm2', 180],
    ['Substructure', 'Mass concrete class 15 blinding 50mm', 'm2', 1100],
    ['Substructure', 'Reinforced concrete class 20/20 in foundations', 'm3', 16500],
    ['Substructure', 'Reinforced concrete class 25/20 in ground slab', 'm3', 17500],
    ['Substructure', 'High yield steel reinforcement (Y12–Y16)', 'kg', 185],
    ['Substructure', 'Damp proof membrane 1000 gauge polythene', 'm2', 150],
    ['Superstructure', 'Reinforced concrete class 25/20 in columns', 'm3', 18500],
    ['Superstructure', 'Reinforced concrete class 25/20 in beams', 'm3', 18500],
    ['Superstructure', 'Reinforced concrete class 25/20 in suspended slab 150mm', 'm3', 18000],
    ['Superstructure', 'Sawn formwork to sides of columns and beams', 'm2', 950],
    ['Superstructure', 'Sawn formwork to soffits of slabs', 'm2', 1050],
    ['Walling', '200mm machine-cut stone walling in cement mortar', 'm2', 1650],
    ['Walling', '150mm machine-cut stone walling in cement mortar', 'm2', 1450],
    ['Walling', 'Hoop iron reinforcement to every alternate course', 'm', 45],
    ['Roofing', 'Structural timber roof trusses, treated', 'm2', 2400],
    ['Roofing', 'Pre-painted gauge 28 box profile roofing sheets', 'm2', 1350],
    ['Roofing', 'Concrete roofing tiles on battens', 'm2', 2100],
    ['Roofing', 'PVC gutters 150mm with brackets', 'm', 850],
    ['Finishes', '12mm cement/sand plaster to internal walls', 'm2', 550],
    ['Finishes', '15mm cement/sand render to external walls', 'm2', 620],
    ['Finishes', '40mm cement/sand screed to floors', 'm2', 620],
    ['Finishes', 'Ceramic floor tiles 300x300 on screed', 'm2', 2200],
    ['Finishes', 'Porcelain floor tiles 600x600 on screed', 'm2', 3400],
    ['Finishes', 'Ceramic wall tiles to wet areas', 'm2', 2400],
    ['Finishes', 'Gypsum ceiling board on metal grid', 'm2', 1800],
    ['Finishes', 'Three coats emulsion paint to plastered walls', 'm2', 320],
    ['Finishes', 'Three coats gloss paint to timber', 'm2', 480],
    ['Doors & Windows', 'Steel casement window incl. glazing and ironmongery', 'm2', 8500],
    ['Doors & Windows', 'Aluminium sliding window incl. glazing', 'm2', 12500],
    ['Doors & Windows', 'Flush hardwood door 900x2100 incl. frame and ironmongery', 'no', 18500],
    ['Doors & Windows', 'Steel security door 900x2100 incl. frame', 'no', 32000],
    ['Services', 'PVC soil and waste pipe 100mm', 'm', 950],
    ['Services', 'PPR cold water pipe 20mm', 'm', 380],
    ['Services', 'Lighting point wired in 1.5mm2 cable in conduit', 'no', 3200],
    ['Services', 'Socket outlet 13A twin, wired in 2.5mm2 cable', 'no', 3800],
    ['Services', 'Consumer unit 12-way with MCBs', 'no', 28000],
    ['External works', 'Reinforced concrete paving 100mm thick', 'm2', 2600],
    ['External works', 'Cabro paving 60mm on sand bed', 'm2', 1650],
    ['Preliminaries', 'Site supervision (foreman)', 'days', 2500],
    ['Preliminaries', 'Skilled labour (mason/carpenter)', 'days', 1500],
    ['Preliminaries', 'Unskilled labour', 'days', 800],
  ];
  app.post('/api/rate-library/seed', auth, async (req, res) => {
    try {
      if (!hasRole(req, CAN_MANAGE_BIDS)) return res.status(403).json({ error: 'Not allowed' });
      const existing = await prisma.rateLibraryItem.count();
      if (existing > 0 && !(req.body && req.body.force)) return res.status(409).json({ error: 'The library already has rates. Add items individually instead.' });
      let created = 0;
      for (const [category, description, unit, rate] of STARTER_RATES) {
        await prisma.rateLibraryItem.create({ data: { category, description, unit, rate, source: 'Starter set — indicative, edit to your market' } });
        created += 1;
      }
      res.json({ ok: true, created });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Variations (KES) ──────────────────────────────────────────────────────
  // A thin wrapper over change orders that takes the value in shillings and
  // keeps costUSD in step, so both the hub and the Change Orders module agree.
  app.post('/api/projects/:projectId/variations', auth, async (req, res) => {
    try {
      if (!hasRole(req, CAN_CREATE_CO)) return res.status(403).json({ error: 'Forbidden: ' + ((req.user && req.user.role) || 'this role') + ' cannot log variations' });
      const b = req.body || {};
      if (!String(b.title || '').trim()) return res.status(400).json({ error: 'Give the variation a title' });
      const amountKES = num(b.amountKES);
      const count = await prisma.changeOrder.count({ where: { projectId: req.params.projectId } });
      const row = await prisma.changeOrder.create({ data: {
        projectId: req.params.projectId,
        number: b.number || `VO-${String(count + 1).padStart(3, '0')}`,
        title: String(b.title).trim().slice(0, 300),
        description: b.description || null,
        trigger: b.cause || b.trigger || null,
        area: b.area || null,
        status: b.status || 'drafted',
        amountKES, costUSD: Math.round(amountKES / USD_TO_KES),
        scheduleImpactDays: Number(b.scheduleImpactDays) || 0,
        requestedBy: b.requestedBy || who(req),
        submittedDate: b.submittedDate || new Date().toISOString().slice(0, 10),
      } });
      await logCO(req, row.id, { type: 'created', toStatus: row.status, message: `Logged ${row.number} from the project hub` });
      res.json(row);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.put('/api/projects/:projectId/variations/:id', auth, async (req, res) => {
    try {
      const existing = await prisma.changeOrder.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Not found' });
      const b = req.body || {};
      const isDecision = (b.status === 'approved' || b.status === 'rejected') && b.status !== existing.status;
      if (isDecision && !hasRole(req, ['Contractor', 'Owner', 'Executive', 'Project Manager'])) return res.status(403).json({ error: 'Forbidden: ' + ((req.user && req.user.role) || 'this role') + ' cannot approve variations' });
      if (!isDecision && !hasRole(req, CAN_CREATE_CO)) return res.status(403).json({ error: 'Not allowed' });
      const data = {};
      if (b.title !== undefined) data.title = String(b.title).slice(0, 300);
      if (b.description !== undefined) data.description = b.description || null;
      if (b.cause !== undefined) data.trigger = b.cause || null;
      if (b.status !== undefined) data.status = b.status;
      if (b.scheduleImpactDays !== undefined) data.scheduleImpactDays = Number(b.scheduleImpactDays) || 0;
      if (b.amountKES !== undefined) { data.amountKES = num(b.amountKES); data.costUSD = Math.round(num(b.amountKES) / USD_TO_KES); }
      const row = await prisma.changeOrder.update({ where: { id: req.params.id }, data });
      if (b.status && b.status !== existing.status) await logCO(req, row.id, { type: 'status', fromStatus: existing.status, toStatus: b.status, message: `Status changed to ${b.status}` });
      else await logCO(req, row.id, { type: 'edited', message: 'Updated from the project hub' });
      res.json(row);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Payment certificates (main contract) ──────────────────────────────────
  // A certificate is a payment application with no subcontract. The cumulative
  // and previous-certified figures are derived from the ones already on file so
  // the history cannot drift.
  app.post('/api/projects/:projectId/certificates', auth, async (req, res) => {
    try {
      if (!hasRole(req, CAN_REVIEW_FINANCE)) return res.status(403).json({ error: 'Forbidden: ' + ((req.user && req.user.role) || 'this role') + ' cannot record certificates' });
      const projectId = req.params.projectId;
      const b = req.body || {};
      const prior = await prisma.paymentApplication.findMany({ where: { projectId, commitmentId: null } });
      const previousCertified = round2(prior.reduce((s, c) => s + num(c.requestedAmount), 0));
      // Either the gross valuation to date or the amount for this period can be
      // entered — whichever the certificate states.
      let thisPeriod = b.amount != null ? num(b.amount) : null;
      if (thisPeriod == null && b.valuationToDate != null) thisPeriod = num(b.valuationToDate) - previousCertified;
      if (thisPeriod == null || thisPeriod === 0) return res.status(400).json({ error: 'Enter the amount certified this period (or the valuation to date)' });
      // A valuation to date below what is already certified would be a negative
      // certificate. That is almost always a typo, not an intended clawback.
      if (thisPeriod < 0) return res.status(400).json({ error: `That is below the ${Math.round(previousCertified).toLocaleString()} already certified. Enter the gross valuation to date, or the amount for this period.` });
      const retentionPct = b.retentionPct != null ? num(b.retentionPct) : 0;
      const retentionAmount = round2(thisPeriod * retentionPct / 100);
      const advanceRecovery = num(b.advanceRecovery);
      const row = await prisma.paymentApplication.create({ data: {
        projectId, commitmentId: null,
        number: b.number || `IPC-${String(prior.length + 1).padStart(2, '0')}`,
        period: b.period || null,
        periodStart: b.periodStart ? new Date(b.periodStart) : null,
        periodEnd: b.periodEnd ? new Date(b.periodEnd) : null,
        workCompletedThisPeriod: round2(thisPeriod), previousCertified, requestedAmount: round2(thisPeriod),
        retentionPct, retentionAmount, advanceRecovery,
        netPayable: round2(thisPeriod - retentionAmount - advanceRecovery),
        fileUrl: b.fileUrl || null, comments: b.comments || null,
        status: b.status || 'submitted',
      } });
      res.json(row);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.put('/api/projects/:projectId/certificates/:id', auth, async (req, res) => {
    try {
      if (!hasRole(req, CAN_REVIEW_FINANCE)) return res.status(403).json({ error: 'Not allowed' });
      const b = req.body || {};
      const data = {};
      if (b.status !== undefined) data.status = b.status;
      if (b.fileUrl !== undefined) data.fileUrl = b.fileUrl || null;
      if (b.comments !== undefined) data.comments = b.comments || null;
      if (b.period !== undefined) data.period = b.period || null;
      if (b.status === 'approved') { data.approvedById = req.user && req.user.sub; data.approvedAt = new Date(); }
      res.json(await prisma.paymentApplication.update({ where: { id: req.params.id }, data }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Subcontractors & suppliers ────────────────────────────────────────────
  // The directory holds who they are; commitments hold what they were engaged
  // for and what they have been paid. Joined by company/name so the two modules
  // that already exist become one view.
  app.get('/api/subcontractors', auth, async (req, res) => {
    try {
      const [contacts, commitments, projects, apps] = await Promise.all([
        prisma.directoryContact.findMany({ where: { category: { in: ['Subcontractor', 'Supplier'] } }, orderBy: { name: 'asc' } }),
        prisma.commitment.findMany({ orderBy: { createdAt: 'desc' } }),
        prisma.project.findMany({ select: { id: true, name: true, code: true } }),
        prisma.paymentApplication.findMany({ where: { commitmentId: { not: null } }, orderBy: { createdAt: 'desc' } }),
      ]);
      const projName = Object.fromEntries(projects.map((p) => [p.id, p.name]));
      const norm = (s) => String(s || '').trim().toLowerCase();
      const byVendor = {};
      for (const c of commitments) {
        const k = norm(c.vendor);
        (byVendor[k] = byVendor[k] || []).push({ ...c, projectName: projName[c.projectId] || '—', payments: apps.filter((a) => a.commitmentId === c.id) });
      }
      const claimed = new Set();
      const rows = contacts.map((ct) => {
        const keys = [norm(ct.company), norm(ct.name)].filter(Boolean);
        const mine = [];
        for (const k of keys) if (byVendor[k] && !claimed.has(k)) { mine.push(...byVendor[k]); claimed.add(k); }
        const totals = mine.reduce((t, c) => ({
          contractValue: t.contractValue + num(c.contractValue) + num(c.approvedVariations),
          paidToDate: t.paidToDate + num(c.paidToDate),
          retentionHeld: t.retentionHeld + num(c.retentionHeld),
          balanceRemaining: t.balanceRemaining + num(c.balanceRemaining),
        }), { contractValue: 0, paidToDate: 0, retentionHeld: 0, balanceRemaining: 0 });
        return { contact: ct, commitments: mine, totals };
      });
      // Vendors on a subcontract who are not yet in the directory.
      const unlinked = Object.entries(byVendor).filter(([k]) => !claimed.has(k)).map(([, list]) => ({
        contact: null, vendor: list[0].vendor, commitments: list,
        totals: list.reduce((t, c) => ({
          contractValue: t.contractValue + num(c.contractValue) + num(c.approvedVariations), paidToDate: t.paidToDate + num(c.paidToDate),
          retentionHeld: t.retentionHeld + num(c.retentionHeld), balanceRemaining: t.balanceRemaining + num(c.balanceRemaining),
        }), { contractValue: 0, paidToDate: 0, retentionHeld: 0, balanceRemaining: 0 }),
      }));
      res.json({ subcontractors: rows, unlinked, projects });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Record money actually paid to a subcontractor/supplier against a commitment.
  // Stored as a paid payment application so recomputeCommitment picks it up the
  // same way it picks up certified claims.
  app.post('/api/subcontractors/payments', auth, async (req, res) => {
    try {
      if (!hasRole(req, CAN_REVIEW_FINANCE)) return res.status(403).json({ error: 'Forbidden: ' + ((req.user && req.user.role) || 'this role') + ' cannot record payments' });
      const b = req.body || {};
      const c = await prisma.commitment.findUnique({ where: { id: String(b.commitmentId || '') } });
      if (!c) return res.status(404).json({ error: 'Pick the subcontract this payment is against' });
      const amount = num(b.amount);
      if (amount <= 0) return res.status(400).json({ error: 'Enter the amount paid' });
      const count = await prisma.paymentApplication.count({ where: { commitmentId: c.id } });
      const row = await prisma.paymentApplication.create({ data: {
        projectId: c.projectId, commitmentId: c.id,
        number: b.reference || `PAY-${String(count + 1).padStart(3, '0')}`,
        period: b.date || new Date().toISOString().slice(0, 10),
        periodEnd: b.date ? new Date(b.date) : new Date(),
        workCompletedThisPeriod: amount, previousCertified: num(c.paidToDate), requestedAmount: amount,
        retentionPct: 0, retentionAmount: 0, advanceRecovery: 0, netPayable: amount,
        comments: b.note || null, status: 'paid',
      } });
      const updated = await recomputeCommitment(c.id);
      res.json({ payment: row, commitment: updated });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};
