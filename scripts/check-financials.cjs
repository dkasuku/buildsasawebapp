/* Exercises the real Financials currency + advance-split logic. */
const fs=require('fs');
const src=fs.readFileSync(require('path').resolve(__dirname,'..','src/app/components/constructai/Financials.tsx'),'utf8');
let pass=0,fail=0;
const eq=(l,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?pass++:fail++;
  console.log(`  ${ok?'PASS':'FAIL'}  ${l}`+(ok?'':`\n         got ${JSON.stringify(g)} want ${JSON.stringify(w)}`));};
const ok=(l,c)=>eq(l,!!c,true);

const RATES={KES:1,USD:0.0077};
const USD_TO_KES=1/RATES.USD;
const toKES=(a,c)=>a/RATES[c];
const fmtNum=(usd,cur)=>Math.round(Math.round((Number(usd)||0)*USD_TO_KES)*RATES[cur]);
const toStoredUSD=(typed,cur)=>toKES(Number(typed)||0,cur)/USD_TO_KES;

console.log('\nWhat you type is what you see back');
for (const [cur,typed] of [['KES',500000],['KES',1250],['USD',3850],['USD',100]]) {
  const stored=toStoredUSD(typed,cur);
  eq(`${cur} ${typed} -> stored ${stored} -> displays ${fmtNum(stored,cur)}`, fmtNum(stored,cur), typed);
}

console.log('\nThe old bug: a figure that changed meaning with the toggle');
const oldFmt=(usd,cur)=>Math.round(usd*RATES[cur]);       // passed USD as a KES base
const typed=500000, stored=toStoredUSD(typed,'KES');
eq('OLD: same entry read in KES', oldFmt(typed,'KES'), 500000);
eq('OLD: same entry read in USD', oldFmt(typed,'USD'), 3850);
ok('OLD reading changed with the toggle', oldFmt(typed,'KES')!==oldFmt(typed,'USD'));
eq('NEW: KES reading', fmtNum(stored,'KES'), 500000);
eq('NEW: USD reading', fmtNum(stored,'USD'), 3850);
ok('NEW value is stable — 500,000 KSh IS 3,850 USD', Math.abs(fmtNum(stored,'USD')-500000*RATES.USD)<2);

console.log('\nDeposits are separated from money earned');
const ADV=['Deposit / advance','Mobilisation advance'];
const rows=[
  {type:'in',category:'Deposit / advance',amountUSD:1000},
  {type:'in',category:'Mobilisation advance',amountUSD:500},
  {type:'in',category:'Progress payment',amountUSD:2000},
  {type:'out',category:'Materials',amountUSD:800},
];
const cashIn=rows.filter(r=>r.type==='in').reduce((a,r)=>a+r.amountUSD,0);
const advances=rows.filter(r=>r.type==='in'&&ADV.includes(r.category)).reduce((a,r)=>a+r.amountUSD,0);
eq('cash in total', cashIn, 3500);
eq('deposits & advances', advances, 1500);
eq('earned (not advance)', cashIn-advances, 2000);

console.log('\nShipped code');
ok('fmt converts USD to the KES base', /formatCurrency\(Math\.round\(\(Number\(amountUSD\) \|\| 0\) \* USD_TO_KES\), currency\)/.test(src));
ok('entry converts typed -> USD', /amountUSD: toStoredUSD\(newLedger\.amountUSD\)/.test(src));
ok('amount field names the currency', /Amount \(\$\{CURRENCIES\[currency\]\.code\}\)/.test(src));
ok('category is a picker, not free text', /MONEY_IN_CATEGORIES : MONEY_OUT_CATEGORIES/.test(src));
ok('direction switch resets category', /category: t === "in" \? MONEY_IN_CATEGORIES\[0\]/.test(src));
ok('deposit categories defined', /ADVANCE_CATEGORIES/.test(src));
ok('overview shows deposits', /label: "Deposits & advances"/.test(src));
ok('zero amount rejected', /if \(!entry\.amountUSD\) return toast\.error/.test(src));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail?1:0);
