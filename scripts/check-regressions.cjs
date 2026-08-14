#!/usr/bin/env node
/*
 * Regression guards for bugs that were live in production and are easy to
 * reintroduce, because each one was invisible: the UI looked fine and the wrong
 * thing happened quietly.
 *
 *   node scripts/check-regressions.cjs
 *
 * These are source-level assertions, not a unit-test suite. They read the real
 * files (and execute the real helpers where practical), so they track shipped
 * code rather than a retyped copy. Run before a release; exits non-zero on
 * failure.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

const CL = read('src/app/components/constructai/Checklists.tsx');
const TK = read('src/app/components/constructai/Tasks.tsx');
const PJ = read('src/app/components/constructai/Projects.tsx');
const CO = read('src/app/components/constructai/ChangeOrders.tsx');
const CUR = read('src/app/components/constructai/currency.ts');
const ROLES = read('src/app/components/constructai/roles.ts');
const BID = read('src/app/components/constructai/Bidding.tsx');
const API = read('src/app/services/api.ts');
const SV = read('backend/src/server.js');
const SCHEMA = read('backend/prisma/schema.prisma');

let pass = 0, fail = 0;
const group = (t) => console.log(`\n${t}`);
const ok = (label, cond, detail) => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? `\n         ${detail}` : ''}`); }
};
const eq = (label, got, want) => ok(label, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

/* ---------------------------------------------------------------- typing --
 * A component declared inside another component's body gets a new function
 * identity on every render. React treats a changed element type as a different
 * component, so each keystroke unmounted the field and destroyed the focused
 * <input> — you could type only one character at a time.
 */
group('Form fields keep focus while typing');
for (const [name, src] of [['ChangeOrders', CO], ['PunchListPro', read('src/app/components/constructai/PunchListPro.tsx')], ['Equipment', read('src/app/components/constructai/Equipment.tsx')]]) {
  const nested = /^\s{2,}const [A-Z][A-Za-z]* = \(\{[^}]*(?:label|title)[^}]*\}[^)]*\) => \(/m.test(src);
  ok(`${name}: field wrapper is at module scope`, !nested);
}

/* -------------------------------------------------------------- currency --
 * Costs are stored in USD but every screen displays the workspace currency. A
 * form labelled "(USD)" next to totals rendered in KSh meant a user typing
 * 260000 meaning shillings recorded $260,000.
 */
group('Money is denominated where the user can see it');
ok('change-order cost field follows the workspace currency', /Cost impact \(\$\{CURRENCIES\[currency\]\.code\}\)/.test(CO));
// Match the LABEL, not the comment that explains why it changed.
ok('hardcoded "(USD)" label gone', !/label="Cost impact \(USD\)"/.test(CO));
ok('USD_TO_KES has one definition', /export const USD_TO_KES = 1 \/ RATES\.USD/.test(CUR));
ok('ChangeOrders imports it', /USD_TO_KES[^;]*from "\.\/currency"/.test(CO));
ok('no file redefines the rate', !/const USD_TO_KES = 130/.test(CO));
eq('only KSh and $ are offered', (PJ.match(/const CURRENCY_OPTIONS = \[(.*?)\]/)?.[1] || '').replace(/\s|"/g, '').split(','), ['KSh', '$']);

/* --------------------------------------------------------------- approval --
 * approveLimit is a USD figure (RoleManager labels it "Max dollar value").
 * Comparing it against a KSh amount made every limit ~130x too strict.
 */
group('Approval limits compare like with like');
// The ceiling lived only in the deleted full-page screen; consolidating without
// porting it would have let a PM with a $250k limit approve any amount.
ok('ceiling is enforced on the surviving panel', /const withinLimit = \(Number\(co\.costUSD\) \|\| 0\) <= approveLimit/.test(CO));
ok('refusal names the limit', /can approve up to \$\{limitLabel\}/.test(CO));
ok('limit is passed into the panel', /approveLimit=\{approveLimit\}/.test(CO));

/* ------------------------------------------------------------ fabricated --
 * Invented figures shown as though they were the record's own.
 */
group('One change order has one detail view');
ok('full-page duplicate removed', !exists('src/app/components/constructai/ChangeOrderDetail.tsx'));
ok('no dangling import', !/ChangeOrderDetail/.test(read('src/app/App.tsx')));
ok('no role still lists the retired view', !/"change-order"/.test(ROLES));
ok('deep-link opens the surviving panel', /openId=\{activeChangeOrderId\}/.test(read('src/app/App.tsx')));
ok('demo seed id gone', !/useState\("CO-1258"\)/.test(read('src/app/App.tsx')));

/* ------------------------------------------------------------- percentage --
 * responses holds one row PER USER PER QUESTION, so responses/questions
 * exceeded 100% as soon as two people were assigned.
 */
group('Completion percentage cannot exceed 100%');
ok('counts distinct answered questions', /const ids = new Set\(\(c\.responses \|\| \[\]\)\.filter/.test(CL));
ok('clamped to 100', /Math\.min\(100, Math\.round\(\(answeredQuestionCount/.test(CL));
ok('Tasks shares the definition, not a copy', /const pct = checklistProgress;/.test(TK));
ok('old formula gone', !/\(c\.responses\?\.length \|\| 0\) \/ c\.questions\.length/.test(CL + TK));

/* ------------------------------------------------------------ sub-question --
 * The editor omits parentId; the API treated the omission as "clear it", so
 * editing a sub-question promoted it to top level and the edit looked lost.
 */
group('Editing a sub-question keeps it nested');
ok('client sends parentId', /parentId: q\.parentId \?\? null/.test(CL));
const qput = SV.slice(SV.indexOf("app.put('/api/checklists/:id/questions/:questionId'"));
ok('server only writes fields it was sent', /if \(parentId !== undefined\) data\.parentId = parentId \|\| null/.test(qput.slice(0, 1400)));
ok('unconditional clobber gone', !/data: \{ question, questionType, required: !!required, position, options[^}]*parentId: parentId \|\| null \}/.test(SV));

/* ------------------------------------------------------------------ links --
 * An unlinked checklist is excluded from the project roll-up and from every
 * project dashboard, silently.
 */
group('Checklists get linked to a project');
ok('Assign carries a project selector', /export function AssignModal\(\{ checklist, projects, onClose, onAssign \}/.test(CL));
ok('warns when left unlinked', /will not roll up/.test(CL));
ok('assign saves people and project together', /if \(projectId !== undefined\) data\.projectId = projectId \|\| null/.test(SV));
ok('existing assignees are pre-selected', /checklist\.assignedTo \? JSON\.parse\(checklist\.assignedTo\) : \[\]/.test(CL));
ok('orphans are counted', /const orphanCount = useMemo/.test(TK));
for (const [n, s] of [['Checklists', CL], ['Tasks', TK]]) ok(`${n} can filter to orphans`, /value="__none"/.test(s));

/* -------------------------------------------------------------- assignees --
 * join(", ") over eight names produced a line wider than the card, truncated
 * mid-name, with no count.
 */
group('Assignee lists stay legible');
ok('shared summary helper', /export function assigneeSummary/.test(CL));
for (const [n, s] of [['Checklists', CL], ['Tasks', TK]]) {
  ok(`${n} shows a count`, /\{a\.count\} assigned/.test(s));
  ok(`${n} no longer joins every name`, !/ids\.map\(\(id\) => resolveName\(id\)\)\.join\(", "\)/.test(s));
}

/* ----------------------------------------------------------------- project --
 * Assignment.userId is a foreign key onto User.id; the pickers offered job
 * titles, so saving the team always failed the constraint.
 */
group('Project team saves real users');
ok('hardcoded job-title options gone', !/^const PM_OPTIONS = \[/m.test(PJ));
ok('pickers are backed by the team', /const team = useTeam\(\);/.test(PJ));
eq('all six pickers converted', (PJ.match(/<MemberSelect/g) || []).length, 6);
ok('server validates ids before writing', /No such teammate for \$\{role\}/.test(SV));
ok('contract value carries its currency', /valueCurrency: parsedValue\.currency/.test(PJ));
ok('blanket x130 conversion gone', !/parseCompactValue\(p\.value \|\| "0"\) \* 130/.test(PJ));

/* ------------------------------------------------------------------- bids --
 * The UI gated on manageTeam||financials while the API used its own list, so
 * an Architect and a QS saw buttons that always returned 403.
 */
group('Tender permissions agree across the stack');
const list = (src, re) => (src.match(re)?.[1] || '').split(',').map((s) => s.replace(/['"\s\]]/g, '')).filter(Boolean);
const uiM = list(ROLES, /export const BID_MANAGER_ROLES: Role\[\] = \[([\s\S]*?)\];/).sort();
const beM = list(SV, /const CAN_MANAGE_BIDS = \[(.*?)\];/).sort();
const uiA = list(ROLES, /export const BID_AWARDER_ROLES: Role\[\] = \[([\s\S]*?)\];/).sort();
const beA = list(SV, /const CAN_AWARD_BIDS = \[(.*?)\];/).sort();
eq('manage lists identical', uiM, beM);
eq('award lists identical', uiA, beA);
ok('award is a subset of manage', uiA.every((r) => uiM.includes(r)));
ok('UI uses the shared helpers', /canManageBids\(role\)/.test(BID) && /canAwardBids\(role\)/.test(BID));
ok('loose permission check gone', !/perms\.manageTeam \|\| perms\.financials/.test(BID));
ok('deadline is enforced, not just shown', /function isTenderClosed\(dueDate\)/.test(SV));
ok('award raises the subcontract', /prisma\.commitment\.create/.test(SV));
ok('award adds the winner to the directory', /prisma\.directoryContact\.create/.test(SV));

// exercise the real deadline helper
{
  const src = SV.slice(SV.indexOf('function isTenderClosed'));
  const fn = new Function(`${src.slice(0, src.indexOf('\n}') + 2)}; return isTenderClosed;`)();
  eq('no deadline never closes', fn(null), false);
  eq('past deadline closes', fn('2020-01-01'), true);
  eq('future stays open', fn('2099-12-31'), false);
  eq('unparseable never blocks a bidder', fn('not-a-date'), false);
  eq('the deadline day itself is still open', fn(new Date().toISOString().slice(0, 10)), false);
}

/* ------------------------------------------------------------ attribution --
 * Field progress fed the project's headline bar with no record of who set it.
 */
group('Reported progress is attributable');
ok('schema records the reporter', /reportedProgressBy String\?/.test(SCHEMA));
ok('route stamps it', /reportedProgressBy: req\.user\.sub/.test(SV));
ok('row shows who reported', /resolveName\(c\.reportedProgressBy\)/.test(TK));
ok('roll-up names the reporters', /r\.reporters\.map\(resolveName\)/.test(TK));
ok('submission notifies the responsible people', /A checklist came back/.test(SV));

/* -------------------------------------------------------------- dead code --*/
group('Dead code stays deleted');
ok('FeatureTour.tsx removed', !exists('src/app/components/constructai/FeatureTour.tsx'));
ok('PunchList.tsx removed (superseded by PunchListPro)', !exists('src/app/components/constructai/PunchList.tsx'));
ok('no dangling PunchList import', !/from "\.\/components\/constructai\/PunchList"/.test(read('src/app/App.tsx')));

/* ------------------------------------------------------------------- misc --*/
group('Public tender page and API types are in step');
ok('public package reports closed state', /closed\?: boolean/.test(API));
ok('assignChecklist takes a project', /assignChecklist: \(id: string, userIds: string\[\], projectId\?: string \| null\)/.test(API));


/* --------------------------------------------------------- one forms area --
 * Digitized Forms duplicated what Checklists already did (authoring, public
 * sharing, responses) over a parallel FormTemplate store, so the same job had
 * two homes and users had to guess which one was real.
 */
group('Forms and checklists have one home');
ok('Digitized Forms retired', !exists('src/app/components/constructai/DigitizedForms.tsx'));
ok('no dangling import', !/DigitizedForms/.test(read('src/app/App.tsx')));
ok('nav entry gone', !/"forms"/.test(read('src/app/components/constructai/Sidebar.tsx')));
ok('no role still lists it', !/"forms"/.test(ROLES));
ok('public responses reachable from the template card', /title="Public link responses"/.test(CL));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
