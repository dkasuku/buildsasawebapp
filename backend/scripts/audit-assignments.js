#!/usr/bin/env node
/*
 * Audit project team assignments for rows whose userId is not a real user.
 *
 * WHY THIS EXISTS
 * ---------------
 * The New / Edit Project form used to offer HARDCODED JOB TITLES in its PM /
 * Architect / QS pickers — "Site Manager (You)", "Lead Architect", "Cost
 * Controller" — while Assignment.userId is a foreign key onto User.id. Rows
 * written before that constraint was enforced hold a job title where a user id
 * belongs, which is why project cards can read "PM: Project Manager": a label
 * that looks like a person's name but refers to nobody.
 *
 * READ-ONLY BY DEFAULT. It prints what it finds and changes nothing.
 * Pass --fix to delete the unresolvable rows (the roles then show as unassigned
 * and can be set properly in the Edit Project dialog).
 *
 *   node scripts/audit-assignments.js
 *   node scripts/audit-assignments.js --fix
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const FIX = process.argv.includes('--fix');

async function main() {
  const assignments = await prisma.assignment.findMany();
  if (assignments.length === 0) {
    console.log('No assignments in this database.');
    return;
  }

  const userIds = [...new Set(assignments.map((a) => a.userId).filter(Boolean))];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const known = new Map(users.map((u) => [u.id, u.name]));

  const bad = assignments.filter((a) => !a.userId || !known.has(a.userId));
  const projectIds = [...new Set(bad.map((a) => a.projectId))];
  const projects = projectIds.length
    ? await prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } })
    : [];
  const projName = new Map(projects.map((p) => [p.id, p.name]));

  console.log(`Assignments total : ${assignments.length}`);
  console.log(`Resolve to a user : ${assignments.length - bad.length}`);
  console.log(`Do NOT resolve    : ${bad.length}`);

  if (bad.length === 0) {
    console.log('\nNothing to clean up.');
    return;
  }

  console.log('\nUnresolvable rows — the stored userId is not a real user:\n');
  for (const a of bad) {
    console.log(`  ${(projName.get(a.projectId) || a.projectId).padEnd(34)} ${String(a.role).padEnd(12)} userId=${JSON.stringify(a.userId)}`);
  }

  if (!FIX) {
    console.log('\nRead-only. Re-run with --fix to delete these rows.');
    console.log('Those roles will then show as unassigned, and you can set them');
    console.log('properly in Edit Project, where the pickers now list real teammates.');
    return;
  }

  const result = await prisma.assignment.deleteMany({ where: { id: { in: bad.map((a) => a.id) } } });
  console.log(`\nDeleted ${result.count} unresolvable assignment row(s).`);
  console.log('Set the roles again in Edit Project when you are ready.');
}

main()
  .catch((e) => { console.error('Audit failed:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
