import {join} from 'node:path';
import type {OpenAiMessage} from '../../ai/types.ts';
import type {Attribute,Category,Evidence,Outcome} from './types.ts';
import {Meter} from './meter.ts';
import {hash,save} from './storage.ts';
import {ProducerConversation} from './conversation.ts';
import {COMMON,PLAN_TASK,SCHEMA_TASK,parseGroundedPlan,preciseGrounding,preciseSchema} from './refinement.ts';
import {shortEvidence,type Plan} from './staged.ts';
import {GROUNDING_TASK} from './grounding.ts';
import {NEEDS_TASK,CLAIM_TASK,SEMANTIC_AUDIT_TASK,SOURCE_SCOPE_TASK} from './semantic-prompts.ts';
import {parseNeeds,parseSourceScope,parseClaimVerdicts,verifiedAllowlist,parseSemanticAudit,semanticFindings,repairFeedback,type Claim,type Needs} from './semantic-contracts.ts';
export const SEMANTIC_VERSION='semantic-coverage-v3.4';
export function parseRevisedSchema(v:unknown,plan:Plan,allowed:Record<string,string[]>,map:Record<string,string>):Attribute[]{
 const x=v as {upsert?:Array<{k?:string;n?:string;d?:string}>;remove?:unknown[]};
 if(!x||!Array.isArray(x.upsert)||!x.upsert.length||x.upsert.length>30||!Array.isArray(x.remove)||x.remove.length)throw new Error('修订输出1~30项完整属性，remove=[]；允许新增缺失维度');
 const revisedPlan=parseGroundedPlan({...plan,dimensions:x.upsert.map(a=>({key:a?.k,name:a?.n,purpose:a?.d,importance:'core'}))});
 const revisedAllowed=Object.fromEntries(revisedPlan.dimensions.map(d=>[d.key,allowed[d.key]??['K']]));
 return preciseSchema(v,revisedPlan,revisedAllowed,map);
}
/** Independent needs/evidence review; one producer history; at most one semantic repair. */
export async function governSemantic(category:Category,branch:string,raw:Evidence[],meter:Meter,model:string,directory:string):Promise<Outcome>{
 const evidence=raw.map(e=>({...e,fields:[...e.fields.filter(f=>f[0]!==e.id+'.title'),[e.id+'.title','SKU/资料标题',e.title] as [string,string,string]]}));
 const compact=shortEvidence(evidence),context={category:category.pathNames,branch,documents:compact.documents};
 let producer:ProducerConversation;let attrs:Attribute[]=[],rounds=0,needs:Needs|undefined;
 const fingerprint=hash([SEMANTIC_VERSION,context,NEEDS_TASK,CLAIM_TASK,SEMANTIC_AUDIT_TASK]);
 const ask=async<T>(phase:string,task:string,data:unknown,parse:(v:unknown)=>T,tokens:number,continuous=false)=>{
  const messages:OpenAiMessage[]=continuous?producer.request(task,data):[{role:'system',content:COMMON},{role:'user',content:task},{role:'user',content:JSON.stringify({category:category.pathNames,data})}];
  for(let attempt=0;attempt<2;attempt++){
   const r=await meter.request({model,messages,thinking:{type:'disabled'},temperature:0.1,response_format:{type:'json_object'},max_tokens:tokens,stream:false},category.id,phase);rounds++;
   if(r.usage?.completion_tokens_details?.reasoning_tokens)throw new Error('思考未关闭');const choice=r.choices[0];
   try{
    if(!choice?.message.content||choice.finish_reason==='length')throw new Error('输出为空或截断；缩短每项解释，输出全部必需字段');
    const result=parse(JSON.parse(choice.message.content));await save(join(directory,phase+'.json'),result);
    if(continuous){producer.commit(messages,choice.message.content);await save(join(directory,'producer-conversation.json'),producer.snapshot());}
    return result;
   }catch(e){if(attempt===1)throw e;
    // Do not copy a long malformed response into audit retries. Exact committed producer history stays intact.
    if(!continuous)messages.splice(3);
    else if(choice?.message.content&&choice.finish_reason!=='length')messages.push({role:'assistant',content:choice.message.content});
    messages.push({role:'user',content:'仅修复输出契约，不复述输入。错误：'+String(e)});
   }
  }throw new Error('任务未完成');
 };
 try{
  await save(join(directory,'00-evidence.json'),{evidence:raw});await save(join(directory,'reference-map.json'),compact.referenceMap);
  // This task sees neither producer plan nor template, preventing coverage from being limited to existing keys.
  const indexed=compact.documents.map((d,i)=>({id:'D'+i,...d}));
  const scope=indexed.length?await ask('v3-00-source-scope',SOURCE_SCOPE_TASK,{documents:indexed},v=>parseSourceScope(v,indexed.map(d=>d.id)),1600):{documents:[]};
  const targets=new Set(scope.documents.filter(d=>d.relation==='target').map(d=>d.id));
  context.documents=compact.documents.filter((_,i)=>targets.has('D'+i));
  await save(join(directory,'source-scope.json'),{...scope,sourceIds:indexed.map((d,i)=>({id:d.id,evidenceId:raw[i]!.id,title:d.title}))});
  producer=new ProducerConversation(COMMON,context);
  needs=await ask('v3-00-needs',NEEDS_TASK,{documents:context.documents.filter(d=>d.kind==='web')},parseNeeds,2000);
  const plan=await ask('v3-01-plan',PLAN_TASK,{},parseGroundedPlan,2400,true);
  const grounding=await ask('v3-02-grounding',GROUNDING_TASK+'\n输出json {items:[{key,links:[{ref,relation,quote,reason}],knowledgeNote}]}；全部计划key各一次，解释每项一句。',{planKeys:plan.dimensions.map(d=>d.key)},v=>preciseGrounding(v,plan,context.documents),3200,true);
  const source=new Map(compact.documents.flatMap(d=>d.fields.map(f=>[f[0]!,{title:d.title,field:f[1]!,value:f[2]!}] as const)));
  const claims:Claim[]=grounding.items.flatMap(i=>i.links.filter(l=>l.relation==='dimension').map(l=>{const d=plan.dimensions.find(d=>d.key===i.key)!,s=source.get(l.ref)!;return {key:i.key,name:d.name,meaning:d.purpose,ref:l.ref,quote:l.quote,sourceTitle:s.title,sourceField:s.field,sourceValue:s.value};}));
  const verified=claims.length?await ask('v3-03-evidence-check',CLAIM_TASK,{claims},v=>parseClaimVerdicts(v,claims),2800):{checks:[]};
  const allowed=verifiedAllowlist(plan.dimensions.map(d=>d.key),verified.checks);
  await save(join(directory,'verified-evidence.json'),{claims,checks:verified.checks,allowed,rejected:verified.checks.filter(c=>c.verdict!=='supported')});
  attrs=await ask('v3-04-schema',SCHEMA_TASK,{allowedRefsByKey:allowed,evidenceCorrections:verified.checks.filter(c=>c.verdict!=='supported')},v=>preciseSchema(v,plan,allowed,compact.referenceMap),3400,true);
  const audit=async(phase:string)=>{
   const refs=new Set(attrs.flatMap(a=>a[9]));
   const sources=evidence.map(e=>({title:e.title,fields:e.fields.filter(f=>refs.has(f[0]))})).filter(e=>e.fields.length);
   return ask(phase,SEMANTIC_AUDIT_TASK,{needs,attributes:attrs,legend:'[key,name,type,requirement,unit,options,condition,description,format,refs]',sources},v=>parseSemanticAudit(v,attrs,needs!),3800);
  };
  let check=await audit('v3-05-audit');await save(join(directory,'before-repair.json'),{attributes:attrs,findings:semanticFindings(check)});
  if(semanticFindings(check).length){
   // Coverage can require new fields. New fields have K only until independently grounded; no inherited fake citations.
   attrs=await ask('v3-06-repair','沿用上轮SCHEMA任务的属性JSON契约和填写要求政策，依据独立需求及逐项检查修订。允许新增缺失属性、拆分混合维度；新增key仅可引用K。保留自身品牌/型号key。可删除不适用或重复的其他属性。输出修订后的全部属性、remove=[]，不要只给补丁。不根据资料缺失删核心属性。只修实际问题，不为了消除报告编造行业事实；无法判断记gaps。这是唯一一次语义修订。',{feedback:repairFeedback(check,needs)},v=>parseRevisedSchema(v,plan,allowed,compact.referenceMap),3000,true);
   check=await audit('v3-07-reaudit');
  }
  const issues=semanticFindings(check);
  await save(join(directory,'final-review.json'),check);
  return{category,evidence,attributes:attrs,status:issues.length?'needs_review':'accepted',review:{pass:!issues.length,issues,gaps:check.gaps},gaps:[...needs.gaps,...plan.knowledgeGaps,...check.gaps,'模型检查通过仍为候选，未经人工发布验收'],rounds,fingerprint};
 }catch(e){return{category,evidence,attributes:attrs,status:'failed',error:String(e),gaps:needs?.gaps??[],rounds,fingerprint};}
}
