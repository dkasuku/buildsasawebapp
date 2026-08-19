/* Exercises the real readError() extracted from api.ts. */
const fs=require('fs');
const src=fs.readFileSync(require('path').resolve(__dirname,'..','src/app/services/api.ts'),'utf8');
const i=src.indexOf('async function readError');
const body=src.slice(i, src.indexOf('\n}\n', i)+2)
  .replace('async function readError(res: Response): Promise<string> {','async function readError(res) {');
const readError=new Function(`return (async()=>{ ${body}; return readError; })()`)();
let pass=0,fail=0;
const mk=(status,text,statusText='')=>({status,statusText,text:async()=>text});
(async()=>{
  const f=await readError;
  const t=async(label,res,want)=>{const got=await f(res);const ok=got===want;ok?pass++:fail++;
    console.log(`  ${ok?'PASS':'FAIL'}  ${label}`+(ok?'':`\n         got  "${got}"\n         want "${want}"`));};

  console.log('\nJSON errors are unwrapped, not shown raw');
  await t('the reported case',
    mk(400,'{"error":"Direct messages are turned off. Create a group so the conversation stays with the team."}'),
    'Direct messages are turned off. Create a group so the conversation stays with the team.');
  await t('{message} shape', mk(400,'{"message":"A group needs a name"}'), 'A group needs a name');
  await t('nested validator', mk(400,'{"errors":[{"message":"Name is required"}]}'), 'Name is required');

  console.log('\nNon-JSON bodies');
  await t('plain text passes through', mk(400,'Something specific went wrong'), 'Something specific went wrong');
  await t('HTML proxy page is not dumped', mk(502,'<html><body>Bad Gateway</body></html>'),
    'The server is unreachable right now. Please try again in a moment.');
  await t('empty body -> status meaning', mk(403,''), "You don't have permission to do that.");

  console.log('\nStatus fallbacks read as English');
  await t('404', mk(404,''), 'That item no longer exists.');
  await t('409', mk(409,''), 'That conflicts with something already saved.');
  await t('413', mk(413,''), 'That file is too large to upload.');
  await t('429', mk(429,''), 'Too many attempts. Wait a moment and try again.');
  await t('500', mk(500,''), 'Something went wrong on our side. Please try again.');

  console.log('\nNo raw JSON can reach a toast');
  for (const b of ['{"error":"x"}','{"message":"y"}','{"errors":[{"message":"z"}]}']) {
    const got=await f(mk(400,b));
    const ok=!got.includes('{')&&!got.includes('"');
    ok?pass++:fail++;
    console.log(`  ${ok?'PASS':'FAIL'}  ${b} -> "${got}"`);
  }
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail?1:0);
})();
