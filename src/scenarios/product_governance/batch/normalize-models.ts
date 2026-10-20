import {join,resolve} from 'node:path';
import {readdir} from 'node:fs/promises';
import {read,save,digest} from '../runtime/storage.ts';
import {removeExtraClosers,lastAssistantText} from './model-json.ts';
const dir=resolve(import.meta.dir,'../../../../outputs/product-governance/three-category-20261019');
const manifest:any=await read(join(dir,'batch-manifest.json'));
let completed=0,pending=0;
for(const batch of manifest.batches)for(const model of ['deepseek','kimi']){
 const stage=(model==='deepseek'?'fill-':'blind-review-')+batch.id;
 let file=stage+'-'+model+'.json';if(await Bun.file(join(dir,'models',stage+'-repair-'+model+'.json')).exists())file=stage+'-repair-'+model+'.json';
 if(!await Bun.file(join(dir,'models',file)).exists()){pending++;continue;}
 const r:any=await read(join(dir,'models',file));let content=r.content,recovery:any=null;
 if(!content&&model==='kimi'){
  const raw=await Bun.file(join(dir,'models',file.replace('.json','.raw.jsonl'))).text();
  const text=lastAssistantText(raw);
  if(text){try{const repaired=removeExtraClosers(text);content=JSON.parse(repaired.text);recovery={method:'删除字符串外不匹配的多余结束括号',removed:repaired.removed,rawHash:digest(raw)};}catch{}}
 }
 if(!Array.isArray(content?.products)||content.products.length!==batch.keys.length||new Set(content.products.map((p:any)=>p.key)).size!==batch.keys.length||!batch.keys.every((key:string)=>content.products.some((p:any)=>p.key===key))){
  console.log('needs_explicit_repair',file,r.error??'coverage');pending++;continue;
 }
 await save(join(dir,'normalized',stage+'-'+model+'.json'),{model,sourceRecord:'models/'+file,sourceRecordHash:digest(r),originalStatus:r.status,syntaxRecovery:recovery,content});completed++;
}
console.log({completed,pending,expected:manifest.batches.length*2});
let jdCompleted=0;
for(let i=1;i<=3;i++)for(const model of ['deepseek','kimi']){
 const stage='jd-review-'+String(i).padStart(2,'0'),file=stage+'-'+model+'.json';
 if(!await Bun.file(join(dir,'models',file)).exists())continue;
 const r:any=await read(join(dir,'models',file)),input:any=await read(join(dir,'batches',stage+'.input.json'));let content=r.content,recovery:any=null;
 if(!content&&model==='kimi'){
  const raw=await Bun.file(join(dir,'models',file.replace('.json','.raw.jsonl'))).text(),text=lastAssistantText(raw);
  if(text){try{const repaired=removeExtraClosers(text);content=JSON.parse(repaired.text);recovery={method:'删除字符串外不匹配的多余结束括号',removed:repaired.removed,rawHash:digest(raw)};}catch{}}
 }
 const keys=input.products.map((p:any)=>p.key);
 if(!Array.isArray(content?.products)||content.products.length!==keys.length||new Set(content.products.map((p:any)=>p.key)).size!==keys.length||!keys.every((key:string)=>content.products.some((p:any)=>p.key===key))){console.log('needs_explicit_repair',file,r.error??'coverage');continue;}
 await save(join(dir,'normalized-jd',file),{model,sourceRecord:'models/'+file,sourceRecordHash:digest(r),originalStatus:r.status,syntaxRecovery:recovery,content});jdCompleted++;
}
console.log({jdCompleted,jdExpected:6});
// 超时的第三批Kimi可由两个完整、互斥的7件重试覆盖；保留各自来源。
for(const n of [1,2]){
 const stage='jd-review-03-repair-'+n,file=stage+'-kimi.json';if(!await Bun.file(join(dir,'models',file)).exists())continue;
 const r:any=await read(join(dir,'models',file)),input:any=await read(join(dir,'batches',stage+'.input.json'));let content=r.content,recovery:any=null;
 if(!content){const raw=await Bun.file(join(dir,'models',file.replace('.json','.raw.jsonl'))).text(),text=lastAssistantText(raw);if(text){try{const repaired=removeExtraClosers(text);content=JSON.parse(repaired.text);recovery={method:'删除字符串外不匹配的多余结束括号',removed:repaired.removed,rawHash:digest(raw)};}catch{}}}
 const keys=input.products.map((p:any)=>p.key);
 if(!Array.isArray(content?.products)||content.products.length!==keys.length||new Set(content.products.map((p:any)=>p.key)).size!==keys.length||!keys.every((key:string)=>content.products.some((p:any)=>p.key===key))){console.log('needs_explicit_repair',file);continue;}
 await save(join(dir,'normalized-jd',file),{model:'kimi',sourceRecord:'models/'+file,sourceRecordHash:digest(r),originalStatus:r.status,syntaxRecovery:recovery,content});console.log('jd_small_retry_covered',keys.length);
}
