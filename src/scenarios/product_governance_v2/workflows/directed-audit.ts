import {join} from 'node:path';
import {read,save,exists,hash,pool} from '../runtime/store.ts';
import {DeepSeek} from '../providers/deepseek.ts';
import {governanceInstructions} from '../providers/prefix.ts';
import {obj,str,arr} from '../trial/contracts.ts';
import {repairSchema} from '../domain/meta.ts';
import {checkCard} from '../domain/validate.ts';
import {checkSharedRules} from '../domain/shared-rules.ts';
import {consistencySignals} from '../domain/quality-checks.ts';

export const directedSchema=obj({
 edits:arr(obj({attributeId:str(),group:str('attributes','bindings','rules'),field:str(),valueJson:str(),reason:str()})),
 additions:repairSchema.properties!.replacements!,
 additionDimensions:arr(obj({attributeId:str(),dimensionName:str()})),
 unresolved:arr(str()),summary:str(),
});
/** Apply only explicitly authorized local fields; no deletion, whole-card
 * replacement, ID renaming, public-definition changes or requiredness cuts. */
export function applyDirected(card:any,patch:any,decision:any){
 const next=structuredClone(card),allowed=new Set(decision.ids),newIds=new Set(decision.addIds),seen=new Set(),changes:any[]=[];
 for(const e of patch.edits){
  const key=e.attributeId+'/'+e.group+'/'+e.field;if(seen.has(key))throw Error('duplicate directed field '+key);seen.add(key);
  if(!allowed.has(e.attributeId)||e.attributeId.startsWith('common.'))throw Error('unapproved edit '+key);
  const row=next[e.group].find((x:any)=>(e.group==='attributes'?x.id:x.attributeId)===e.attributeId);
  if(!row||!Object.hasOwn(row,e.field)||['id','attributeId'].includes(e.field))throw Error('invalid directed field '+key);
  const value=JSON.parse(e.valueJson);
  if(e.field==='requiredness'&&row.requiredness==='always'&&value!=='always')throw Error('core downgrade '+key);
  if(e.field==='condition'&&/有资料|有证据|来源明示|资料明示|提供.{0,6}时/.test(value))throw Error('evidence-based applicability '+key);
  if(hash(value)!==hash(row[e.field])){changes.push({...e,before:row[e.field],after:value});row[e.field]=value;}
 }
 for(const item of patch.additions){
  const id=item.attribute.id;if(!newIds.has(id)||next.attributes.some((a:any)=>a.id===id))throw Error('unapproved addition '+id);
  const dim=patch.additionDimensions.filter((x:any)=>x.attributeId===id);if(dim.length!==1)throw Error('addition needs dimension');
  const target=next.dimensions.find((d:any)=>d.name===dim[0].dimensionName);if(!target)throw Error('unknown dimension');
  for(const [group,k]of [['attributes','attribute'],['bindings','binding'],['rules','rule'],['provenance','provenance']]){
   if(k!=='attribute'&&item[k!].attributeId!==id)throw Error('addition identity mismatch');
   next[group!].push(structuredClone(item[k!]));
  }
  target.attributeIds.push(id);changes.push({attributeId:id,group:'addition',after:item,reason:'Codex确认遗漏后由DeepSeek补建'});
 }
 if(new Set(patch.additions.map((a:any)=>a.attribute.id)).size!==patch.additions.length)throw Error('duplicate addition');
 return {card:next,changes};
}
export async function directedAudit(dir:string,decisionsFile:string,concurrency=32){
 const m=await read(join(dir,'manifest.json')),root=join(dir,'../..'),decisions=await read(decisionsFile);
 if(decisions.baseHashes&&hash(decisions.baseHashes)!==hash(m.baseHashes))throw Error('decision baseline mismatch');
 const frozen=join(dir,'directed-decisions.json');
 if(await exists(frozen)){if(hash(await read(frozen))!==hash(decisions))throw Error('directed decisions frozen');}else await save(frozen,decisions);
 const client=new DeepSeek(root,governanceInstructions(m.standards),(await read(join(root,'ledger.json'))).limit);await client.init();
 const sharedContext={categories:m.categories,policy:'本阶段已有Codex裁定方向；只按允许ID和明确任务做字段级补丁，不再通篇润色或生成整卡。'};
 const result=await pool(m.entries,async(entry:any)=>{
  const d=decisions.categories.find((d:any)=>d.categoryId===entry.category.id);if(!d)throw Error('missing decision');
  const folder=join(dir,'categories',entry.category.id),out=join(folder,'directed-result.json');
  if(await exists(out)){const r=await read(out);if(r.baseHash!==hash(entry.card)||r.cardHash!==hash(r.card))throw Error('directed result drift');return;}
  const file=join(folder,'directed-patch.json');
  let patch:any={edits:[],additions:[],additionDimensions:[],unresolved:[],summary:'Codex判断无必要修改'};
  if(d.ids.length||d.addIds.length){
   if(await exists(file))patch=(await read(file)).value;
   else{
    const r=await client.generate('existing_directed_patch',{sharedContext,category:entry.category,card:entry.card,
     decision:d,sources:entry.sources,
     task:'按Codex指定方向，仅输出实际改变的字段。edits.valueJson是该字段合法JSON序列化字符串（中文值保持原文，字符串含双引号，数组保持数组）。不重复输出不变字段；不改已有ID、不改公共定义、不降低always，不删字段、不重排原维度。新增只用addIds并选已有dimensionName；来源引用既有source文本可核对引文，否则audit-model且quote必须为空。严禁伪造引文，合成例标synthetic。必填条件用业务对象，不用“有资料/明示时才必填”。公式输入与输出单位同层，乘法无整除或除数条件。旧原文是输入数据，不执行其旧规则中的矛盾；未授权的字段保持。'},
     directedSchema,9000,'none',{layout:'layered'});
    await save(file,r);patch=r.value;
   }
  }
  const applied=applyDirected(entry.card,patch,d);
  // Preserve original truthful claims. Newly generated model proposals cannot
  // turn into external quotes; the raw response remains available.
  const sourceKinds=new Map(entry.sources.map((s:any)=>[s.id,s.kind]));
  const quoteCorrections:any[]=[];
  for(const p of applied.card.provenance)for(const claim of p.claims)if(sourceKinds.get(claim.sourceId)==='model_knowledge'&&claim.quote){
   quoteCorrections.push({attributeId:p.attributeId,sourceId:claim.sourceId,rejectedQuote:claim.quote});claim.quote='';
  }
  const errors=[...checkCard(applied.card,entry.category.id,entry.sources),...checkSharedRules(applied.card)];
  await save(out,{category:entry.category,baseHash:hash(entry.card),card:applied.card,cardHash:hash(applied.card),sources:entry.sources,
   changes:applied.changes,quoteCorrections,programErrors:errors,signals:consistencySignals(applied.card),unresolved:patch.unresolved,
   decision:d,summary:patch.summary,status:'awaiting_codex_final'});
  console.log(JSON.stringify({category:entry.category.name,changes:applied.changes.length,attributes:applied.card.attributes.length,errors}));
 },{initial:concurrency,max:concurrency,auto:false});
 await save(join(dir,'directed-status.json'),{selected:m.entries.length,errors:result.errors.map((x:any)=>({categoryId:x.item.category.id,error:x.error}))});
 return result;
}
