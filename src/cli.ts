import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadEnv, required } from './config.js';
import { renderGantt } from './gantt.js';
import { command } from './domain.js';
import { z } from 'zod';

const [verb,arg,...rest]=process.argv.slice(2);
if(!verb || verb==='help') {
  console.log(`Usage:
  npm run procure -- query me|categories|actors|policy|requests|blocked|timeline
  npm run procure -- query request|events --id UUID
  npm run procure -- query knowledge --q TEXT
  npm run procure -- command command.json --key STABLE-UNIQUE-KEY
  npm run procure -- gantt artifacts/procurement.html
  npm run procure -- describe [command.type]

Set PROCUREMENT_ENV_FILE=.env.bot.local (or .env.owner.local for human decisions).
Commands use JSON files so quotations and newlines survive shell invocation.
Reuse the SAME key and payload when retrying. Different work requires a new key.
The Gantt is a dated, self-contained snapshot; regenerate to refresh it.`);
  process.exit(0);
}
if(verb==='describe') {
  const schema=arg?command.options.find(v=>v.shape.type.value===arg):command;
  if(!schema) { console.error('Unknown command type.');process.exit(1); }
  console.log(JSON.stringify(z.toJSONSchema(schema,{io:'input'}),null,2));process.exit(0);
}
loadEnv(process.env.PROCUREMENT_ENV_FILE??'.env.bot.local');
const base=required('PROCUREMENT_URL').replace(/\/$/,''),key=required('PROCUREMENT_KEY');
const parsed=new URL(base); if(parsed.protocol!=='https:' && !['127.0.0.1','localhost','[::1]'].includes(parsed.hostname)) throw new Error('Remote service connections require HTTPS.');
async function call(path:string,body?:unknown,idempotencyKey?:string) {
  const response=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+key,...(body?{'Content-Type':'application/json','Idempotency-Key':idempotencyKey??''}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
  const result=await response.json(); if(!response.ok) throw new Error(JSON.stringify(result));return result;
}
try {
  if(verb==='query') {
    const params=new URLSearchParams(); for(let i=0;i<rest.length;i+=2) { if(!rest[i]?.startsWith('--') || rest[i+1]===undefined) throw new Error('Expected --name value.'); params.set(rest[i].slice(2),rest[i+1]); }
    console.log(JSON.stringify(await call('/queries/'+encodeURIComponent(arg)+'?'+params),null,2));
  } else if(verb==='command') {
    if(rest[0]!=='--key'||!rest[1]) throw new Error('Supply a stable --key.');
    console.log(JSON.stringify(await call('/commands',JSON.parse(readFileSync(arg,'utf8')),rest[1]),null,2));
  } else if(verb==='gantt') {
    if(!arg?.endsWith('.html')) throw new Error('Supply an .html output path.');
    const rows=await call('/queries/timeline'); mkdirSync(dirname(arg),{recursive:true});writeFileSync(arg,renderGantt(rows));
    console.log(`Saved ${arg}; ${rows.length} requests. Regenerate to refresh this snapshot.`);
  } else throw new Error('Unknown command. Run: npm run procure -- help');
} catch(error) { console.error(error instanceof Error?error.message:'Command failed.');process.exitCode=1; }
