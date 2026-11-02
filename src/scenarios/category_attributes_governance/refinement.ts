import {join} from 'node:path';
import {Meter} from './meter.ts';
import {ProducerConversation,type GenerationMode} from './conversation.ts';
import {hash,save} from './storage.ts';
import {BASE,parsePlan,parseSchema,parseAudit,shortEvidence,restoreReferences,type Plan,type Audit} from './staged.ts';
import {GROUNDING_TASK,parseGrounding,evidenceAllowlist,checkAttributeReferences} from './grounding.ts';
import {REQUIREMENT_POLICY,validateIdentityPolicy} from './requirement-policy.ts';
import {parseResolution,RESOLUTION_TASK,unresolved} from './review-resolution.ts';
import type {Category,Evidence,Attribute,Outcome} from './types.ts';
import type {OpenAiMessage} from '../../ai/types.ts';

export const REFINEMENT_VERSION='evidence-first-v2.1';
export const CONTRACT=`属性输出紧凑json {upsert:[{k,n,t,r,d,e,u?,o?,c?,f?}],remove:[],done:true,gaps:[]}。
k=计划key，n=中文属性名，t=text|number|boolean|single|multi|date，r=required|optional|conditional，d=明确含义，e=[引用R编号或K]，u=单位，o=封闭枚举数组，c=条件，f=格式。
single/multi分别是封闭单选/封闭多选，必须给非空o；开放多值清单也用text并约定分隔符，不用multi。其他类型不得带o，不临时编造枚举来通过校验。conditional必须有c，其他r无c。单一数值用number；范围/多个工况用text并定义格式。物理量口径和单位需明确；可多制式时值中明确单位且u不要固定成与值冲突的单位。布尔未知不等于false。例：开放附件清单t=text,f=条目用分号分隔；封闭旋向t=single,o=[右旋,左旋]。`;
export const COMMON=BASE+`\n这是类目模板设计，未获取SKU值不能成为删核心属性或改选填的理由。实物配置不同才能产生条件必填；不要写“有资料才必填”。自身品牌与自身型号都保留：标准件也可有品牌，明确无品牌填无品牌；型号在制造商实际分配编号时条件必填。不得把模板中的举例当商品实值。保持解释简短，不逐项重复缺资料。`;
export const PLAN_TASK=`先结合类目路径及原始证据界定对象，再提出精炼属性计划。证据可能匹配错误，先区分整机/部件、工作端/驱动端、安装接口/包装规格、额定值/最大值、品牌/制造商/适配品牌。不改变原类目。证据不足用行业知识，但不能让不匹配SKU决定对象。
按识别、关键选型、安装兼容、配置差异提出必要维度，每项purpose一句短语。保留自身品牌和自身型号，分别在identity中指向对应key；不因通用件省掉。不要强凑数量，不复制全套通用兼容品牌/系列/型号；通用接口可充分描述兼容性时不要重复三套兼容字段。单位、工况、供电电压与平台身份是不同含义，不混为一个无边界字段。类目恒定事实不重复设必填。
importance只有core和supplementary两种，表示重要性，不是填写要求；不可输出required、optional、conditional。当前任务不生成填写要求或属性schema。\n输出json {boundary:明确对象及边界,identity:{ownBrand:key,ownModel:key,omissionReason:""},dimensions:[{key:ASCII,name:属性名,purpose:解决什么选型问题,importance:core|supplementary}],knowledgeGaps:[最多3项关键不确定性]}。`;
export const SCHEMA_TASK=REQUIREMENT_POLICY+'\n'+CONTRACT+`\n依据已确认计划和证据支持关系生成全部属性，每个key恰好一次，类型、单位、必填、条件、定义、格式作为一个整体设计。只引用该key白名单；K为未外部证实的行业知识。必要属性通常必填；仅特定结构/包装/适配情形存在的用可判断条件。非核心可选。不根据是否有现成资料决定必填。若必填，不允许定义又说未标注可留空。条件必填不禁止条件外自愿提供信息。
通用接口兼容不能因与某品牌产品举例同时出现而绑定该品牌。几何尺寸需准确描述接口/工作端以及测量对象；不同的额定/最大、输入/输出不能混写成一个量。范围与多个工况按完整定义表达，不能为了统一number丢失适用条件。严格遵循系统中的属性json契约。`;
const AUDIT_TASK=`验收给定模板，检查能否清楚识别、选型、安装适配，结合计划与原始证据判断对象是否错位。检查类型/单位/格式/必填/条件的真实冲突、重要维度被混合、把样本当通用事实。
允许选填的信息可以提供填写方法，“不强制”与“可填写”不矛盾。描述中带单位与单位列相同不自动重复拼接。条件依赖不等于循环。只报明确有损使用的缺陷，每项定位现有字段原文；不知道行业事实就记knowledgeGaps，不凭偏好否决。无明确问题则issues=[]。开放text、未提供封闭枚举、值内标明单位不是自动缺陷。只有实际定义缺少必要工况/单位或自相矛盾才报；有可行一致填法而只是偏好更严格结构，应记knowledgeGaps。不要将标准号开放填写误判成必须穷举标准号。最多4个实质问题，checkedKeys覆盖所有属性。
输出json {checkedKeys:[key],issues:[{key,field:name|type|requirement|unit|options|condition|description|format,quote:该列逐字原文,reason:哪两个约束或哪个对象冲突以及具体损害}],knowledgeGaps:[最多3项]}。`;
export function parseGroundedPlan(v:unknown){
 const raw=v as {dimensions?:Array<{key:string;importance:string}>};
 if(Array.isArray(raw?.dimensions))for(const d of raw.dimensions)if(d&&!['core','supplementary'].includes(d.importance))throw new Error(`${d.key}.importance=${d.importance}非法；重要性只能core或supplementary，conditional/optional属于后续填写要求，不是重要性`);
 const p=parsePlan(v);if(!p.identity.ownBrand||!p.identity.ownModel)throw new Error('identity.ownBrand与ownModel必须指向实际维度；标准件也保留自身品牌，型号可条件必填');return p;}
export function preciseSchema(v:unknown,plan:Plan,allowed:Record<string,string[]>,map:Record<string,string>):Attribute[]{
 const value=structuredClone(v) as {type?:unknown;upsert?:Array<{k?:string;t?:string;o?:unknown}>};
 // Some responses echo transport metadata. Preserve the raw response in the trace; it is not an attribute.
 if(value?.type==='json_object')delete value.type;
 if(!Array.isArray(value?.upsert))throw new Error('upsert必须为属性对象数组');
 for(const a of value.upsert){if(!a||typeof a!=='object')throw new Error('upsert元素必须为属性对象');
  if(['single','multi'].includes(a.t??'')&&(!Array.isArray(a.o)||!a.o.length))throw new Error(`${a.k}.t=${a.t}要求非空封闭枚举o；若本属性是开放列表，改t=text并定义分隔格式，不能编造o`);
  if(!['single','multi'].includes(a.t??'')&&Array.isArray(a.o)&&a.o.length)throw new Error(`${a.k}.o：${a.t}不能附封闭枚举；删除o或按真实语义选择类型`);
 }
 return validateIdentityPolicy(parseSchema(restoreReferences(checkAttributeReferences(value,allowed),map),plan,new Set(Object.values(map))),plan);
}
export function preciseGrounding(v:unknown,plan:Plan,docs:Array<{fields:string[][]}>){
 const d=structuredClone(v) as {items?:Array<{key:string;links:unknown[];knowledgeNote:string}>};
 if(!Array.isArray(d?.items))throw new Error('items必须为数组');const keys=new Set(plan.dimensions.map(x=>x.key)),seen=new Set<string>();
 for(const i of d.items){if(!i||!keys.has(i.key)||seen.has(i.key))throw new Error(`items.key=${i?.key}不存在或重复；只用计划key各一次`);seen.add(i.key);if(!Array.isArray(i.links)||i.links.length>2)throw new Error(`${i.key}.links需为数组，至多2条`);
  if(typeof i.knowledgeNote!=='string')throw new Error(`${i.key}.knowledgeNote必须为字符串`);
  // This is provenance metadata, not an invented industry explanation or upgraded evidence.
  if(!i.knowledgeNote.trim())i.knowledgeNote='模型未另述知识依据；无有效直接引用时仅保留为待核验的K候选';
 }
 const missing=[...keys].filter(k=>!seen.has(k));if(missing.length)throw new Error('items缺少计划key：'+missing.join(','));
 return parseGrounding(d,plan,docs);
}
export function preciseAudit(v:unknown,attrs:Attribute[]):Audit{
 try{return parseAudit(v,attrs);}catch(e){
  const data=v as {issues?:Array<{key:string;field:string;quote:string}>};const columns:Record<string,number>={name:1,type:2,requirement:3,unit:4,options:5,condition:6,description:7,format:8};
  const locations=(Array.isArray(data?.issues)?data.issues:[]).map(i=>{const a=attrs.find(a=>a[0]===i?.key);return {key:i?.key,field:i?.field,actual:a&&columns[i.field]!==undefined?a[columns[i.field]!]:null};});
  throw new Error(String(e)+'；当前字段原文：'+JSON.stringify(locations)+'。quote只引用对应actual原文，缺失属性记knowledgeGaps。只输出checkedKeys/issues/knowledgeGaps，不重复输入数据。');
 }
}
export async function refine(category:Category,branch:string,raw:Evidence[],meter:Meter,model:string,directory:string,mode:GenerationMode='independent'):Promise<Outcome>{
 const evidence=raw.map(e=>({...e,fields:[...e.fields.filter(f=>f[0]!==e.id+'.title'),[e.id+'.title','SKU/资料标题',e.title] as [string,string,string]]}));
 const compact=shortEvidence(evidence);let attrs:Attribute[]=[],rounds=0;const fingerprint=hash([REFINEMENT_VERSION,mode,category.id,branch,compact]);
 const producer=new ProducerConversation(COMMON,{category:category.pathNames,branch,documents:compact.documents});
 const ask=async<T>(phase:string,task:string,data:unknown,parse:(v:unknown)=>T,tokens:number)=>{
  // Stable cross-category instructions precede variable category/evidence data.
  const continuous=mode==='conversation'&&['v2-01-plan','v2-02-grounding','v2-03-schema','v2-06-repair'].includes(phase);
  const d=data as {plan?:Plan;allowedRefsByKey?:Record<string,string[]>;issues?:unknown};
  // Only new validated constraints are appended; evidence and producer outputs are already in history.
  const delta=phase==='v2-01-plan'?{}:phase==='v2-02-grounding'?{planKeys:d.plan!.dimensions.map(x=>x.key)}:phase==='v2-03-schema'?{allowedRefsByKey:d.allowedRefsByKey}:{issues:d.issues};
  const messages:OpenAiMessage[]=continuous?producer.request(task,delta):[{role:'system',content:COMMON},{role:'user',content:task},{role:'user',content:JSON.stringify({category:category.pathNames,branch,data})}];
  for(let attempt=0;attempt<2;attempt++){
   const r=await meter.request({model,messages,thinking:{type:'disabled'},temperature:0.1,response_format:{type:'json_object'},max_tokens:attempt?Math.max(tokens,3000):tokens,stream:false},category.id,phase);rounds++;
   if(r.usage?.completion_tokens_details?.reasoning_tokens)throw new Error('思考未关闭');const choice=r.choices[0];
   try{if(!choice?.message.content||choice.finish_reason==='length')throw new Error('输出为空或截断，请完整且精简');const result=parse(JSON.parse(choice.message.content));await save(join(directory,phase+'.json'),result);if(continuous){producer.commit(messages,choice.message.content);await save(join(directory,'producer-conversation.json'),producer.snapshot());}return result;}
   catch(e){if(attempt===1)throw e;
    if(e instanceof SyntaxError&&phase.includes('audit')){
     // Regenerate the small audit result, not the enormous input evidence envelope.
     messages.splice(2);messages.push({role:'user',content:JSON.stringify({category:category.pathNames,attributes:attrs,legend:'[key,name,type,requirement,unit,options,condition,description,format,refs]'})},{role:'user',content:'上次审阅JSON语法错误。重新输出且仅输出checkedKeys、issues、knowledgeGaps，不复制输入对象；quote是单个字符串且逐字引用指定字段。无证据可核验的行业猜测放knowledgeGaps。'});
    }else messages.push({role:'assistant',content:choice?.message.content??''},{role:'user',content:'仅修复以下精确契约问题，输出完整JSON，保留其他内容：'+String(e)});
   }
  }throw new Error('阶段未完成');
 };
 try{
  await save(join(directory,'00-evidence.json'),{evidence:raw});await save(join(directory,'reference-map.json'),compact.referenceMap);
  const plan=await ask('v2-01-plan',PLAN_TASK,{documents:compact.documents},parseGroundedPlan,2600);
  const grounding=await ask('v2-02-grounding',GROUNDING_TASK+'\nitems逐一覆盖计划key；输出 {items:[{key,links:[{ref,relation,quote,reason}],knowledgeNote}]}。reason不超过30字，knowledgeNote最多一句。',{plan,documents:compact.documents},v=>preciseGrounding(v,plan,compact.documents),3400);
  const allowed=evidenceAllowlist(grounding);
  const refs=new Set(Object.values(allowed).flat()),documents=compact.documents.map(d=>({...d,fields:d.fields.filter(f=>refs.has(f[0]!))})).filter(d=>d.fields.length);
  attrs=await ask('v2-03-schema',SCHEMA_TASK,{plan,documents,allowedRefsByKey:allowed},v=>preciseSchema(v,plan,allowed,compact.referenceMap),3400);
  const check=async(phase:string)=>ask(phase,AUDIT_TASK,{plan,attributes:attrs,legend:'[key,name,type,requirement,unit,options,condition,description,format,refs]',documents:compact.documents},v=>preciseAudit(v,attrs),1900);
  let audit=await check('v2-04-audit');let uncertainties:Audit['issues']=[];
  if(audit.issues.length){
   const resolution=await ask('v2-05-resolution',RESOLUTION_TASK+'\n不要求列举/非必填与可选择提供信息不构成冲突。',{attributes:attrs,issues:audit.issues,legend:'[key,name,type,requirement,unit,options,condition,description,format,refs]'},v=>parseResolution(v,audit),1600);
   uncertainties=resolution.decisions.filter(d=>d.verdict==='uncertain').map(d=>audit.issues[d.issue]!);
   const confirmed=resolution.decisions.filter(d=>d.verdict==='confirmed').map(d=>audit.issues[d.issue]!);
   if(confirmed.length){
    const draft=attrs.map(a=>({k:a[0],n:a[1],t:a[2],r:a[3],u:a[4],o:a[5],c:a[6],d:a[7],f:a[8],e:a[9].map(ref=>ref==='K'?'K':Object.entries(compact.referenceMap).find(([,r])=>r===ref)![0])}));
    attrs=await ask('v2-06-repair',SCHEMA_TASK+'\n只修正列出的实质问题，保持其他属性含义；输出全部属性。填写要求、定义、条件、格式须一并自洽。此次是唯一语义修订，不循环。',{plan,draft,issues:confirmed,documents,allowedRefsByKey:allowed},v=>preciseSchema(v,plan,allowed,compact.referenceMap),3400);
    audit=await check('v2-07-reaudit');
   }else audit={...audit,issues:audit.issues.filter((_,i)=>resolution.decisions.find(d=>d.issue===i)?.verdict!=='dismissed')};
  }
  const combined=[...audit.issues,...uncertainties.filter(i=>!audit.issues.some(j=>j.key===i.key&&j.reason===i.reason))];
  const issues=combined.map(i=>({key:i.key,reason:i.reason}));
  return{category,attributes:attrs,evidence,status:issues.length?'needs_review':'accepted',review:{pass:!issues.length,issues,gaps:audit.knowledgeGaps},gaps:[...plan.knowledgeGaps,...audit.knowledgeGaps,'内部检查通过仅为候选状态，需独立人工验收'],rounds,fingerprint};
 }catch(e){return{category,attributes:attrs,evidence,status:'failed',error:String(e),gaps:[],rounds,fingerprint};}
}
