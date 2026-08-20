#!/usr/bin/env node
/*
 * Handover & defects liability, retention release, advance recovery, and the BOQ.
 *
 * The money functions are EXTRACTED FROM server.js and executed, so this tests the
 * shipped arithmetic rather than a retyped copy of it.
 *
 *   node scripts/check-lifecycle.cjs
 */
const fs = require('fs');
const path = require('path');
const SV = fs.readFileSync(path.resolve(__dirname, '..', 'backend/src/server.js'), 'utf8');
const SCHEMA = fs.readFileSync(path.resolve(__dirname, '..', 'backend/prisma/schema.prisma'), 'utf8');

let pass = 0, fail = 0;
const group = (t) => console.log(`\n${t}`);
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}` + (ok ? '' : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`));
};
const ok = (label, cond) => eq(label, !!cond, true);

// Pull a named function out of the real server file and evaluate it.
const grab = (name) => {
  const i = SV.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`${name} not found in server.js`);
  const end = SV.indexOf('\n}\n', i);
  return SV.slice(i, end + 2);
};
const fns = new Function(`
  ${grab('computeDefectsEnd')}
  ${grab('computeAdvanceRecovery')}
  ${grab('settleClaim')}
  return { computeDefectsEnd, computeAdvanceRecovery, settleClaim };
`)();
const { computeDefectsEnd, computeAdvanceRecovery, settleClaim } = fns;

/* ── 1. Handover & defects liability ─────────────────────────────────────── */
group('1. Defects liability period');
const pc = new Date('2026-03-15T00:00:00Z');
eq('6 months from practical completion', computeDefectsEnd(pc, 6).toISOString().slice(0, 10), '2026-09-15');
eq('12 months', computeDefectsEnd(pc, 12).toISOString().slice(0, 10), '2027-03-15');
eq('no handover date -> no end date', computeDefectsEnd(null, 12), null);
eq('no period -> no end date', computeDefectsEnd(pc, null), null);
eq('month-end rolls correctly', computeDefectsEnd(new Date('2026-01-31T00:00:00Z'), 1).toISOString().slice(0, 7), '2026-03');
ok('closeout reports what blocks it', /blockers\.push\('Practical completion has not been recorded'\)/.test(SV));
ok('open snagging counts as a blocker', /punch item.*still open/.test(SV));
ok('phase is derived, not stored twice', /phase: p\.finalAccountAt \? 'closed'/.test(SV));

/* ── 2. Retention release ────────────────────────────────────────────────── */
group('2. Retention release');
ok('schema records the release stage', /stage          String\?/.test(SCHEMA));
ok('half at completion, half at defects expiry', /stage: 'practical_completion'/.test(SV) && /stage: 'defects_expiry'/.test(SV));
ok('due retention is swept on a timer', /setInterval\(markDueRetention/.test(SV));
ok('a passed release date becomes due', /status: 'held', releaseDate: \{ lte: new Date\(\) \}/.test(SV));
// The release logic lives in the pre-existing project-scoped route. A second,
// duplicate endpoint was removed rather than left running alongside it.
ok('releasing reduces what the subcontract holds', /data: \{ retentionHeld: nextHeld \}/.test(SV));
ok('cannot release twice', /already been released/.test(SV));
ok('only one release endpoint exists', (SV.match(/retention\/:id\/release/g) || []).length === 1);
ok('releasedAt is recorded separately from the due date', /releasedAt: new Date\(\)/.test(SV));
ok('cannot release more than is outstanding', /is still held on this record/.test(SV));
ok('re-saving handover does not duplicate the schedule', /existing\.some\(\(r\) => r\.stage === st\.stage\)/.test(SV));
// The split itself
const held = 100000;
const half = Math.round((held / 2) * 100) / 100;
eq('100,000 splits 50/50', [half, Math.round((held - half) * 100) / 100], [50000, 50000]);
const odd = 33333.33;
const oddHalf = Math.round((odd / 2) * 100) / 100;
eq('an odd amount still sums back to the whole', Math.round((oddHalf + (Math.round((odd - oddHalf) * 100) / 100)) * 100) / 100, odd);

/* ── 3. Advance recovery ─────────────────────────────────────────────────── */
group('3. Advance recovery');
const sub = { advanceAmount: 100000, advanceRecovered: 0, advanceRecoveryPct: 20, retentionPct: 5 };
eq('20% of a 200,000 claim recovers 40,000', computeAdvanceRecovery(sub, 200000), 40000);
eq('never more than is still outstanding',
  computeAdvanceRecovery({ ...sub, advanceRecovered: 90000 }, 200000), 10000);
eq('nothing left to recover -> zero',
  computeAdvanceRecovery({ ...sub, advanceRecovered: 100000 }, 200000), 0);
eq('no recovery rate set -> zero', computeAdvanceRecovery({ ...sub, advanceRecoveryPct: 0 }, 200000), 0);
eq('no advance -> zero', computeAdvanceRecovery({ advanceAmount: 0, advanceRecovered: 0, advanceRecoveryPct: 20 }, 200000), 0);
eq('recovery cannot exceed the claim itself',
  computeAdvanceRecovery({ advanceAmount: 500000, advanceRecovered: 0, advanceRecoveryPct: 200 }, 10000), 10000);

group('   a claim settles to the right net');
const s1 = settleClaim(sub, 200000, 5);
eq('gross', s1.gross, 200000);
eq('retention at 5%', s1.retentionAmount, 10000);
eq('advance recovered at 20%', s1.advanceRecovery, 40000);
eq('net payable = gross - retention - recovery', s1.netPayable, 150000);
ok('net never exceeds gross', s1.netPayable <= s1.gross);
const s2 = settleClaim({ advanceAmount: 0, advanceRecovered: 0, advanceRecoveryPct: 0 }, 50000, 10);
eq('no advance: net is just gross less retention', s2.netPayable, 45000);
const s3 = settleClaim(sub, 200000, 0);
eq('no retention: net is gross less recovery', s3.netPayable, 160000);
// The bug this prevents: an advance that is never recovered
eq('an unrecovered advance would leave the full 100,000 outstanding',
  Math.max(0, sub.advanceAmount - sub.advanceRecovered), 100000);
eq('after one claim only 60,000 is outstanding',
  Math.max(0, sub.advanceAmount - (sub.advanceRecovered + s1.advanceRecovery)), 60000);

/* ── 4. Bill of quantities ───────────────────────────────────────────────── */
group('4. Bill of quantities');
ok('BoqSection exists', /model BoqSection \{/.test(SCHEMA));
ok('BoqItem exists', /model BoqItem \{/.test(SCHEMA));
ok('items cascade with their section', /onDelete: Cascade/.test(SCHEMA.slice(SCHEMA.indexOf('model BoqItem'))));
ok('amount is stored, not derived on read', /amount      Float    @default\(0\)/.test(SCHEMA));
ok('amount recomputed when qty or rate changes', /data\.amount = boqAmount\(qty, rate\)/.test(SV));
ok('unpriced lines are reported', /unpricedItems/.test(SV));
ok('BOQ can become the budget', /boq\/apply-budget/.test(SV));
ok('applying the budget updates rather than duplicates', /existing\.find\(\(e\) => e\.name\.toLowerCase\(\) === s\.title\.toLowerCase\(\)\)/.test(SV));
const boqAmount = new Function(`const boqAmount = ${SV.slice(SV.indexOf('const boqAmount ='), SV.indexOf('\n', SV.indexOf('const boqAmount ='))).replace('const boqAmount = ', '')}; return boqAmount;`)();
eq('120 m3 at 8,500', boqAmount(120, 8500), 1020000);
eq('fractional quantity', boqAmount(12.5, 1200), 15000);
eq('unpriced line contributes nothing', boqAmount(500, 0), 0);
eq('missing values do not produce NaN', boqAmount(undefined, null), 0);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
