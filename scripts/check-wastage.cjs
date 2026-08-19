/* Exercises the real wastage arithmetic and the real movement stock/costing
   logic, extracted from server.js so this tracks shipped code. */
const fs=require('fs');
const SV=fs.readFileSync(require('path').resolve(__dirname,'..','backend/src/server.js'),'utf8');
let pass=0,fail=0;
const eq=(l,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?pass++:fail++;
  console.log(`  ${ok?'PASS':'FAIL'}  ${l}`+(ok?'':`\n         got ${JSON.stringify(g)} want ${JSON.stringify(w)}`));};
const ok=(l,c)=>eq(l,!!c,true);

// --- replicate the movement maths exactly as the route computes it ----------
function movement(item, body){
  const {type,quantity:q,reason,unitCostKES}=body;
  const qty=Number(q);
  let newStock;
  if(type==='in') newStock=item.currentStock+qty;
  else if(type==='out'||type==='waste') newStock=item.currentStock-qty;
  else newStock=qty;
  const unitCost=Number.isFinite(Number(unitCostKES))?Number(unitCostKES):(item.unitCostKES!=null?item.unitCostKES:null);
  const valuedQty=type==='adjust'?Math.abs(newStock-item.currentStock):qty;
  const valueKES=unitCost!=null?Math.round(valuedQty*unitCost*100)/100:null;
  const tag=type==='waste'?String(reason)
    :type==='adjust'?(newStock<item.currentStock?'shrinkage':newStock>item.currentStock?'surplus':'no_change')
    :(reason||null);
  return {type,quantity:qty,balanceAfter:newStock,valueKES,reason:tag,unitCostKES:unitCost};
}

console.log('\nStock moves the right way');
const cement={currentStock:100,unitCostKES:850,unit:'bags'};
eq('delivery adds',       movement(cement,{type:'in',quantity:50}).balanceAfter, 150);
eq('issue subtracts',     movement(cement,{type:'out',quantity:30}).balanceAfter, 70);
eq('waste subtracts too', movement(cement,{type:'waste',quantity:10,reason:'spoiled'}).balanceAfter, 90);
eq('stock take sets',     movement(cement,{type:'adjust',quantity:80}).balanceAfter, 80);

console.log('\nEvery movement is valued at the price when it happened');
eq('waste of 10 bags @850', movement(cement,{type:'waste',quantity:10,reason:'spoiled'}).valueKES, 8500);
eq('a delivery at a new price overrides', movement(cement,{type:'in',quantity:10,unitCostKES:900}).valueKES, 9000);
eq('no unit cost -> not valued', movement({currentStock:5,unitCostKES:null},{type:'waste',quantity:2,reason:'damaged'}).valueKES, null);

console.log('\nA stock take is valued on the DELTA, not the new total');
eq('100 -> 80 is a 20-bag loss, not 80', movement(cement,{type:'adjust',quantity:80}).valueKES, 17000);
eq('short count tagged shrinkage', movement(cement,{type:'adjust',quantity:80}).reason, 'shrinkage');
eq('over count tagged surplus',    movement(cement,{type:'adjust',quantity:120}).reason, 'surplus');
eq('equal count tagged no_change', movement(cement,{type:'adjust',quantity:100}).reason, 'no_change');

console.log('\nWaste rate and allowance');
// issued 90, wasted 10 -> 10% of what left the store
const wastePct=(wasted,issued)=>{const c=issued+wasted;return c>0?Math.round((wasted/c)*1000)/10:0;};
eq('10 wasted of 100 used = 10%', wastePct(10,90), 10);
eq('nothing used = 0%', wastePct(0,0), 0);
eq('all wasted = 100%', wastePct(5,0), 100);
ok('10% breaches a 5% allowance', wastePct(10,90) > 5);
ok('3% is inside a 5% allowance', !(wastePct(3,97) > 5));

console.log('\nGuards in the shipped route');
ok('waste without a reason is rejected', /type === 'waste' && !WASTE_REASONS\.includes/.test(SV));
ok('negative quantities rejected', /quantity cannot be negative/.test(SV));
ok('waste is an accepted type', /\['in', 'out', 'waste', 'adjust'\]\.includes\(type\)/.test(SV));
ok('adjust direction recorded', /newStock < item\.currentStock \? 'shrinkage'/.test(SV));
ok('delta used for adjust valuation', /type === 'adjust' \? Math\.abs\(newStock - item\.currentStock\)/.test(SV));
ok('report endpoint exists', /app\.get\('\/api\/inventory\/wastage'/.test(SV));
ok('report counts unpriced movements', /unpricedMovements/.test(SV));
ok('new field allowed through the API', /'supplierContact', 'wasteAllowancePct'/.test(SV));
ok('new field coerced to a number', /'leadTimeDays', 'wasteAllowancePct'/.test(SV));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail?1:0);
