/** Mechanical contract repairs only. Every change is returned for audit. */
export function normalizeCardContract(input:any,commonRules:any[]=[]){
 const card=structuredClone(input),changes:any[]=[];
 const names=new Map<string,string>(card.attributes.map((a:any)=>[a.id,a.id.replace(/[A-Z]/g,(x:string)=>'_'+x.toLowerCase())]));
 if(new Set(names.values()).size!==names.size)throw Error('ID normalization collision');
 const mapped=(id:string)=>names.get(id)??id;
 for(const a of card.attributes){if(mapped(a.id)!==a.id)changes.push({kind:'id',from:a.id,to:mapped(a.id)});a.id=mapped(a.id);}
 for(const group of ['bindings','rules','provenance'])for(const item of card[group])item.attributeId=mapped(item.attributeId);
 for(const d of card.dimensions)d.attributeIds=d.attributeIds.map(mapped);
 for(const b of card.bindings)for(const [old,next]of names)if(old!==next)b.condition=b.condition.split(old).join(next);
 for(const r of card.rules)for(const [old,next]of names)if(old!==next)r.formula=r.formula.split(old).join(next);
 for(const p of card.provenance)for(const claim of p.claims)if(claim.sourceId==='model-knowledge'&&claim.quote){
  changes.push({kind:'model_knowledge_quote',attributeId:p.attributeId,previousQuote:claim.quote});claim.quote='';
 }
 for(const a of card.attributes)if(a.id.startsWith('common.')&&!card.rules.some((r:any)=>r.attributeId===a.id)){
  const rule=commonRules.find((r:any)=>r.attributeId===a.id);if(!rule)throw Error('missing public rule '+a.id);
  card.rules.push(structuredClone(rule));changes.push({kind:'restore_frozen_common_rule',attributeId:a.id});
 }
 return {card,changes,idMap:Object.fromEntries(names)};
}
