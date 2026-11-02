import {join,resolve} from 'node:path';
import {parseFlags} from '../category_governance/util.ts';
import {ROOT,read,optional,save,hash,locked} from './storage.ts';
import {Meter} from './meter.ts';
import {COMMON} from './refinement.ts';
import {CLAIM_TASK,SEMANTIC_AUDIT_TASK} from './semantic-prompts.ts';
import {parseClaimVerdicts,parseSemanticAudit,semanticFindings,type Claim,type Needs} from './semantic-contracts.ts';
import type {Attribute} from './types.ts';
import {deepseekRuntime} from '../../ai/deepseek-runtime.ts';
interface Case {id:string;kind:'claims'|'audit';category:string[];data:{claims?:Claim[];needs?:Needs;attributes?:Attribute[];sources?:unknown};expected:{rejected?:Array<{key:string;ref:string}>;supported?:Array<{key:string;ref:string}>;issueKeys?:string[]}}
export async function main(argv=Bun.argv.slice(2)){
 const {flags:f,positionals}=parseFlags(argv);
 if(f.help==='true'){console.log('bun run src/scenarios/category_attributes_governance/semantic-regression-entry.ts --from=最新预算运行名 --cases=回归样本JSON路径 --direct\n真实回放既有缺陷，期望答案不发给模型；累计预算10元，已有相同请求本地复用。');return;}
 if(positionals.length||Object.keys(f).some(k=>!['from','cases','direct'].includes(k))||!/^run-[\w-]+$/u.test(f.from??'')||!f.cases)throw new Error('需要--from和--cases');
 const source=f.from!,sourceDir=join(ROOT,'output',source),fixtures=await read<{cases:Case[]}>(resolve(f.cases));
 if(!Array.isArray(fixtures.cases)||!fixtures.cases.length||fixtures.cases.length>6)throw new Error('每次1~6个回归案例');
 const directory=join(ROOT,'output','run-'+new Date().toISOString().replace(/[:.]/g,'-')+'-semantic-regression');
 await locked(join(ROOT,'semantic-budget-lock'),()=>locked(directory,async()=>{
  const runtime=await deepseekRuntime(f.direct==='true'),meter=new Meter(directory,10,runtime.chat);meter.entries=await read(join(sourceDir,'usage.json'));meter.replies=await optional(join(sourceDir,'responses.json'))??{};await meter.persist();
  const start=meter.entries.length,carried=meter.used();
  await save(join(directory,'manifest.json'),{source,budget:10,kind:'known-defect-regression',fixturesHash:hash(fixtures),carriedRequests:start,carriedCny:carried,thinking:'disabled'});
  await save(join(directory,'fixtures.json'),fixtures);await save(join(directory,'results.json'),await read(join(sourceDir,'results.json')));
  const results=[];
  for(const c of fixtures.cases){if(!['claims','audit'].includes(c.kind))throw new Error('回归类型非法');
   const task=c.kind==='claims'?CLAIM_TASK:SEMANTIC_AUDIT_TASK;
   const messages=[{role:'system' as const,content:COMMON},{role:'user' as const,content:task},{role:'user' as const,content:JSON.stringify({category:c.category,data:c.data})}];
   let result:unknown,error:string|undefined,matched=false;
   for(let attempt=0;attempt<2;attempt++){
    try{const r=await meter.request({model:runtime.model,messages,thinking:{type:'disabled'},temperature:0.1,response_format:{type:'json_object'},max_tokens:2200,stream:false},c.id,'v3-regression-'+c.kind);
     const choice=r.choices[0];if(!choice?.message.content||choice.finish_reason==='length')throw new Error('输出为空或截断');
     const value=JSON.parse(choice.message.content);
     if(c.kind==='claims'){
      const parsed=parseClaimVerdicts(value,c.data.claims!);result=parsed;
      matched=(c.expected.rejected??[]).every(e=>parsed.checks.some(x=>x.key===e.key&&x.ref===e.ref&&x.verdict==='unsupported'))&&(c.expected.supported??[]).every(e=>parsed.checks.some(x=>x.key===e.key&&x.ref===e.ref&&x.verdict==='supported'));
     }else {const parsed=parseSemanticAudit(value,c.data.attributes!,c.data.needs!);result=parsed;matched=(c.expected.issueKeys??[]).every(k=>semanticFindings(parsed).some(i=>i.key===k));}
     error=undefined;break;
    }catch(e){error=String(e);if(error.includes('预算不足'))break;messages.push({role:'user',content:'修复契约错误，不复制输入：'+error});}
   }
   results.push({id:c.id,matchedExpected:matched,result,error});await save(join(directory,'regression-results.json'),results);console.log(`${c.id}：${error??(matched?'检出预期缺陷/保留正确引用':'未达到回归预期')}`);
   if(error?.includes('预算不足'))break;
  }
  const summary={directory,cases:results.length,matched:results.filter(r=>r.matchedExpected).length,additionalRequests:meter.entries.length-start,additionalConservativeCny:meter.used()-carried,usage:meter.summary()};await save(join(directory,'regression-summary.json'),summary);console.log(JSON.stringify(summary));
 }));
}
if(import.meta.main)main().catch(e=>{console.error(String(e));process.exitCode=1;});
