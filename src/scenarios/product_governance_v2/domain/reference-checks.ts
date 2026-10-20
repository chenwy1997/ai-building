/** Deterministic checks for reference coverage and traceability, not semantic accuracy. */
export function checkReferenceDecisions(card:any, decisions:any[], sources:any[]):string[]{
 const errors:string[]=[],expected=new Map(sources.map(s=>[s.id,s])),seen=new Set<string>();
 const attrs=new Set(card.attributes.map((a:any)=>a.id));
 for(const d of decisions){
  if(!expected.has(d.sourceId)){errors.push(`reference:unknown source ${d.sourceId}`);continue;}
  if(seen.has(d.sourceId))errors.push(`reference:duplicate decision ${d.sourceId}`);
  seen.add(d.sourceId);
  if(!['采纳','调整采纳','不采纳'].includes(d.action))errors.push(`reference:invalid action ${d.sourceId}`);
  if(!d.reason?.trim()||!d.implementation?.trim())errors.push(`reference:missing rationale ${d.sourceId}`);
  if(d.action==='不采纳'&&d.targetAttributeIds.length)errors.push(`reference:rejected row has targets ${d.sourceId}`);
  if(d.action!=='不采纳'&&!d.targetAttributeIds.length)errors.push(`reference:adopted row has no target ${d.sourceId}`);
  for(const id of d.targetAttributeIds){
   if(!attrs.has(id)){errors.push(`reference:deleted target ${id}`);continue;}
   const claims=card.provenance.find((p:any)=>p.attributeId===id)?.claims??[];
   if(!claims.some((c:any)=>c.sourceId===d.sourceId&&c.quote===expected.get(d.sourceId).text))
    errors.push(`reference:exact source row missing for ${id}/${d.sourceId}`);
  }
 }
 for(const id of expected.keys())if(!seen.has(id))errors.push(`reference:missing decision ${id}`);
 return errors;
}
