import {join} from 'node:path';
import {parseFlags} from '../category_governance/util.ts';
import {ROOT,read,optional,save,locked,hash} from './storage.ts';
import {prepare,SOURCE} from './context.ts';
import {Meter} from './meter.ts';
import {refine,REFINEMENT_VERSION} from './refinement.ts';
import {report} from './report.ts';
import {deepseekRuntime} from '../../ai/deepseek-runtime.ts';
import type {Outcome,Evidence} from './types.ts';

export async function evidenceFrom(run:string,id:string):Promise<Evidence[]>{
 const seen=new Set<string>();let name:string|undefined=run;
 while(name){if(!/^run-[\w-]+$/u.test(name)||seen.has(name))throw new Error('证据来源链无效');seen.add(name);const dir=join(ROOT,'output',name);
  const local=await optional<{evidence:Evidence[]}>(join(dir,'categories',id,'00-evidence.json'));if(local)return local.evidence;
  name=(await read<{source?:string}>(join(dir,'manifest.json'))).source;
 }
 const result=(await read<Outcome[]>(join(ROOT,'output',run,'results.json'))).find(r=>r.category.id===id);if(!result?.evidence.length)throw new Error('没有已缓存证据，不自动调用外部接口');return result.evidence;
}
interface Manifest {source:string;budget:number;fingerprint:string;carriedRequests:number;carriedCny:number}
export async function main(argv=Bun.argv.slice(2)){
 const {flags:f,positionals}=parseFlags(argv);
 if(f.help==='true'){console.log('bun run src/scenarios/category_attributes_governance/refinement-entry.ts --from=运行名 --concurrency=3 --direct\n--limit=4先验证4类；--resume=本次目录名继续。复用证据，累计沿用来源预算，不调用京东。');return;}
 if(positionals.length||Object.keys(f).some(k=>!['from','resume','concurrency','limit','direct','failed-only'].includes(k))||Boolean(f.from)===Boolean(f.resume))throw new Error('只指定--from或--resume其中之一');
 for(const name of [f.from,f.resume])if(name&&!/^run-[\w-]+$/u.test(name))throw new Error('运行名非法');
 const concurrency=Number(f.concurrency??3),limit=Number(f.limit??30);if(!Number.isInteger(concurrency)||concurrency<1||concurrency>8||!Number.isInteger(limit)||limit<1||limit>30)throw new Error('并发或limit超出试点范围');
 const name=f.resume??'run-'+new Date().toISOString().replace(/[:.]/g,'-')+'-hardware30-v2',directory=join(ROOT,'output',name);
 await locked(directory,async()=>{
  const previousManifest=f.resume?await read<Manifest>(join(directory,'manifest.json')):undefined;
  const source=f.from??previousManifest!.source,sourceDir=join(ROOT,'output',source),prior=await read<Outcome[]>(join(sourceDir,'results.json'));
  if(prior.length!==30||new Set(prior.map(r=>r.category.id)).size!==30||prior.some(r=>r.category.pathNames[1]!=='五金工具'))throw new Error('当前仅支持批准的五金工具30类固定验证集');
  const context=await prepare('五金工具',SOURCE),code=['refinement.ts','refinement-entry.ts','grounding.ts','staged.ts','protocol.ts','requirement-policy.ts','review-resolution.ts'];
  const fingerprint=hash([REFINEMENT_VERSION,context.contextHash,prior.map(r=>r.category.id),await Promise.all(code.map(p=>Bun.file(join(import.meta.dir,p)).text()))]);
  if(previousManifest&&previousManifest.fingerprint!==fingerprint)throw new Error('代码/范围变更，不能覆盖恢复');
  const sourceManifest=await read<{budget:number}>(join(sourceDir,'manifest.json'));
  if(!Number.isFinite(sourceManifest.budget)||sourceManifest.budget<=0||sourceManifest.budget>5)throw new Error('来源预算无效或超出5元批准范围');
  const runtime=await deepseekRuntime(f.direct==='true'),meter=new Meter(directory,sourceManifest.budget,runtime.chat);await meter.init();
  if(!previousManifest){meter.entries=await read(join(sourceDir,'usage.json'));meter.replies=await read(join(sourceDir,'responses.json'));await meter.persist();await save(join(directory,'responses.json'),meter.replies);}
  const manifest=previousManifest??{source,budget:sourceManifest.budget,fingerprint,carriedRequests:meter.entries.length,carriedCny:meter.used()};
  await save(join(directory,'manifest.json'),{...manifest,protocol:REFINEMENT_VERSION,thinking:'disabled',scope:'30类固定验证；先证据计划、整体规范、至多一次语义修订；不调用外部取证'});
  const fresh=await optional<Outcome[]>(join(directory,'revision-results.json'))??[],results=new Map(fresh.map(r=>[r.category.id,r]));
  const ordered=[...prior].sort((a,b)=>({failed:0,needs_review:1,accepted:2}[a.status]-{failed:0,needs_review:1,accepted:2}[b.status]));
  const selected=ordered.filter(r=>!results.has(r.category.id)&&(f['failed-only']!=='true'||r.status==='failed')).slice(0,limit);let cursor=0,stop=false,finished=0,writes=Promise.resolve();
  await Promise.all(Array.from({length:Math.min(concurrency,selected.length)},async()=>{while(!stop&&cursor<selected.length){
   const old=selected[cursor++]!,c=old.category,artifacts=join(directory,'categories',c.id);
   const outcome=await refine(c,context.branch(c),await evidenceFrom(source,c.id),meter,runtime.model,artifacts);
   if(outcome.error?.includes('预算不足')){stop=true;await save(join(artifacts,'partial-result.json'),outcome);continue;}
   results.set(c.id,outcome);await save(join(artifacts,'result.json'),outcome);
   writes=writes.then(()=>save(join(directory,'revision-results.json'),prior.flatMap(r=>results.has(r.category.id)?[results.get(r.category.id)!]:[])));await writes;
   console.log(`${++finished}/${selected.length} ${c.name}：${outcome.status}，${outcome.attributes.length}项 ${outcome.error??''}`);
  }}));
  const merged=prior.map(r=>results.get(r.category.id)??r);await save(join(directory,'results.json'),merged);await report(directory,merged,meter);
  await save(join(directory,'revision-status.json'),{source,processed:results.size,pending:prior.filter(r=>!results.has(r.category.id)).map(r=>r.category.id),budgetStopped:stop,additionalRequests:meter.entries.length-manifest.carriedRequests,additionalConservativeCny:meter.used()-manifest.carriedCny,usage:meter.summary()});
  console.log(JSON.stringify({directory,processed:results.size,pending:30-results.size,usage:meter.summary()}));
 });
}
if(import.meta.main)main().catch(e=>{console.error(String(e));process.exitCode=1;});
