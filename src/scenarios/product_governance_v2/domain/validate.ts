import {cardSchema,validate, type Source} from './meta.ts';
import {usableWebText} from './normalize.ts';
export function checkCard(card:any,categoryId:string,sources:Source[]):string[]{
 const errors=validate(cardSchema,card);if(errors.length)return errors;
 const ids=card.attributes.map((a:any)=>a.id), set=new Set(ids);
 if(card.categoryId!==categoryId)errors.push('categoryId:wrong scope');
 if(set.size!==ids.length)errors.push('attributes:duplicate id');
 for(const group of ['bindings','rules','provenance']){
  const gs=card[group].map((r:any)=>r.attributeId);
  if(gs.length!==ids.length||new Set(gs).size!==gs.length||gs.some((id:string)=>!set.has(id)))errors.push(`${group}:must map 1:1 to definitions`);
 }
 const dims=card.dimensions.flatMap((x:any)=>x.attributeIds);
 if(dims.length!==ids.length||new Set(dims).size!==ids.length||dims.some((id:string)=>!set.has(id)))errors.push('dimensions:each attribute must occur once');
 for(const a of card.attributes){
  if(!/^[a-z][a-z0-9_.]*$/.test(a.id))errors.push(`${a.id}:invalid id`);
  if(!a.name.trim()||!a.definition.trim()||!a.describes.trim())errors.push(`${a.id}:empty semantics`);
  if(a.fieldType==='数值'&&!a.unit.trim())errors.push(`${a.id}:numeric unit missing; use 无量纲 if appropriate`);
  if(a.fieldType==='选项'&&!a.enumValues.length)errors.push(`${a.id}:enum missing`);
  if(a.fieldType!=='选项'&&a.enumValues.length)errors.push(`${a.id}:non-option enum`);
  if(new Set(a.enumValues).size!==a.enumValues.length)errors.push(`${a.id}:duplicate enum`);
 }
 for(const b of card.bindings){
  if(!b.scope.trim()||!b.rationale.trim())errors.push(`${b.attributeId}:missing scope/rationale`);
  if(b.requiredness==='conditional'&&!b.condition.trim())errors.push(`${b.attributeId}:conditional without condition`);
 }
 for(const r of card.rules){
  if(r.operator!=='direct'&&(r.inputs.length<2||!r.preconditions.length||!r.formula.trim()))errors.push(`${r.attributeId}:incomplete formula`);
  if(!r.directRule.trim()||!r.onMissing.trim()||!r.onConflict.trim())errors.push(`${r.attributeId}:incomplete rule`);
 }
 for(const p of card.provenance)for(const c of p.claims){
  const source=sources.find(s=>s.id===c.sourceId);
  if(!source){errors.push(`${p.attributeId}:unknown source ${c.sourceId}`);continue;}
  if(source.kind==='web_page'&&!usableWebText(source.text)){errors.push(`${p.attributeId}:source is login page, not product evidence`);continue;}
  if(source.kind==='model_knowledge'){if(c.quote)errors.push(`${p.attributeId}:model knowledge cannot have source quotation`);}
  else if(!c.quote.trim()||!source.text.includes(c.quote))errors.push(`${p.attributeId}:unverifiable quotation ${c.sourceId}`);
 }
 return errors;
}
export function applyRepair(card:any,patch:any){
 const c=structuredClone(card),removed=new Set(patch.removeIds);
 for(const group of ['attributes','bindings','rules','provenance'])c[group]=c[group].filter((r:any)=>!removed.has(group==='attributes'?r.id:r.attributeId));
 for(const r of patch.replacements)for(const [group,key]of [['attributes','attribute'],['bindings','binding'],['rules','rule'],['provenance','provenance']]){
  const id=r.attribute.id;c[group!]=c[group!].filter((x:any)=>(group==='attributes'?x.id:x.attributeId)!==id);c[group!].push(r[key!]);
 }
 c.dimensions=patch.dimensions;c.unresolved=patch.unresolved;return c;
}
/** White-listed arithmetic, never eval generated formulas. */
export function calculate(operator:'divide'|'multiply',values:number[],sameScope:boolean):number{
 if(!sameScope||values.length!==2||values.some(v=>!Number.isFinite(v)||v<=0))throw new Error('invalid quantity evidence');
 const [a,b]=values as [number,number],n=operator==='divide'?a/b:a*b;
 if(!Number.isSafeInteger(n))throw new Error('count must be an exact positive integer');return n;
}
