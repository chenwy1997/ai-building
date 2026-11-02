import {join} from 'node:path';
import type {Outcome} from './types.ts';
import type {Meter} from './meter.ts';
import {save} from './storage.ts';
const cell=(s:unknown)=>String(s??'').replace(/\|/g,'／').replace(/[\r\n]+/g,' ');
export async function report(directory:string,results:Outcome[],meter:Meter){
 const usage=meter.summary();const status={accepted:results.filter(r=>r.status==='accepted').length,needsReview:results.filter(r=>r.status==='needs_review').length,failed:results.filter(r=>r.status==='failed').length};
 await save(join(directory,'summary.json'),{categories:results.length,...status,usage});
 const dictionary:unknown[][]=[],idx=new Map<string,number>();const compact=results.map(r=>({id:r.category.id,path:r.category.pathNames,status:r.status,attributes:r.attributes.map(a=>{const key=JSON.stringify(a);if(!idx.has(key)){idx.set(key,dictionary.length);dictionary.push(a);}return idx.get(key)!;}),gaps:r.gaps,issues:r.review?.issues??[],error:r.error??''}));
 await save(join(directory,'templates.std.json'),{schema:'category-attributes-v1',legend:'[key,name,type,requirement,unit,options,condition,description,format,refs]',dictionary,categories:compact});
 let md=`# 五金工具属性治理验证\n\n原类目名称和层级不变。${results.length}类：模型验收通过${status.accepted}，待人工检查${status.needsReview}，请求/格式失败${status.failed}。模型验收通过不等于人工定版。\n\n输入${usage.input}，输出${usage.output}，缓存命中${usage.hit}（${(usage.hitRate*100).toFixed(1)}%），思考${usage.reasoning}。按官方高峰价格保守核算${usage.conservativeCny.toFixed(4)}元，预算${usage.budgetCny}元；失败且没有usage的请求保留预留额度，最终账单以平台为准。\n`;
 for(const r of results){md+=`\n## ${r.category.pathNames.slice(1).join(' > ')}\n\n状态：${r.status}。${r.error??''}\n\n|属性|类型|填写要求|单位|枚举/条件|定义与格式|依据|\n|---|---|---|---|---|---|---|\n`;
 for(const a of r.attributes)md+='|'+[a[1],a[2],a[3],a[4],a[5].join('；')||a[6],a[7]+(a[8]?'；'+a[8]:''),a[9].join(',')].map(cell).join('|')+'|\n';
 if(r.review?.issues.length)md+='\n验收问题：'+r.review.issues.map(i=>i.key+'：'+i.reason).join('；')+'\n';
 if(r.gaps.length)md+='\n待补知识：'+r.gaps.join('；')+'\n';
 md+='\n证据：\n';for(const e of r.evidence)md+=`- ${e.id}：[${cell(e.title)}](${e.url})，${e.fields.length}个原始字段。\n`;md+='\nK=行业常识推断，未经外部核验；其他引用逐字段关联results.json内证据。\n';
 }
 await Bun.write(join(directory,'查看结果.md'),md);
}
