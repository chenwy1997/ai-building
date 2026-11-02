import {join} from 'node:path';
import {read,optional} from './storage.ts';
import type {Outcome} from './types.ts';
type Metric={requests:number;input:number;hit:number;output:number;conservativeCny:number};
interface Arm {category:string;id:string;mode:string;status:string;total:Metric;producer:Metric}
export async function writeComparisonReport(directory:string){
 const data=await read<{arms:Arm[];additional:Metric;cumulative:{conservativeCny:number;budgetCny:number}}>(join(directory,'comparison.json'));
 const sum=(a:Arm[],field:'total'|'producer'):Metric=>a.reduce((n,a)=>({requests:n.requests+a[field].requests,input:n.input+a[field].input,hit:n.hit+a[field].hit,output:n.output+a[field].output,conservativeCny:n.conservativeCny+a[field].conservativeCny}),{requests:0,input:0,hit:0,output:0,conservativeCny:0});
 const pct=(m:Metric)=>m.input?(100*m.hit/m.input).toFixed(1)+'%':'—';
 const rows=['# 连续多轮与独立阶段对照','','同一2类、相同缓存证据、模型、任务契约；顺序AB/BA，关闭思考。每组重新请求API，不复用本地响应。远端历史缓存无法清空，且只有2类，不能推断冷启动公平胜负或全品类泛化。','','| 模式 | 请求 | 输入Token | 输出Token | 输入命中 | 费用估算/元 |','|---|---:|---:|---:|---:|---:|'];
 for(const mode of ['independent','conversation']){const m=sum(data.arms.filter(a=>a.mode===mode),'total');rows.push(`| ${mode==='independent'?'独立阶段':'连续多轮'} | ${m.requests} | ${m.input} | ${m.output} | ${pct(m)} | ${m.conservativeCny.toFixed(5)} |`);}
 rows.push('',`本次估算 ${data.additional.conservativeCny.toFixed(5)} 元；累计保守占用 ${data.cumulative.conservativeCny.toFixed(5)} / ${data.cumulative.budgetCny} 元。金额按项目记录单价计算，不代替平台账单。`,'','模型状态accepted只表示内部检查状态，不能替代语义验收。');
 const review=await optional<{conclusion:string;findings:Array<{category:string;mode:string;issue:string;judgment:string}>}>(join(directory,'expert-review.json'));
 if(review){rows.push('','## 独立复核', '',review.conclusion,'');for(const f of review.findings)rows.push(`- **${f.category} / ${f.mode}**：${f.issue} ${f.judgment}`);}
 const escape=(v:unknown)=>String(v??'').replace(/\|/g,'\\|').replace(/\n/g,' ');
 for(const arm of data.arms){
  const r=await read<Outcome>(join(directory,arm.mode,arm.id,'result.json'));
  rows.push('',`## ${arm.category} / ${arm.mode}`,'',`模型状态：${arm.status}；生成阶段输入命中 ${pct(arm.producer)}。`,'','| 属性 | 类型 | 要求 | 单位 | 枚举 | 条件 | 定义 | 格式 |','|---|---|---|---|---|---|---|---|');
  for(const a of r.attributes)rows.push('| '+[a[1],a[2],a[3],a[4],a[5].join('、'),a[6],a[7],a[8]].map(escape).join(' | ')+' |');
 }
 await Bun.write(join(directory,'对照结果.md'),rows.join('\n')+'\n');
}
if(import.meta.main){if(!Bun.argv[2])throw new Error('提供对照输出目录');await writeComparisonReport(Bun.argv[2]);}
