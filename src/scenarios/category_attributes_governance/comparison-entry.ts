import {join} from 'node:path';
import {parseFlags} from '../category_governance/util.ts';
import {ROOT,read,optional,save,locked,hash} from './storage.ts';
import {prepare,SOURCE} from './context.ts';
import {Meter} from './meter.ts';
import {refine,REFINEMENT_VERSION} from './refinement.ts';
import {writeComparisonReport} from './comparison-report.ts';
import {deepseekRuntime} from '../../ai/deepseek-runtime.ts';
import type {Outcome,Evidence} from './types.ts';
import type {GenerationMode} from './conversation.ts';

async function evidenceFrom(run:string,id:string):Promise<Evidence[]>{
 const seen=new Set<string>();let name:string|undefined=run;
 while(name){if(!/^run-[\w-]+$/u.test(name)||seen.has(name))throw new Error('证据来源链无效');seen.add(name);const dir=join(ROOT,'output',name);
  const local=await optional<{evidence:Evidence[]}>(join(dir,'categories',id,'00-evidence.json'));if(local)return local.evidence;
  name=(await read<{source?:string}>(join(dir,'manifest.json'))).source;
 }
 throw new Error('缺少原始缓存证据');
}
function metrics(entries:Meter['entries']){
 const input=entries.reduce((n,e)=>n+(e.usage?.prompt_tokens??0),0),hit=entries.reduce((n,e)=>n+(e.usage?.prompt_cache_hit_tokens??0),0);
 return{requests:entries.length,input,hit,hitRate:input?hit/input:0,output:entries.reduce((n,e)=>n+(e.usage?.completion_tokens??0),0),conservativeCny:entries.reduce((n,e)=>n+(e.charged??e.reserved),0),unknownRequests:entries.filter(e=>e.charged===undefined).length,reasoning:entries.reduce((n,e)=>n+(e.usage?.completion_tokens_details?.reasoning_tokens??0),0)};
}
export async function main(argv=Bun.argv.slice(2)){
 const {flags:f,positionals}=parseFlags(argv);
 if(f.help==='true'){console.log('bun run src/scenarios/category_attributes_governance/comparison-entry.ts --from=最新预算来源运行名 --direct\n固定2类、AB/BA顺序，共用来源5元硬预算；无本地响应复用，不调用京东。再次运行必须沿用最新累计账本。');return;}
 if(positionals.length||Object.keys(f).some(k=>!['from','direct'].includes(k))||!/^run-[\w-]+$/u.test(f.from??''))throw new Error('需要--from=最新预算来源运行名');
 const source=f.from!,sourceDir=join(ROOT,'output',source),prior=await read<Outcome[]>(join(sourceDir,'results.json'));
 const selected=['O形圈','热风枪发热芯'].map(n=>{const matches=prior.filter(r=>r.category.name===n);if(matches.length!==1)throw new Error('固定样本不存在或不唯一：'+n);return matches[0]!;});
 const budget=(await read<{budget:number}>(join(sourceDir,'manifest.json'))).budget;
 if(!(budget>0&&budget<=5))throw new Error('来源预算超出已批准5元');
 const context=await prepare('五金工具',SOURCE),runtime=await deepseekRuntime(f.direct==='true');
 const name='run-'+new Date().toISOString().replace(/[:.]/g,'-')+'-cache-ab',directory=join(ROOT,'output',name);
 await locked(directory,async()=>{
  const meter=new Meter(directory,budget,runtime.chat);meter.entries=await read(join(sourceDir,'usage.json'));await meter.persist();
  const start=meter.entries.length,carriedCny=meter.used();
  const codeHash=hash(await Promise.all(['comparison-entry.ts','conversation.ts','refinement.ts','staged.ts','grounding.ts','protocol.ts','meter.ts'].map(p=>Bun.file(join(import.meta.dir,p)).text())));
  await save(join(directory,'manifest.json'),{source,budget,protocol:REFINEMENT_VERSION,experiment:'cache-ab-v1',model:runtime.model,thinking:'disabled',codeHash,contextHash:context.contextHash,carriedRequests:start,carriedCny,order:['independent/conversation','conversation/independent'],limitations:['2类探索性对照，无统计显著性结论','远端缓存已有历史且无法清空；AB/BA不能完全消除预热差异','独立验收保持原逻辑，输出可能随机变化']});
  // Preserve the original fixed sample for future budget inheritance; arm outputs remain separate.
  await save(join(directory,'results.json'),prior);
  const arms:Array<Record<string,unknown>>=[];let stopped=false;
  for(const [i,old] of selected.entries()){
   const c=old.category,raw=await evidenceFrom(source,c.id),branch=context.branch(c);
   await save(join(directory,'categories',c.id,'00-evidence.json'),{evidence:raw});
   for(const mode of (i===0?['independent','conversation']:['conversation','independent']) as GenerationMode[]){
    const artifacts=join(directory,mode,c.id),begin=meter.entries.length,replays=meter.localReplays,started=Date.now();
    // Both arms perform real calls. Do not count local response replay as provider KV-cache reuse.
    meter.replies={};await save(join(directory,'responses.json'),{});
    console.log(`开始 ${c.name} / ${mode}；累计保守费用 ${meter.used().toFixed(4)} / ${budget}`);
    const result=await refine(c,branch,raw,meter,runtime.model,artifacts,mode);
    await save(join(artifacts,'result.json'),result);await save(join(artifacts,'responses.json'),meter.replies);
    const entries=meter.entries.slice(begin),producer=entries.filter(e=>['v2-01-plan','v2-02-grounding','v2-03-schema','v2-06-repair'].includes(e.phase));
    const arm={category:c.name,id:c.id,mode,evidenceHash:hash(raw),branchHash:hash(branch),firstEntry:begin+1,lastEntry:meter.entries.length,status:result.status,error:result.error,attributes:result.attributes.length,seconds:(Date.now()-started)/1000,localReplays:meter.localReplays-replays,total:metrics(entries),producer:metrics(producer),phases:Object.fromEntries([...new Set(entries.map(e=>e.phase))].map(p=>[p,metrics(entries.filter(e=>e.phase===p))]))};
    arms.push(arm);await save(join(directory,'comparison.json'),{arms,additional:metrics(meter.entries.slice(start)),cumulative:meter.summary()});console.log(JSON.stringify(arm));
    if(result.error?.includes('预算不足')){stopped=true;break;}
   }
   if(stopped)break;
  }
  await writeComparisonReport(directory);
  console.log(JSON.stringify({directory,complete:arms.length===4&&!stopped,additional:metrics(meter.entries.slice(start)),cumulative:meter.summary()}));
 });
}
if(import.meta.main)main().catch(e=>{console.error(String(e));process.exitCode=1;});
