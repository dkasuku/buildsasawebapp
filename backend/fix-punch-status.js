#!/usr/bin/env node
/* ===========================================================================
 * One-off data fix: normalize PunchItem.status to the app's canonical values.
 * Older seed data stored 'Open' / 'In Progress' / 'Closed'; the app expects
 * 'open' / 'in_progress' / 'closed' (etc.). This rewrites any non-canonical
 * value in place — no data is deleted.
 *
 * Run from the backend folder:   node fix-punch-status.js
 * ======================================================================== */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const CANON = ['open', 'in_progress', 'ready_for_review', 'resolved', 'closed', 'rejected'];

function normalize(s) {
  if (!s) return 'open';
  const v = String(s).trim().toLowerCase().replace(/[\s-]+/g, '_');
  return CANON.includes(v) ? v : 'open'; // anything unrecognized → open
}

(async () => {
  try {
    const items = await prisma.punchItem.findMany({ select: { id: true, status: true } });
    let fixed = 0;
    for (const it of items) {
      const next = normalize(it.status);
      if (next !== it.status) {
        await prisma.punchItem.update({ where: { id: it.id }, data: { status: next } });
        console.log(`  ${it.id}: '${it.status}' -> '${next}'`);
        fixed++;
      }
    }
    console.log(`\nDone. ${fixed} of ${items.length} punch item(s) normalized.`);
  } catch (e) {
    console.error('Failed:', e.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
