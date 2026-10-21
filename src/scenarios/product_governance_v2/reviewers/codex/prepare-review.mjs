/** Offline triage only: no API, no source mutation, no automatic approval. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const canonical=x=>JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const hash=x=>createHash('sha256').update(canonical(x)).digest('hex');
const same=(a,b)=>canonical(a)===canonical(b);
export function prepareReview(before,after,{sharedIds=['common.brand','common.model'],samplesPerCategory=2}={}){
 const previous=new Map(before.map(e=>[e.category?.id??e.card.categoryId,e]));
 const shared=new Map(),categories=[],unknown=[];
 for(const entry of after){
  const id=entry.category?.id??entry.card.categoryId,old=previous.get(id),card=entry.card;
  if(!old){unknown.push(id);continue;}
  const groups=['attributes','bindings','rules','provenance'],allIds=new Set([...old.card.attributes,...card.attributes].map(a=>a.id));
  const changes=[],mandatory=[],ordinary=[];
  for(const attrId of allIds){
   const a=old.card.attributes.find(a=>a.id===attrId),b=card.attributes.find(a=>a.id===attrId),fields=[];
   for(const group of groups){
    const row=(c)=>c[group]?.find(r=>(group==='attributes'?r.id:r.attributeId)===attrId);
    const x=row(old.card),y=row(card);
    for(const field of new Set([...Object.keys(x??{}),...Object.keys(y??{})]))if(!same(x?.[field],y?.[field]))fields.push({group,field,before:x?.[field]??null,after:y?.[field]??null});
   }
   const common=sharedIds.includes(attrId);
   if(common){
    const rule=card.rules.find(r=>r.attributeId===attrId),oldRule=old.card.rules.find(r=>r.attributeId===attrId);
    const key=attrId+'/'+hash([b??null,rule??null]),item=shared.get(key)??{attributeId:attrId,definition:b??null,rule:rule??null,beforeVariants:[],categoryIds:[]};
    const variant={definition:a??null,rule:oldRule??null};
    if(!item.beforeVariants.some(x=>same(x,variant)))item.beforeVariants.push(variant);
    item.categoryIds.push(id);shared.set(key,item);
   }
   // Shared definitions are reviewed once. Bindings and local rules stay scoped.
   const localFields=fields.filter(f=>!(common&&['attributes','rules'].includes(f.group)));
   const high=localFields.filter(f=>['name','definition','describes','kind','fieldType','unit','enumValues','requiredness','condition','scope','operator','formula','inputs','preconditions'].includes(f.field));
   const item={attributeId:attrId,name:b?.name??a?.name,changes:localFields};
   if(localFields.length)changes.push(item);
   if(!a||!b||high.length)mandatory.push({...item,trigger:!a?'新增':!b?'移出或删除':'语义或口径变化'});
   else if(!common&&b)ordinary.push({attributeId:attrId,name:b.name,selectionHash:hash([id,attrId])});
  }
  ordinary.sort((a,b)=>a.selectionHash.localeCompare(b.selectionHash));
  const modelReview=entry.scopeRepair?.finalReview??entry.businessRevision?.review??entry.lastReview??null;
  categories.push({categoryId:id,name:entry.category?.name,baseHash:hash(old.card),candidateHash:hash(card),programErrors:entry.businessRevision?.programErrors??entry.programErrors??[],changes,mandatoryReview:mandatory,spotchecks:ordinary.slice(0,samplesPerCategory),modelFindings:modelReview?.findings??[],sourceReferences:{beforeCard:id,afterCard:id}});
 }
 return {kind:'offline_review_pack_only',policy:'reviewers/codex/审核大纲.md',sharedDefinitions:[...shared.values()],categories,unknownCategories:unknown,
  summary:{categories:categories.length,sharedDefinitions:shared.size,changedAttributes:categories.reduce((n,c)=>n+c.changes.length,0),mandatoryReview:categories.reduce((n,c)=>n+c.mandatoryReview.length,0),spotchecks:categories.reduce((n,c)=>n+c.spotchecks.length,0),programErrors:categories.reduce((n,c)=>n+c.programErrors.length,0),modelFindings:categories.reduce((n,c)=>n+c.modelFindings.length,0),paidCalls:0}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname)){
 const args=process.argv.slice(2),opt=k=>{const i=args.indexOf('--'+k);return i<0?null:args[i+1];};
 if(!opt('before')||!opt('after')||!opt('out'))throw Error('--before --after --out required');
 const beforeFile=path.resolve(opt('before')),afterFile=path.resolve(opt('after')),out=path.resolve(opt('out'));
 const before=JSON.parse(await fs.readFile(beforeFile,'utf8')),after=JSON.parse(await fs.readFile(afterFile,'utf8')),pack=prepareReview(before,after);
 pack.sources={beforeFile,afterFile,beforeHash:hash(before),afterHash:hash(after)};
 await fs.mkdir(out,{recursive:true});
 await fs.writeFile(path.join(out,'review-pack.json'),JSON.stringify(pack,null,2));
 await fs.writeFile(path.join(out,'review-summary.json'),JSON.stringify({...pack.summary,notice:'仅准备审核线索，不代表已审核或验收'},null,2));
 console.log(JSON.stringify(pack.summary));
}
