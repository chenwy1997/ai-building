import {validateEvidenceReference,type ProductRecord} from './rules.ts';

export interface ConditionFact {fact:string;value:boolean;evidenceId:string;quote:string}
/** Conditions describe explicit observed evidence; no model confidence can replace a source. */
export function resolveRequired(binding:any,product:ProductRecord,facts:ConditionFact[]=[]){
 const accepted=facts.filter(f=>typeof f.value==='boolean'&&!validateEvidenceReference(product,f).length);
 const condition=binding.requiredWhen;
 const requested=Array.isArray(condition?.any)?condition.any:condition?.fact?[condition]:[];
 const triggered=requested.some((r:any)=>accepted.some(f=>f.fact===r.fact&&f.value===r.equals));
 return {required:binding.required===true||triggered,conditionTriggered:triggered,triggerEvidence:accepted.filter(f=>requested.some((r:any)=>f.fact===r.fact&&f.value===r.equals))};
}

function conditionValue(condition:any,facts:ConditionFact[]):boolean|null {
 if(!condition)return true;
 if(condition.all){const xs=condition.all.map((c:any)=>conditionValue(c,facts));return xs.includes(false)?false:xs.includes(null)?null:true;}
 if(condition.any){const xs=condition.any.map((c:any)=>conditionValue(c,facts));return xs.includes(true)?true:xs.includes(null)?null:false;}
 const values=new Set(facts.filter(f=>f.fact===condition.fact).map(f=>f.value));
 if(values.size!==1)return null;
 return [...values][0]===condition.equals;
}
export function checkMeasurementGroups(categoryId:string,fields:Record<string,any>,groups:any[],product?:ProductRecord,facts:ConditionFact[]=[]){
 const accepted=product?facts.filter(f=>typeof f.value==='boolean'&&!validateEvidenceReference(product,f).length):[];
 return groups.filter(g=>g.categoryId===categoryId).map(g=>{
  const applicable=conditionValue(g.applicabilityRule,accepted);
  const paths=g.atLeastOne.map((ids:string[])=>({ids,complete:ids.every(id=>fields[id]?.status==='filled'),inapplicable:ids.some(id=>fields[id]?.status==='not_applicable')}));
  return {groupId:g.id,applicable,status:applicable===false?'not_applicable':applicable===null?'needs_evidence':'applicable',complete:applicable===true&&paths.some((p:any)=>p.complete),paths,reason:g.reason};
 });
}
