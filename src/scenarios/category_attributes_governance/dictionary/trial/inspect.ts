import { resolve } from 'node:path';
import { save } from '../../storage.ts';
import { digest } from '../contracts.ts';
export async function inspect(runName:string){
 if(!/^run-[\w-]+$/.test(runName))throw Error('运行名非法');
 const root=resolve(import.meta.dir,'../../workspace'),dir=resolve(root,'output/dictionary-trial',runName);
 const manifest=await Bun.file(resolve(dir,'manifest.json')).json();
 const reference=await Bun.file(resolve(manifest.reference,'templates.json')).json();
 const referenceManifest=await Bun.file(resolve(manifest.reference,'manifest.json')).json();
 if(digest(await Bun.file(resolve(manifest.reference,'templates.json')).text())!==referenceManifest.fileHashes['templates.json'])throw Error('参考模板已修改');
 const results=await Bun.file(resolve(dir,'results.json')).json();
 const comparisons=results.map((r:any)=>{
  const ref=reference.templates.find((t:any)=>t.category.id===r.category.id);if(!ref)throw Error('参考类目不存在');
  if(digest(ref.selections)!==r.category.referenceHash)throw Error('评分参考与计划不一致');
  if(!r.final)return {name:r.category.name,id:r.category.id,error:r.error};
  const actual=r.final.attributes as any[],draft=r.draft.attributes as any[];
  const missing=ref.attributes.filter((a:any)=>a.requirement!=='optional'&&!actual.some(x=>x.id===a.id&&x.revision===a.revision));
  const extras=actual.filter(a=>!ref.attributes.some((x:any)=>x.id===a.id&&x.revision===a.revision));
  const policies=actual.flatMap(a=>{const before=ref.attributes.find((x:any)=>x.id===a.id&&x.revision===a.revision);return before&&(before.requirement!==a.requirement||before.condition!==a.condition)?[{id:a.id,name:a.name,reference:{requirement:before.requirement,condition:before.condition},actual:{requirement:a.requirement,condition:a.condition}}]:[];});
  return {name:r.category.name,id:r.category.id,referenceCount:ref.attributes.length,actualCount:actual.length,draftCount:draft.length,
   missingExactCore:missing.map((a:any)=>({id:a.id,name:a.name,definition:a.definition,requirement:a.requirement,condition:a.condition})),
   extraExact:extras.map(a=>({id:a.id,name:a.name,definition:a.definition,requirement:a.requirement,condition:a.condition})),policyDifferences:policies,newConcepts:r.final.newConcepts,
   selfAudit:{added:actual.filter(a=>!draft.some(x=>x.id===a.id)).map(a=>a.name),removed:draft.filter(a=>!actual.some(x=>x.id===a.id)).map(a=>a.name)},
   allActual:actual.map(a=>({id:a.id,revision:a.revision,name:a.name,definition:a.definition,requirement:a.requirement,condition:a.condition,unit:a.selectedUnitId,qualifications:a.qualifications,rationale:a.rationale})),note:r.final.note};
 });
 await save(resolve(dir,'comparison.json'),{notice:'精确ID和条件文本差异只用于定位；同义替代需人工判断，不据此自动计算语义通过率。',comparisons});
 console.log(JSON.stringify(comparisons.map((c:any)=>({name:c.name,error:c.error,count:c.actualCount,missing:c.missingExactCore?.map((a:any)=>a.name),extras:c.extraExact?.map((a:any)=>a.name),policies:c.policyDifferences,selfAudit:c.selfAudit,new:c.newConcepts})),null,2));
 return comparisons;
}
if(import.meta.main)inspect(Bun.argv[2]??'').catch(e=>{console.error(e.message);process.exitCode=1;});
