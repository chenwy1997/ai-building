import {join} from 'node:path';
import {parseFlags} from '../category_governance/util.ts';
import {prepare,SOURCE} from './context.ts';
import {ROOT,read,optional,save,locked,hash} from './storage.ts';
import {Meter} from './meter.ts';
import {staged,STAGED_VERSION} from './staged.ts';
import {Sources} from './tools.ts';
import {collectEvidence} from './collect-evidence.ts';
import {report} from './report.ts';
import {deepseekRuntime} from '../../ai/deepseek-runtime.ts';
import type {Outcome,Evidence} from './types.ts';

export async function main(argv=Bun.argv.slice(2)) {
 const {flags:f,positionals}=parseFlags(argv);
 if(f.help==='true'){console.log('bun run src/scenarios/category_attributes_governance/retry-network-entry.ts --from=运行名 --concurrency=2 --direct\n只补连接失败；累计沿用原预算、费用台账与成功响应，不覆盖原批次。');return;}
 if(positionals.length||Object.keys(f).some(k=>!['from','concurrency','direct'].includes(k))||!/^run-[\w-]+$/u.test(f.from??''))throw new Error('需要合法--from运行名');
 const concurrency=Number(f.concurrency??2);if(!Number.isInteger(concurrency)||concurrency<1||concurrency>8)throw new Error('并发须为1至8');
 const source=join(ROOT,'output',f.from!),previous=await read<Outcome[]>(join(source,'results.json'));
 const manifest=await read<{fingerprint:string;budget:number}>(join(source,'manifest.json'));
 const selected=previous.filter(r=>r.status==='failed'&&/socket connection was closed|Unable to connect|ENOTFOUND|ECONNRESET|ETIMEDOUT|fetch failed/i.test(r.error??''));
 if(!selected.length){console.log('没有连接失败类目，无API请求');return;}
 const context=await prepare('五金工具',SOURCE);
 const code=['staged.ts','grounding.ts','requirement-policy.ts','review-resolution.ts','collect-evidence.ts','tools.ts','batch-entry.ts'];
 const fingerprint=hash([STAGED_VERSION,context.contextHash,previous.map(r=>r.category.id),await Promise.all(code.map(p=>Bun.file(join(import.meta.dir,p)).text()))]);
 if(fingerprint!==manifest.fingerprint)throw new Error('代码或上下文已变，不能当作同协议断网补跑');
 const directory=join(ROOT,'output','run-'+new Date().toISOString().replace(/[:.]/g,'-')+'-hardware30-network-retry');
 await locked(directory,async()=>{
  const runtime=await deepseekRuntime(f.direct==='true'),meter=new Meter(directory,manifest.budget,runtime.chat);
  meter.entries=await read(join(source,'usage.json'));meter.replies=await read(join(source,'responses.json'));
  const carried=meter.summary();await meter.persist();await save(join(directory,'responses.json'),meter.replies);
  await save(join(directory,'manifest.json'),{...manifest,source:f.from,fingerprint,budget:manifest.budget,carriedUsage:carried,selected:selected.map(r=>r.category.id),thinking:'disabled',scope:'仅补网络失败；费用含来源台账，原输出保留'});
  const sources=await Sources.create({direct:f.direct==='true',jdProject:'/Users/sanheng/Project/sanheng/ai-core',jdConcurrency:2,maxCandidates:100,maxDetails:4,webKey:process.env.TAVILY_API_KEY});
  const results=new Map(previous.map(r=>[r.category.id,r]));let cursor=0,completed=0,writes=Promise.resolve();
  await Promise.all(Array.from({length:Math.min(concurrency,selected.length)},async()=>{while(cursor<selected.length){
   const old=selected[cursor++]!,c=old.category,artifacts=join(directory,'categories',c.id);let result:Outcome;
   try{
    const evidence=await optional<{evidence:Evidence[];gaps:string[]}>(join(source,'categories',c.id,'00-evidence.json'))??await collectEvidence(c,context.branch(c),sources,meter,runtime.model);
    await save(join(artifacts,'00-evidence.json'),evidence);
    result=await staged(c,context.branch(c),evidence.evidence,meter,runtime.model,artifacts);result.gaps.push(...evidence.gaps);
    if(!evidence.evidence.length&&result.status==='accepted'){result.status='needs_review';result.gaps.push('没有外部证据，仍待知识核验');}
   }catch(e){result={...old,error:String(e)};}
   results.set(c.id,result);await save(join(artifacts,'result.json'),result);
   writes=writes.then(()=>save(join(directory,'results.json'),previous.map(r=>results.get(r.category.id)!)));await writes;
   console.log(`${++completed}/${selected.length} ${c.name}：${result.status} ${result.error??''}`);
  }}));
  await report(directory,previous.map(r=>results.get(r.category.id)!),meter);
  await save(join(directory,'retry-summary.json'),{source:f.from,selected:selected.length,newRequests:meter.entries.length-carried.requests,additionalConservativeCny:meter.used()-carried.conservativeCny,usage:meter.summary()});
  console.log(JSON.stringify({directory,newRequests:meter.entries.length-carried.requests,usage:meter.summary()}));
 });
}
if(import.meta.main)main().catch(e=>{console.error(String(e));process.exitCode=1;});
