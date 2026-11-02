import {join,resolve} from 'node:path';
import {parseFlags} from '../category_governance/util.ts';
import {ROOT,read,save,hash} from './storage.ts';
import {attributes} from './protocol.ts';
import {Meter} from './meter.ts';
import {report} from './report.ts';
import type {Attribute,Outcome} from './types.ts';
interface Change {key?:string;before?:string;set?:Record<string,unknown>;remove?:boolean;add?:Attribute;reason:string}
interface ExpertReview {version:string;sourceRun:string;sourceSha256:string;scope:string;decisions:Array<{categoryId:string;name:string;changes:Change[];note:string}>;sources:Array<{url:string;note:string}>}
const columns:Record<string,number>={name:1,type:2,requirement:3,unit:4,options:5,condition:6,description:7,format:8,refs:9};
export function applyExpertReview(original:Outcome[],review:ExpertReview){
 if(review.decisions.length!==original.length||new Set(review.decisions.map(d=>d.categoryId)).size!==original.length)throw new Error('专家审阅必须逐类覆盖，不允许静默漏类目');
 return original.map(r=>{
  const decision=review.decisions.find(d=>d.categoryId===r.category.id);if(!decision||decision.name!==r.category.name||!decision.note.trim())throw new Error('类目与审阅记录不匹配');
  const before=new Map(r.attributes.map(a=>[a[0],a])),after=new Map(r.attributes.map(a=>[a[0],structuredClone(a)]));
  for(const c of decision.changes){if(!c.reason?.trim())throw new Error('变更须有独立审阅理由');
   if(c.add){if(c.key||c.remove||c.set||after.has(c.add[0]))throw new Error('新增属性重复或混合操作');after.set(c.add[0],structuredClone(c.add));continue;}
   const old=before.get(c.key??'');if(!old||hash(old)!==c.before)throw new Error('属性原文已变化，不能套用旧审阅补丁：'+c.key);
   if(c.remove){if(c.set||!after.delete(c.key!))throw new Error('删除冲突');continue;}
   const a=after.get(c.key!);if(!a||!c.set)throw new Error('修改目标缺失');
   for(const [field,value] of Object.entries(c.set)){if(columns[field]===undefined)throw new Error('未知字段 '+field);(a as unknown[])[columns[field]!]=structuredClone(value);}
  }
  const checked=attributes([...after.values()],new Set(r.evidence.flatMap(e=>e.fields.map(f=>f[0]))));
  return {...r,attributes:checked,status:'accepted' as const,error:undefined,review:{pass:true,issues:[],gaps:[decision.note]},gaps:[decision.note,'AI专家逐项修订的试点参考稿，不是DeepSeek独立验收结果，也不代表行业标准认证'],fingerprint:hash([r.fingerprint,decision])};
 });
}
export async function main(argv=Bun.argv.slice(2)){
 const {flags:f,positionals}=parseFlags(argv);if(f.help==='true'){console.log('bun run src/scenarios/category_attributes_governance/apply-review-entry.ts --review=审阅JSON路径\n仅本地验证和应用明确审阅记录；不请求API，不修改原模型结果。');return;}
 if(positionals.length||Object.keys(f).some(k=>k!=='review')||!f.review)throw new Error('必须指定--review');
 const file=resolve(f.review),review=await read<ExpertReview>(file);if(!/^[\w-]+$/u.test(review.version)||!/^run-[\w-]+$/u.test(review.sourceRun))throw new Error('版本或来源非法');
 const source=join(ROOT,'output',review.sourceRun),raw=await Bun.file(join(source,'results.json')).text();if(hash(raw)!==review.sourceSha256)throw new Error('来源批次内容已改变，不能应用旧审阅');
 const results=applyExpertReview(JSON.parse(raw) as Outcome[],review),directory=join(ROOT,'reference',review.version);
 const meter=new Meter(directory,5,async()=>{throw new Error('专家参考生成禁止API请求');});meter.entries=await read(join(source,'usage.json'));
 await save(join(directory,'results.json'),results);await save(join(directory,'review.json'),review);
 await save(join(directory,'manifest.json'),{source:review.sourceRun,sourceSha256:review.sourceSha256,reviewSha256:hash(review),scope:review.scope,apiRequests:0,categoryCount:results.length,attributeCount:results.reduce((n,r)=>n+r.attributes.length,0)});
 await report(directory,results,meter);
 const path=join(directory,'查看结果.md');let md=await Bun.file(path).text();md=md.replace('# 五金工具属性治理验证','# 五金工具30类属性模板 · 专家修订参考稿').replace(/原类目名称和层级不变。[^\n]+/u,'原类目名称和层级不变。DeepSeek原稿经AI专家逐项审阅修订，30类均形成参考模板。原模型结果、修订理由和来源哈希另存，不将此结果计为模型独立通过。').replace(/状态：accepted。/g,'状态：专家修订参考稿。');
 await Bun.write(path,md);let changes='# 独立审阅与修订记录\n\n'+review.scope+'\n\n';
 for(const d of review.decisions){changes+='## '+d.name+'\n\n'+d.note+'\n\n';for(const c of d.changes)changes+=`- ${c.add?'新增 '+c.add[1]:c.remove?'删除 '+c.key:'修订 '+c.key}：${c.reason}\n`;changes+='\n';}
 changes+='## 外部核对资料\n\n';for(const s of review.sources)changes+=`- [${s.note}](${s.url})\n`;await Bun.write(join(directory,'审阅记录.md'),changes);
 console.log(JSON.stringify({directory,categories:results.length,attributes:results.reduce((n,r)=>n+r.attributes.length,0),changes:review.decisions.reduce((n,d)=>n+d.changes.length,0),apiRequests:0}));
}
if(import.meta.main)main().catch(e=>{console.error(String(e));process.exitCode=1;});
