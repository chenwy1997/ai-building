import {join} from 'node:path';
import {parseFlags} from '../category_governance/util.ts';
import {samplePlan} from './sample-plan.ts';
import {ROOT,hash,read,save,optional,locked} from './storage.ts';
import {refine,REFINEMENT_VERSION} from './refinement.ts';
import {Sources} from './tools.ts';
import {collectEvidence} from './collect-evidence.ts';
import {Meter,BudgetError} from './meter.ts';
import {report} from './report.ts';
import {deepseekRuntime} from '../../ai/deepseek-runtime.ts';
import type {Outcome} from './types.ts';

export async function main(argv=Bun.argv.slice(2)){
 const {flags:f,positionals}=parseFlags(argv);if(positionals.length||Object.keys(f).some(k=>!['run','plan','budget','concurrency','direct','resume','help'].includes(k)))throw new Error('未知参数');
 if(f.help==='true'){console.log('bun run src/scenarios/category_attributes_governance/batch-entry.ts --plan\nbun run src/scenarios/category_attributes_governance/batch-entry.ts --run --budget=5 --concurrency=4 --direct\n--resume=运行名 恢复未完成类目，已有结果不重复生成；协议变更需新运行。');return;}
 const {context,categories}=await samplePlan();if(f.run!=='true'&&!f.resume){console.log('清单已准备，未启动API；显式--run执行30类。');return;}
 const budget=Number(f.budget??5),concurrency=Number(f.concurrency??4);if(!Number.isFinite(budget)||budget<=0||!Number.isInteger(concurrency)||concurrency<1||concurrency>16)throw new Error('预算或并发非法');
 if(f.resume&&!/^run-[\w-]+$/u.test(f.resume))throw new Error('运行名非法');
 const code=['refinement.ts','protocol.ts','staged.ts','grounding.ts','requirement-policy.ts','review-resolution.ts','collect-evidence.ts','tools.ts','batch-entry.ts'];
 const fingerprint=hash([REFINEMENT_VERSION,context.contextHash,categories.map(c=>c.id),await Promise.all(code.map(p=>Bun.file(join(import.meta.dir,p)).text()))]);
 const name=f.resume??'run-'+new Date().toISOString().replace(/[:.]/g,'-')+'-hardware30',directory=join(ROOT,'output',name);
 await locked(directory,async()=>{
  const previous=await optional<{fingerprint:string}>(join(directory,'manifest.json'));if(f.resume&&(!previous||previous.fingerprint!==fingerprint))throw new Error('原运行不存在或代码/范围已变化，不能覆盖恢复');
  await save(join(directory,'manifest.json'),{fingerprint,protocol:REFINEMENT_VERSION,categories:categories.map(c=>({id:c.id,path:c.pathNames})),budget,concurrency,thinking:'disabled',scope:'五金工具30个二级分支各1末级；只生成候选属性模板，不自动定版'});
  const runtime=await deepseekRuntime(f.direct==='true'),meter=new Meter(directory,budget,runtime.chat);await meter.init();
  const sources=await Sources.create({direct:f.direct==='true',jdProject:'/Users/sanheng/Project/sanheng/ai-core',jdConcurrency:2,maxCandidates:100,maxDetails:4,webKey:process.env.TAVILY_API_KEY});
  const prior=await optional<Outcome[]>(join(directory,'results.json'))??[],results=new Map(prior.map(r=>[r.category.id,r]));
  const known=await read<Outcome[]>(join(ROOT,'output','run-2026-09-15T02-54-03-942Z','results.json'));
  let cursor=0,completed=results.size,stop=false,writes=Promise.resolve();
  await Promise.all(Array.from({length:concurrency},async()=>{while(!stop&&cursor<categories.length){const c=categories[cursor++]!;if(results.has(c.id))continue;
   const artifacts=join(directory,'categories',c.id);let result:Outcome;
   try{
    const cached=known.find(r=>r.category.id===c.id),collected=cached?{evidence:cached.evidence,gaps:[]}:await collectEvidence(c,context.branch(c),sources,meter,runtime.model);
    await save(join(artifacts,'00-evidence.json'),collected);
    result=await refine(c,context.branch(c),collected.evidence,meter,runtime.model,artifacts);result.gaps.push(...collected.gaps);
    if(!collected.evidence.length){result.gaps.push('没有外部证据，本类模板仍待知识核验');if(result.status==='accepted')result.status='needs_review';}
   }catch(e){if(e instanceof BudgetError){stop=true;break;}result={category:c,attributes:[],evidence:[],status:'failed',error:String(e),gaps:[],rounds:0,fingerprint};}
   if(result.error?.includes('预算不足')){stop=true;await save(join(artifacts,'partial-result.json'),result);break;}
   results.set(c.id,result);completed++;await save(join(artifacts,'result.json'),result);
   writes=writes.then(()=>save(join(directory,'results.json'),categories.flatMap(n=>results.has(n.id)?[results.get(n.id)!]:[])));await writes;
   console.log(`${completed}/${categories.length} ${c.name}：${result.status}，${result.attributes.length}项`);
  }}));
  const ordered=categories.flatMap(c=>results.has(c.id)?[results.get(c.id)!]:[]);await report(directory,ordered,meter);
  await save(join(directory,'batch-status.json'),{planned:categories.length,completed:ordered.length,budgetStopped:stop,pending:categories.filter(c=>!results.has(c.id)).map(c=>c.id),tools:{jdSearch:sources.searches,jdDetails:sources.details,cacheHits:sources.cacheHits,jdUnavailable:sources.jdDisabled??null},usage:meter.summary()});
  console.log(JSON.stringify({completed:ordered.length,planned:categories.length,budgetStopped:stop,usage:meter.summary(),directory}));
 });
}
if(import.meta.main)main().catch(e=>{console.error(String(e));process.exitCode=1;});
