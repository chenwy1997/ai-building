import {join} from 'node:path';
import {readdir} from 'node:fs/promises';
import {RUN,AVAILABLE_MODELS} from './settings.ts';
import {read,save} from '../runtime/storage.ts';
import {invoke,covers} from './model-run.ts';

// Explicit follow-up after a recorded failure; never reuse a request with an unknown result.
const [id,scope='main',prefix='']=process.argv.slice(2);
const base=AVAILABLE_MODELS.find(m=>m.id===id);if(!base)throw new Error('Unknown model');
const config=id==='glm'?{...base,reasoningEffort:'low' as const,maxCalls:110}:base;
const files=await readdir(join(RUN,'models'));
const pending=new Set<string>();
for(const f of files.filter(f=>f.endsWith(`-${id}.request.json`)&&!files.includes(f.replace('.request.json','.json')))){
 const request:any=await read(join(RUN,'models',f));
 if(scope==='jd'?f.startsWith('jd-'):!f.startsWith('jd-'))for(const p of request.payload?.products??[])pending.add(p.key);
}
const covered=new Set<string>();
for(const f of await readdir(join(RUN,'normalized'))){const n:any=await read(join(RUN,'normalized',f));if(n.model===id&&(scope==='jd'?n.stage.startsWith('jd-'):!n.stage.startsWith('jd-')&&!n.stage.startsWith('cards-')))for(const p of n.content?.products??[])covered.add(p.key);}
const jobs:any[]=[];
for(const f of (await readdir(join(RUN,'batches'))).filter(f=>scope==='jd'?f.startsWith('jd-review-')&&f.endsWith('.input.json'):!f.startsWith('jd-')&&f.endsWith('.input.json')).sort()){
 const input:any=await read(join(RUN,'batches',f));const ps=input.products.filter((p:any)=>!covered.has(p.key)&&!pending.has(p.key)&&(!prefix||p.key.startsWith(prefix)));
 const size=id==='kimi'&&scope==='jd'?3:5;
 for(let i=0;i<ps.length;i+=size){const products=ps.slice(i,i+size),keys=products.map((p:any)=>p.key);jobs.push({stage:`${scope==='jd'?'jd-review-':'blind-review-'}${keys[0]}-${keys.at(-1)}-repair-small-v2`,keys,payload:{...input,products,role:'独立复核，同一冻结标准和原始证据，不提供其他模型或Codex答案。',formatInstruction:'返回全部key。理由和缺项说明每项最多40汉字。仅JSON，所有字符串换行及引号正确转义。'}});}
}
let next=0,consecutiveFailures=0;const results:any[]=[];
await Promise.all(Array.from({length:prefix?1:3},async()=>{while(next<jobs.length&&consecutiveFailures<3){const j=jobs[next++];try{const r=await invoke(j.stage,config,j.payload,covers(j.keys));results.push({stage:j.stage,keys:j.keys,ok:!!r});consecutiveFailures=r?0:consecutiveFailures+1;}catch(e){consecutiveFailures++;results.push({stage:j.stage,keys:j.keys,ok:false,error:e instanceof Error?e.message:String(e)});}}}));
await save(join(RUN,`models/${id}-${scope}-repair-small-v2-status.json`),{at:new Date().toISOString(),config,expected:jobs.length,results,notStarted:jobs.slice(next).map(j=>j.keys),pendingOriginalKeys:[...pending]});
console.log({id,scope,expected:jobs.length,completed:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length,notStarted:jobs.length-next});
