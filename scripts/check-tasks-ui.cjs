const fs=require('fs'),path=require('path');
const R=(f)=>fs.readFileSync(path.resolve(__dirname,'..','src/app/components/constructai',f),'utf8');
const TK=R('Tasks.tsx'), CHIP=R('InlineSelectChip.tsx');
let pass=0,fail=0;
const ok=(l,c)=>{c?pass++:fail++;console.log(`  ${c?'PASS':'FAIL'}  ${l}`);};

console.log('\nThe chip that reports a value also sets it');
ok('InlineSelectChip exists', /export function InlineSelectChip/.test(CHIP));
ok('project chip is settable', TK.indexOf('onChange={(v) => setChecklistProject(c, v)}') >= 0);
ok('trade chip is settable', TK.indexOf('onChange={(v) => setChecklistTrade(c, v)}') >= 0);
ok('unset project is flagged, not neutral', TK.indexOf('tone="warn"') >= 0);
ok('chips respect permission', TK.indexOf('disabled={!canAssign}') >= 0);
ok('static project chip is gone', TK.indexOf('rounded bg-[#F5A623]/15 text-[#F5A623] border border-[#F5A623]/30" title="Progress reported') < 0);

console.log('\nOptimistic, but honest about failure');
ok('project change rolls back on error', /setChecklists\(before\);[\s\S]{0,120}Could not set the project/.test(TK));
ok('trade change rolls back on error', /setChecklists\(before\);[\s\S]{0,120}Could not set the trade/.test(TK));

console.log('\nAssign is reachable after the first assignment');
ok('Reassign shown beyond draft', TK.indexOf('c.status === "draft" ? "Assign" : "Reassign"') >= 0);
ok('draft-only gate removed', TK.indexOf('c.status === "draft" && canAssign && <button onClick={() => setAssign(c)}') < 0);

console.log('\nOrphans can be fixed in bulk');
ok('bulk linker exists', /async function linkAllOrphans/.test(TK));
ok('offered on the banner', TK.indexOf('linkAllOrphans(v)') >= 0);
ok('partial failure is reported, not hidden', /\$\{done\} linked, \$\{failed\} could not be/.test(TK));
ok('banner no longer says to open Assign on each', TK.indexOf('Open Assign on each to pick one') < 0);

console.log('\nThe menu cannot strand the user');
ok('closes on outside click', /mousedown/.test(CHIP));
ok('closes on Escape', /e\.key === "Escape"/.test(CHIP));
ok('listeners are cleaned up', /removeEventListener/.test(CHIP));
ok('shows a spinner while saving', /Loader2/.test(CHIP));
ok('marks the current value', /Check className/.test(CHIP));
ok('row click is not triggered by the chip', /e\.stopPropagation\(\)/.test(CHIP));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail?1:0);
