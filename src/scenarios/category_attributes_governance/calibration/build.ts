import {join} from 'node:path';
import {ROOT,read,save,hash} from '../storage.ts';
import {applyPatch,patch} from '../protocol.ts';
import type {Outcome} from '../types.ts';
interface Decisions {sourceRun:string;sourceHash:string;reviewer:string;decisions:Array<{id:string;patch:unknown;notes:string[]}>}
export async function buildReference(file=join(import.meta.dir,'pilot-decisions.json')){
 const d=await read<Decisions>(file);if(!/^run-[\w-]+$/u.test(d.sourceRun))throw new Error('来源运行名不合法');
 const raw=await Bun.file(join(ROOT,'output',d.sourceRun,'results.json')).text();if(hash(raw)!==d.sourceHash)throw new Error('原始候选已变化，禁止套用旧校准');
 const source:Outcome[]=JSON.parse(raw),byId=new Map(d.decisions.map(x=>[x.id,x]));if(byId.size!==d.decisions.length)throw new Error('重复校准');
 if(source.length!==d.decisions.length||source.some(s=>!byId.has(s.category.id)))throw new Error('校准必须逐类覆盖来源清单');
 const categories=source.map(s=>{const decision=byId.get(s.category.id)!;const refs=new Set(s.evidence.flatMap(e=>e.fields.map(f=>f[0])));return{category:s.category,status:'architect_reference',attributes:applyPatch(s.attributes,patch(decision.patch,refs),refs),evidence:s.evidence,reviewer:d.reviewer,notes:decision.notes,originalModelVerdict:s.review};});
 const target=join(ROOT,'reference','pilot-v1');await save(join(target,'reference.json'),{schema:'attribute-pilot-reference-v1',sourceRun:d.sourceRun,sourceHash:d.sourceHash,categories});
 const names:Record<string,string>={text:'文本',number:'数值',boolean:'布尔',single:'单选',multi:'多选',date:'日期',required:'必填',optional:'选填',conditional:'条件必填'};
 const esc=(s:unknown)=>String(s??'').replace(/\|/g,'／').replace(/[\r\n]/g,' ');
 let md='# 五金工具6类：属性参考样板\n\n这是架构师基于原始证据和行业知识逐类校准的参考稿，不是DeepSeek自动验收通过的结果，也未改写旧类目或旧比赛交付。用于对齐后续流程的语义验收标准；外部证据证明部分属性维度，K标记行业知识补充，不能当具体SKU实值。\n';
 for(const c of categories){md+=`\n## ${c.category.pathNames.slice(1).join(' > ')}\n\n${c.attributes.length}项属性。${c.notes.join('；')}\n\n|属性|类型|要求|单位|条件/枚举|定义及格式|\n|---|---|---|---|---|---|\n`;for(const a of c.attributes)md+='|'+[a[1],names[a[2]],names[a[3]],a[4],a[6]||a[5].join('；'),a[7]+(a[8]?'；格式：'+a[8]:'')].map(esc).join('|')+'|\n';}
 md+='\n## 依据和限制\n\n所有原始SKU与制造商来源、每个属性的引用ref、原模型审阅及校准决定均保留在reference.json和calibration/pilot-decisions.json。样板只覆盖这6个类目，不代表五金工具全部验证通过。行业通用属性允许K补充；特定标准、认证结论、具体SKU参数仍需实际资料。\n';
 await Bun.write(join(target,'查看样板.md'),md);console.log(JSON.stringify({categories:categories.length,attributes:categories.reduce((n,c)=>n+c.attributes.length,0),output:target,apiRequests:0}));return categories;
}
if(import.meta.main)buildReference(Bun.argv[2]).catch(e=>{console.error(String(e));process.exitCode=1;});
