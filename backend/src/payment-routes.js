// Payments against payment requests (one per stage): amount, date, method and
// the M-Pesa or bank reference. The request's paid amount and status follow
// from its payments, and the client is told each time, so a client abroad can
// match every shilling to a reference.

module.exports = function paymentRoutes(app, d) {
  const { prisma, prismaBase, auth, currentWs, sendEmail, emailShell, button, APP_URL } = d;
  const METHODS = ['mpesa', 'bank', 'cash', 'cheque', 'other'];
  const LABEL = { mpesa: 'M-Pesa', bank: 'Bank transfer', cash: 'Cash', cheque: 'Cheque', other: 'Other' };
  const today = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const kes = (n) => `KES ${Math.round(Number(n) || 0).toLocaleString('en-KE')}`;
  const dto = (p) => ({ id: p.id, invoiceId: p.invoiceId, amount: p.amount, date: p.date, method: p.method, methodLabel: LABEL[p.method] || p.method, reference: p.reference, note: p.note, recordedBy: p.recordedBy, createdAt: p.createdAt });

  async function ownInvoice(projectId, id) {
    const inv = await prisma.invoice.findUnique({ where: { id } });
    return inv && inv.projectId === projectId && inv.workspaceId === currentWs() ? inv : null;
  }
  /** Paid amount, last paid date and status follow from the payments. */
  async function settle(inv) {
    const pays = await prisma.payment.findMany({ where: { invoiceId: inv.id } });
    const paid = Math.round(pays.reduce((s, p) => s + p.amount, 0));
    const last = pays.map((p) => p.date).sort().pop() || null;
    const status = paid >= (inv.amount || 0) && paid > 0 ? 'paid' : paid > 0 ? 'partial' : (inv.status === 'paid' || inv.status === 'partial' ? 'sent' : inv.status);
    return prisma.invoice.update({ where: { id: inv.id }, data: { paidAmount: paid, paidDate: last, status } });
  }
  /** Everyone on the client side who should hear about this payment. */
  async function clientEmails(inv) {
    if (inv.unitId) {
      const u = await prismaBase.projectUnit.findUnique({ where: { id: inv.unitId } });
      const links = await prismaBase.projectClient.findMany({ where: { projectId: inv.projectId, unitId: inv.unitId }, select: { email: true } });
      return [...new Set([u && u.clientEmail, ...links.map((l) => l.email)].filter(Boolean))];
    }
    const links = await prismaBase.projectClient.findMany({ where: { projectId: inv.projectId, unitId: null }, select: { email: true } });
    return [...new Set(links.map((l) => l.email))];
  }

  app.get('/api/projects/:projectId/invoices/:id/payments', auth, async (req, res) => {
    try {
      const inv = await ownInvoice(req.params.projectId, req.params.id);
      if (!inv) return res.status(404).json({ error: 'Payment request not found' });
      res.json((await prisma.payment.findMany({ where: { invoiceId: inv.id }, orderBy: { date: 'asc' } })).map(dto));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/projects/:projectId/invoices/:id/payments', auth, async (req, res) => {
    try {
      if (req.user?.role === 'Client') return res.status(403).json({ error: 'Not available to clients.' });
      const inv = await ownInvoice(req.params.projectId, req.params.id);
      if (!inv) return res.status(404).json({ error: 'Payment request not found' });
      const b = req.body || {};
      const amount = Number(String(b.amount ?? '').replace(/[, ]/g, ''));
      if (!(amount > 0)) return res.status(400).json({ error: 'Enter the amount received.' });
      const method = METHODS.includes(b.method) ? b.method : 'mpesa';
      const reference = String(b.reference || '').trim().toUpperCase().slice(0, 60) || null;
      if (method !== 'cash' && !reference) return res.status(400).json({ error: method === 'mpesa' ? 'Enter the M-Pesa code (e.g. QK12AB34CD).' : 'Enter the payment reference.' });
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? b.date : today();
      if (date > today()) return res.status(400).json({ error: "The payment date can't be in the future." });
      // The same reference twice is almost always the same payment recorded twice.
      if (reference && !b.allowDuplicate) {
        const dup = await prisma.payment.findFirst({ where: { reference } });
        if (dup) return res.status(409).json({ error: `${reference} is already recorded (${kes(dup.amount)} on ${dup.date}). If this really is a second payment, record it again and confirm.`, code: 'DUPLICATE_REFERENCE' });
      }
      const p = await prisma.payment.create({ data: { invoiceId: inv.id, projectId: inv.projectId, unitId: inv.unitId || null, amount, date, method, reference, note: String(b.note || '').slice(0, 500) || null, recordedBy: req.user?.name || null } });
      const updated = await settle(inv);
      if (b.notify !== false) {
        const proj = await prismaBase.project.findUnique({ where: { id: inv.projectId } });
        const balance = Math.max(0, (updated.amount || 0) - (updated.paidAmount || 0));
        const subject = `Payment received: ${kes(amount)} for ${proj ? proj.name : 'your project'}`;
        const html = `<p style="font-size:14px;color:#11161D">We've received your payment of <b>${kes(amount)}</b> (${LABEL[method]}${reference ? `, ref <b>${reference}</b>` : ''}) on ${date} against payment request ${inv.invoiceNumber}.</p>`
          + `<p style="font-size:14px;color:#11161D">${balance ? `Balance on this request: <b>${kes(balance)}</b>.` : 'This payment request is now <b>fully paid</b>. Thank you.'}</p>`
          + `<p style="font-size:12px;color:#8A95A5">This is a payment confirmation, not a tax invoice.</p>`
          + button(`${APP_URL}/?as=client&project=${inv.projectId}`, 'See it in Buildsasa');
        for (const to of await clientEmails(inv)) sendEmail({ to, subject, html: emailShell(subject, html) }).catch(() => {});
      }
      res.json({ payment: dto(p), invoice: updated });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/projects/:projectId/invoices/:id/payments/:pid', auth, async (req, res) => {
    try {
      if (req.user?.role === 'Client') return res.status(403).json({ error: 'Not available to clients.' });
      const inv = await ownInvoice(req.params.projectId, req.params.id);
      if (!inv) return res.status(404).json({ error: 'Payment request not found' });
      await prisma.payment.deleteMany({ where: { id: req.params.pid, invoiceId: inv.id } });
      res.json({ invoice: await settle(inv) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /** Payments for a set of invoices, for client-facing views. */
  d.paymentsFor = async (invoiceIds) => {
    if (!invoiceIds.length) return {};
    const rows = await prismaBase.payment.findMany({ where: { invoiceId: { in: invoiceIds } }, orderBy: { date: 'asc' } });
    const out = {};
    for (const p of rows) (out[p.invoiceId] = out[p.invoiceId] || []).push({ amount: p.amount, date: p.date, method: LABEL[p.method] || p.method, reference: p.reference });
    return out;
  };
};
