#!/usr/bin/env node
/*
 * The four lifecycle features have screens, and their tables line up.
 *
 * The column check exists because a careless find-and-replace put a Stage header
 * on the commitments table while its cell went to retention, leaving both tables
 * misaligned. Counting headers against cells catches that class of mistake.
 */
const fs=require('fs'),path=require('path');
const R=(f)=>fs.readFileSync(path.resolve(__dirname,'..','src/app/components/constructai',f),'utf8');
const BOQ=R('BoqEditor.tsx'), CO=R('ProjectCloseout.tsx'), FIN=R('Financials.tsx'), PD=R('ProjectDetail.tsx');
let pass=0,fail=0;
const ok=(l,c)=>{c?pass++:fail++;console.log(`  ${c?'PASS':'FAIL'}  ${l}`);};
console.log('\nEvery backend feature now has a screen');
ok('BOQ editor exists', /export function BoqEditor/.test(BOQ));
ok('BOQ is a Financials tab', /id: "boq", label: "Bill of Quantities"/.test(FIN));
ok('BOQ tab renders the editor', /tab === "boq" && <BoqEditor/.test(FIN));
ok('Closeout panel exists', /export function ProjectCloseout/.test(CO));
ok('Closeout is a ProjectDetail tab', /key: "closeout" as const, label: "Closeout"/.test(PD));
ok('Closeout tab renders the panel', /tab === "closeout" && <ProjectCloseout/.test(PD));

console.log('\nBOQ editor is wired to the real endpoints');
for (const m of ['getBoq','addBoqSection','addBoqItem','deleteBoqItem','deleteBoqSection','applyBoqBudget'])
  ok(`uses api.${m}`, BOQ.indexOf("api."+m+"(") >= 0);
ok('live amount preview while typing', /draftAmount/.test(BOQ));
ok('unpriced lines are called out', /not priced/.test(BOQ) && /unpricedItems/.test(BOQ));
ok('warns before applying an incomplete bill', /will contribute nothing\. Apply the budget anyway/.test(BOQ));

console.log('\nCloseout panel is wired and honest');
ok('uses api.getCloseout', /api\.getCloseout\(/.test(CO));
ok('uses api.updateCloseout', /api\.updateCloseout\(/.test(CO));
ok('shows what blocks closure', /Before this job can be closed/.test(CO));
ok('phase derived from the API, not stored twice', /PHASES\.findIndex\(\(p\) => p\.key === data\.phase\)/.test(CO));
ok('says handover schedules retention', /retention release scheduled/.test(CO));
ok('read-only for those who cannot edit', /Closeout dates are set by a project manager/.test(CO));

console.log('\nRetention tab surfaces what is payable');
ok('totals row added', /Due for release now/.test(FIN));
ok('stage column on the retention table', /At handover/.test(FIN) && /End of defects/.test(FIN));
ok('a passed date reads as payable, not late', /"Due now"/.test(FIN) && !/>Overdue</.test(FIN));

console.log('\nColumns line up');
const between=(src,a,b)=>{const i=src.indexOf(a),j=src.indexOf(b,i);return src.slice(i,j);};
const commitTbl=between(FIN,'tab === "commitments"','tab === "applications"');
const retTbl=between(FIN,'tab === "retention"','tab === "budget"');
const th=(s)=>(s.match(/<th[ >]/g)||[]).length;
const tdRow=(s)=>{const i=s.indexOf('<tr key=');const j=s.indexOf('</tr>',i);return (s.slice(i,j).match(/<td[ >]/g)||[]).length;};
ok(`commitments: ${th(commitTbl)} headers vs ${tdRow(commitTbl)} cells`, th(commitTbl)===tdRow(commitTbl));
ok(`retention: ${th(retTbl)} headers vs ${tdRow(retTbl)} cells`, th(retTbl)===tdRow(retTbl));
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail?1:0);
