import { resolve } from 'node:path';
import { parseFlags } from '../../../category_governance/util.ts';
import { deepseekRuntime } from '../../../../ai/deepseek-runtime.ts';
import { Meter, BudgetError } from '../../meter.ts';
import { locked, save, optional } from '../../storage.ts';
import { digest } from '../contracts.ts';
import { auditRequest, buildKnowledge, firstRequest, parseReply, protocolVersion, routing } from './protocol.ts';
import type { OpenAiChatRequest } from '../../../../ai/types.ts';
const root=resolve(import.meta.dir,'../../workspace');
const reference=resolve(root,'dictionary/v1/hardware60-reference-v2');
export async function main(argv=Bun.argv.slice(2)){
 const {flags:f,positionals}=parseFlags(argv);
 if(f.help){console.log('bun run category-attributes-governance:dictionary-trial --direct [--budget=10] [--resume=run-...] [--prepare-only]\n固定10类、每类选配+自查2轮，不发送参考答案、不调用京东。恢复沿用账本。');return;}
 if(positionals.length||Object.keys(f).some(k=>!['direct','budget','resume','prepare-only'].includes(k)))throw Error('未知参数');
 if(f.resume&&!/^run-[\w-]+$/.test(f.resume))throw Error('恢复目录名非法');
 const plan=await Bun.file(resolve(reference,'trial-plan.json')).json();
 const dictionary=await Bun.file(resolve(reference,'property-dictionary.json')).json();
 const sourceManifest=await Bun.file(resolve(reference,'manifest.json')).json();
 for(const name of ['trial-plan.json','property-dictionary.json'])if(digest(await Bun.file(resolve(reference,name)).text())!==sourceManifest.fileHashes[name])throw Error('冻结输入被修改 '+name);
 if(plan.categories.length!==10||plan.thinking!==false)throw Error('固定试跑范围或思考配置有误');
 const knowledge=buildKnowledge(dictionary),runtimeModel='deepseek-flash';
 const requests=plan.categories.map((c:any)=>firstRequest(runtimeModel,{id:c.id,name:c.name,pathNames:c.pathNames},knowledge));
 const code=await Promise.all(['protocol.ts','entry.ts','../../meter.ts','../../../../ai/deepseek-runtime.ts','../../../../ai/openai-client.ts'].map(p=>Bun.file(resolve(import.meta.dir,p)).text()));
 const fingerprint=digest({protocolVersion,plan,dictionary,code,requests});
 const runName=f.resume??'run-'+new Date().toISOString().replace(/[:.]/g,'-');
 const dir=resolve(root,'output/dictionary-trial',runName);
 await locked(resolve(root,'output/dictionary-trial'),()=>locked(dir,async()=>{
  const old=await optional<any>(resolve(dir,'manifest.json'));
  if(f.resume&&!old)throw Error('恢复清单不存在');
  if(old&&old.fingerprint!==fingerprint)throw Error('输入或代码改变，不能恢复该运行');
  const budget=Number(f.budget??old?.budget??10);if(!Number.isFinite(budget)||budget<=0||budget>10||(old&&budget>old.budget))throw Error('预算应大于0且不超过10元；恢复不能提高原预算');
  await save(resolve(dir,'manifest.json'),{protocolVersion,fingerprint,budget,thinking:false,model:runtimeModel,reference,runName,status:'prepared',createdAt:old?.createdAt??new Date().toISOString(),categories:plan.categories,groupCounts:Object.fromEntries(Object.entries(knowledge).map(([k,p])=>[k,p.count])),notice:'开发样板回归；未向模型传入参考模板或评分答案。工具族路由是项目编写的候选池，非独立检索测评。'});
  await save(resolve(dir,'knowledge.json'),knowledge);
  await save(resolve(dir,'initial-requests.json'),requests);
  console.log('运行目录：'+dir);console.log('候选包：'+Object.entries(knowledge).map(([k,p])=>`${k} ${p.count}项`).join('；'));
  if(f['prepare-only']==='true')return;
  const runtime=await deepseekRuntime(f.direct==='true');if(runtime.model!==runtimeModel)throw Error('模型配置与冻结请求不符');
  const meter=new Meter(dir,budget,runtime.chat);await meter.init();
  const completed=await optional<any[]>(resolve(dir,'results.json'))??[];
  if(meter.used()>budget)throw Error('已有费用超过当前预算');
  async function call(req:OpenAiChatRequest,c:any,phase:string){
   const response=await meter.request(req,c.name,phase);
   await save(resolve(dir,'categories',c.id,phase+'.response.json'),response);
   if((response.usage?.completion_tokens_details?.reasoning_tokens??0)>0)throw Error('检测到非零思考token，停止采用');
   const choice=response.choices[0];if(!choice?.message.content?.trim())throw Error('模型返回空content');
   if(choice.finish_reason!=='stop')throw Error('模型输出未正常结束：'+choice.finish_reason);
   return {content:choice.message.content,parsed:parseReply(choice.message.content,c.id,knowledge[routing[c.name]!]!.dictionary)};
  }
  // Sequential calls establish stable prefixes and make budget and per-category traces auditable.
  let stopped=false;
  for(let i=0;i<plan.categories.length;i++){
   const c=plan.categories[i];if(completed.some(r=>r.category.id===c.id))continue;
   const first=requests[i]!;console.log(`选配 ${i+1}/10 ${c.name}；保守费用 ${meter.used().toFixed(4)}元`);
   let draft:any;
   try{
    draft=await call(first,c,'select');await save(resolve(dir,'categories',c.id,'draft.json'),draft.parsed);
    const final=await call(auditRequest(first,draft.content),c,'audit');
    completed.push({category:c,status:'compiled-awaiting-semantic-review',draft:draft.parsed,final:final.parsed});
    console.log(`${c.name}：${final.parsed.selections.length}项，新增建议${final.parsed.newConcepts.length}；尚未语义验收`);
   }catch(e){const error=e instanceof Error?e.message:String(e);console.log(c.name+'：'+error);
    if(e instanceof BudgetError){stopped=true;break;}
    completed.push({category:c,status:'request-or-format-failure',error,draft:draft?.parsed??null});
   }
   await save(resolve(dir,'results.json'),completed);await save(resolve(dir,'status.json'),{processed:completed.length,stopped:false,usage:meter.summary()});
  }
  const usage=meter.summary(),status={processed:completed.length,compiled:completed.filter(r=>r.final).length,failures:completed.filter(r=>r.status==='request-or-format-failure').length,stopped,pending:plan.categories.filter((c:any)=>!completed.some(r=>r.category.id===c.id)).map((c:any)=>c.name),usage};
  await save(resolve(dir,'results.json'),completed);await save(resolve(dir,'status.json'),status);
  const manifest=await Bun.file(resolve(dir,'manifest.json')).json();await save(resolve(dir,'manifest.json'),{...manifest,status:stopped?'budget-stopped':'awaiting-semantic-review'});
  console.log(JSON.stringify(status,null,2));
 }));
}
if(import.meta.main)main().catch(e=>{console.error(e.message);process.exitCode=1;});
