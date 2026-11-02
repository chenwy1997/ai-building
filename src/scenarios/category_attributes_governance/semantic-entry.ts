import {join} from 'node:path';
import {parseFlags} from '../category_governance/util.ts';
import {ROOT,read,save,optional,locked,hash} from './storage.ts';
import {prepare,SOURCE} from './context.ts';
import {Meter} from './meter.ts';
import {governSemantic,SEMANTIC_VERSION} from './semantic-pipeline.ts';
import {evidenceFrom} from './refinement-entry.ts';
import {report} from './report.ts';
import {deepseekRuntime} from '../../ai/deepseek-runtime.ts';
import type {Outcome} from './types.ts';
interface Manifest {source:string;budget:number;fingerprint:string;selected:string[];carriedRequests:number;carriedCny:number}
export async function main(argv=Bun.argv.slice(2)){
 const {flags:f,positionals}=parseFlags(argv);
 if(f.help==='true'){console.log('bun run src/scenarios/category_attributes_governance/semantic-entry.ts --from=最新预算运行名 --direct\n默认O形圈、热风枪发热芯2类；--category=名称只跑1类（批准的30类内）。--resume=本次目录名复用已完成请求，代码变化拒绝恢复。预算默认10元，--budget可降低；沿用累计账本，不调用京东。');return;}
 if(positionals.length||Object.keys(f).some(k=>!['from','resume','category','direct','budget'].includes(k))||Boolean(f.from)===Boolean(f.resume))throw new Error('指定--from或--resume其一');
 for(const n of [f.from,f.resume])if(n&&!/^run-[\w-]+$/u.test(n))throw new Error('运行名非法');
 if(f.resume&&f.category)throw new Error('恢复不得修改类目范围');
 const name=f.resume??'run-'+new Date().toISOString().replace(/[:.]/g,'-')+'-semantic-v3',directory=join(ROOT,'output',name);
 await locked(join(ROOT,'semantic-budget-lock'),()=>locked(directory,async()=>{
  const old=f.resume?await read<Manifest>(join(directory,'manifest.json')):undefined;
  const source=f.from??old!.source,sourceDir=join(ROOT,'output',source),prior=await read<Outcome[]>(join(sourceDir,'results.json'));
  if(prior.length!==30||new Set(prior.map(r=>r.category.id)).size!==30||prior.some(r=>r.category.pathNames[1]!=='五金工具'))throw new Error('仅支持已批准的五金工具30类固定集合');
  const selected=old?prior.filter(r=>old.selected.includes(r.category.id)):(f.category?[f.category]:['O形圈','热风枪发热芯']).map(n=>{const m=prior.filter(r=>r.category.name===n);if(m.length!==1)throw new Error('类目不存在或不唯一：'+n);return m[0]!;});
  const budget=Number(f.budget??old?.budget??10);
  if(!Number.isFinite(budget)||!(budget>0&&budget<=10))throw new Error('预算必须大于0且不超过批准的10元');
  const context=await prepare('五金工具',SOURCE);
  const code=['semantic-pipeline.ts','semantic-contracts.ts','semantic-prompts.ts','semantic-entry.ts','refinement.ts','staged.ts','grounding.ts','protocol.ts','requirement-policy.ts','conversation.ts','meter.ts'];
  const fingerprint=hash([SEMANTIC_VERSION,context.contextHash,selected.map(r=>r.category.id),await Promise.all(code.map(p=>Bun.file(join(import.meta.dir,p)).text()))]);
  if(old&&old.fingerprint!==fingerprint)throw new Error('代码/输入变化，拒绝覆盖旧运行；用--from继承最新账本并开始新版本');
  const runtime=await deepseekRuntime(f.direct==='true'),meter=new Meter(directory,budget,runtime.chat);await meter.init();
  if(!old){meter.entries=await read(join(sourceDir,'usage.json'));meter.replies=await optional(join(sourceDir,'responses.json'))??{};await meter.persist();await save(join(directory,'responses.json'),meter.replies);}
  if(meter.used()>budget)throw new Error('累计历史费用已超过本次预算，不能通过换目录重置费用');
  const manifest=old?{...old,budget}:{source,budget,fingerprint,selected:selected.map(r=>r.category.id),carriedRequests:meter.entries.length,carriedCny:meter.used()};
  await save(join(directory,'manifest.json'),{...manifest,protocol:SEMANTIC_VERSION,thinking:'disabled',mode:'conversation',scope:'原类目属性；独立需求+证据含义核对+覆盖检查；一次修订'});
  const fresh=await optional<Outcome[]>(join(directory,'semantic-results.json'))??[];const results=new Map(fresh.map(r=>[r.category.id,r]));let budgetStopped=false;
  for(const oldResult of selected){const c=oldResult.category;if(results.has(c.id))continue;
   console.log(`开始 ${c.name}；累计保守费用 ${meter.used().toFixed(4)} / ${budget}`);
   const artifacts=join(directory,'categories',c.id),out=await governSemantic(c,context.branch(c),await evidenceFrom(source,c.id),meter,runtime.model,artifacts);
   if(out.error?.includes('预算不足')){budgetStopped=true;await save(join(artifacts,'partial-result.json'),out);break;}
   results.set(c.id,out);await save(join(artifacts,'result.json'),out);await save(join(directory,'semantic-results.json'),[...results.values()]);
   await save(join(directory,'results.json'),prior.map(r=>results.get(r.category.id)??r));
   console.log(`${c.name}：${out.status}，${out.attributes.length}项，${out.review?.issues.length??0}条待审意见 ${out.error??''}`);
  }
  await save(join(directory,'results.json'),prior.map(r=>results.get(r.category.id)??r));await report(directory,[...results.values()],meter);
  const status={directory,budgetStopped,processed:results.size,pending:selected.filter(r=>!results.has(r.category.id)).map(r=>r.category.id),additionalRequests:meter.entries.length-manifest.carriedRequests,additionalConservativeCny:meter.used()-manifest.carriedCny,usage:meter.summary()};
  await save(join(directory,'semantic-status.json'),status);console.log(JSON.stringify(status));
 }));
}
if(import.meta.main)main().catch(e=>{console.error(String(e));process.exitCode=1;});
