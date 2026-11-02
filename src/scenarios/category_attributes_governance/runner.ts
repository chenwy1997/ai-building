import {join} from 'node:path';
import type {OpenAiMessage,OpenAiChatRequest} from '../../ai/types.ts';
import {SYSTEM,AUDITOR,PROTOCOL,patch,applyPatch,review} from './protocol.ts';
import {hash,journal,save,optional} from './storage.ts';
import {Meter,BudgetError} from './meter.ts';
import type {Sources,SessionTools} from './tools.ts';
import {TOOLS} from './tools.ts';
import type {Category,Attribute,Evidence,Outcome} from './types.ts';
export interface RunOptions {model:string;attempts:number;expandRounds:number;researchRounds:number;maxTokens:number;concurrency:number}
export const packedEvidence=(items:Evidence[])=>items.map(({retrievedAt,...e})=>e);
export async function govern(category:Category,branch:string,meter:Meter,sources:Sources,o:RunOptions,seed?:Outcome):Promise<Outcome>{
 const session=sources.session(),messages:OpenAiMessage[]=[{role:'system',content:SYSTEM},{role:'user',content:'固定类目分支（仅作为范围上下文）：\n'+branch},{role:'user',content:JSON.stringify({target:{id:category.id,path:category.pathNames},task:'先收集行业证据。调用jd_search用本类目或语义同义词召回；选2~4个相关SKU取详情，发现配件/不匹配改词继续，不要求凑满100。也可web_search/web_read找制造商资料。结束只输出json {"use":["已取得的证据id"],"scope":"本类目范围与排除项","gaps":[]}，use仅保留实际适合的资料，不合适的明确排除。'})}];
 let attrs:Attribute[]=[],evidence:Evidence[]=[],gaps:string[]=[],rounds=0;
 const fingerprint=hash([PROTOCOL,category.id,branch,SYSTEM,TOOLS,o]);
 const refs=()=>new Set(evidence.flatMap(e=>e.fields.map(f=>f[0])));
 const request=async(history:OpenAiMessage[],phase:string,toolsAllowed=false)=>{
  const req:OpenAiChatRequest={model:o.model,messages:history,thinking:{type:'disabled'},temperature:0.15,max_tokens:o.maxTokens,...(toolsAllowed?{}:{response_format:{type:'json_object'}}),tools:TOOLS,tool_choice:toolsAllowed?(history.some(m=>m.role==='tool')?'auto':{type:'function',function:{name:'jd_search'}}):'none',stream:false};
  const result=await meter.request(req,category.id,phase);rounds++;
  if((result.usage?.completion_tokens_details?.reasoning_tokens??0)>0)throw new Error('服务端返回了思考token，停止并检查AI层开关');
  const choice=result.choices[0];if(!choice)throw new Error('缺少choice');
  if(choice.finish_reason==='length')throw new Error('输出截断；不拼凑JSON，需降低单轮内容或增加max-tokens');
  if(!choice.message.content&&!choice.message.tool_calls?.length)throw new Error('模型返回空content');
  return choice.message;
 };
 const jsonTurn=async<T>(history:OpenAiMessage[],prompt:string,phase:string,parse:(v:unknown)=>T):Promise<T>=>{
  history.push({role:'user',content:prompt});let last:unknown;
  for(let a=0;a<o.attempts;a++){
   try{const msg=await request(history,phase);history.push({role:'assistant',content:msg.content});return parse(JSON.parse(msg.content??''));}
   catch(e){last=e;if(e instanceof BudgetError)throw e;if(a+1<o.attempts)history.push({role:'user',content:`上轮请求/JSON校验失败：${String(e).slice(0,350)}。只重答当前阶段的紧凑json，不能忽略字段契约。`});}
  }throw last;
 };
 try{
  if(seed){
   evidence=seed.evidence;attrs=seed.attributes;
   messages.splice(2,1,{role:'user',content:JSON.stringify({target:{id:category.id,path:category.pathNames},task:'基于上次取得的原始证据针对性修订模板；不重新搜索，不假设前次审阅意见全都正确。',evidence:packedEvidence(evidence)})});
   const delta=await jsonTurn(messages,JSON.stringify({task:'按当前定义判据修订这个候选模板。删除冗余项、补关键适配规格、修正量纲和条件。少量可靠字段即可。输出短键属性对象的增量补丁json。',current:attrs,previousIssues:seed.review?.issues??[],note:'前次issues包含误报，只修真正成立的实质问题。未修改字段不输出。'}),'refine',v=>patch(v,refs()));
   attrs=applyPatch(attrs,delta,refs());gaps=delta.gaps;
  }else{
  for(let r=0;r<o.researchRounds;r++){
   const msg=await request(messages,'research',true);
   if(!msg.tool_calls?.length){messages.push({role:'assistant',content:msg.content});break;}
   const calls=msg.tool_calls as Array<{id:string;type:string;function:{name:string;arguments:string}}>;
   if(calls.length>6)throw new Error('单轮工具调用超出6次');
   messages.push({role:'assistant',content:msg.content,tool_calls:calls});
   for(const call of calls){let result:unknown;try{result=await session.execute(call.function.name,JSON.parse(call.function.arguments));}catch(e){result={error:String(e).slice(0,350)};}
    messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result)});await journal(join(meter.directory,'trace.jsonl'),{event:'tool',category:category.id,name:call.function.name,args:call.function.arguments,result});
   }
  }
  const selected=await jsonTurn(messages,'证据收集结束，不再调用工具。按实际相关性输出json {"use":["已有证据id"],"scope":"目标范围和排除项","gaps":[]}。没有合适外部证据就use=[]，如实记录缺口。','evidence-selection',v=>{
   const d=v as {use:unknown;scope:unknown;gaps:unknown};if(!d||!Array.isArray(d.use)||d.use.some(x=>typeof x!=='string'||!session.evidence.has(x))||typeof d.scope!=='string'||!Array.isArray(d.gaps)||d.gaps.some(x=>typeof x!=='string'))throw new Error('证据选择JSON不合法');return d as {use:string[];scope:string;gaps:string[]};
  });
  evidence=[...new Set(selected.use)].map(id=>session.evidence.get(id)!);gaps=selected.gaps;
  const initial=await jsonTurn(messages,JSON.stringify({task:'建立第一版可用模板，先覆盖识别、核心规格和选型所需性能，可一次给完整核心集合，不机械限制为3个属性。只输出补丁json。证据引用只可用acceptedRefs，其他已看过资料已排除。',scope:selected.scope,acceptedRefs:[...refs()]}),'draft',v=>patch(v,refs()));
  attrs=applyPatch([],initial,refs());gaps.push(...initial.gaps);
  }
  for(let r=0;r<(seed?0:o.expandRounds);r++){
   const delta=await jsonTurn(messages,JSON.stringify({task:'基于前轮模板检查遗漏、冗余、类型/量纲、必填条件。只针对实际证据支持的购买/适配/验收缺口做差异；同时删除重复字段。没有明确缺口立即done=true，不要按可能功能逐项堆字段。只补有价值的差异，不重输出未变字段；如果无需修改upsert/remove为空并done=true。输出补丁json。',currentKeys:attrs.map(a=>[a[0],a[1]])}),'expand-'+(r+1),v=>patch(v,refs()));
   const next=applyPatch(attrs,delta,refs());const changed=hash(next)!==hash(attrs);attrs=next;gaps.push(...delta.gaps);
   await journal(join(meter.directory,'trace.jsonl'),{event:'delta',category:category.id,round:r+1,upsert:delta.upsert.map(a=>a[0]),removed:delta.remove,changed});
   if(delta.done||!changed)break;
  }
  if(!attrs.length)throw new Error('空模板不能交付');
  const audit=async()=>{const m:OpenAiMessage[]=[{role:'system',content:AUDITOR},{role:'user',content:'固定类目分支：\n'+branch}];return jsonTurn(m,JSON.stringify({category:{id:category.id,path:category.pathNames},attributes:attrs,evidence:packedEvidence(evidence)}),'audit',review);};
  let accepted=await audit();
  if(!accepted.pass){const delta=await jsonTurn(messages,JSON.stringify({task:'只针对独立验收的实质问题修正当前模板，保持其余字段不变，输出补丁json。',issues:accepted.issues,current:attrs}),'repair',v=>patch(v,refs()));attrs=applyPatch(attrs,delta,refs());gaps.push(...delta.gaps);accepted=await audit();}
  gaps=[...new Set([...gaps,...accepted.gaps,...(!evidence.length?['没有适合的外部证据；模板目前只基于模型行业知识，待人工验收']:[])])];
  return{category,status:accepted.pass&&evidence.length>0?'accepted':'needs_review',attributes:attrs,evidence,review:accepted,gaps,rounds,fingerprint};
 }catch(e){return{category,status:'failed',attributes:attrs,evidence,gaps,error:e instanceof Error?e.message:String(e),rounds,fingerprint};}
}
export async function run(leaves:Category[],branch:(c:Category)=>string,meter:Meter,sources:Sources,o:RunOptions,seeds?:Map<string,Outcome>){
 const prior=await optional<Outcome[]>(join(meter.directory,'results.json'))??[],results=new Map(prior.map(x=>[x.category.id,x]));
 let cursor=0,completed=0;let writes=Promise.resolve();
 await Promise.all(Array.from({length:Math.min(o.concurrency,leaves.length)},async()=>{while(cursor<leaves.length){const c=leaves[cursor++]!;
  if(results.get(c.id)?.status==='accepted'){completed++;continue;}
  const result=await govern(c,branch(c),meter,sources,o,seeds?.get(c.id));results.set(c.id,result);completed++;
  writes=writes.then(()=>save(join(meter.directory,'results.json'),leaves.flatMap(n=>results.has(n.id)?[results.get(n.id)!]:[])));await writes;
  console.log(`${completed}/${leaves.length} ${c.name}：${result.status}，${result.attributes.length}项属性，${result.evidence.length}份证据；费用保守计${meter.used().toFixed(4)}元`);
 }}));return leaves.map(n=>results.get(n.id)!);
}
