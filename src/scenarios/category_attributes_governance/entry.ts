import {join} from 'node:path';
import {prepare,PILOT,SOURCE} from './context.ts';
import {ROOT,hash,read,save,optional,locked} from './storage.ts';
import {SYSTEM,AUDITOR,PROTOCOL} from './protocol.ts';
import {Sources,TOOLS} from './tools.ts';
import {Meter} from './meter.ts';
import {run,type RunOptions} from './runner.ts';
import type {Outcome} from './types.ts';
import {report} from './report.ts';
import {deepseekRuntime} from '../../ai/deepseek-runtime.ts';
import {parseFlags} from '../category_governance/util.ts';
const HELP=`新业务：类目属性治理；保留原类目；默认思考关闭。
bun run category-attributes-governance --plan
bun run category-attributes-governance --pilot --budget=2 --concurrency=2 --direct
bun run category-attributes-governance --category=五金工具 --all --budget=30 --concurrency=16 --jd-concurrency=2 --direct
bun run category-attributes-governance --resume=run-时间串 --budget=2 --direct

默认6个五金工具代表类目；--category=名称/ID/路径选择其他范围后用--all或--limit=N明确规模。
--plan 只准备与验证上下文，API零调用。
--limit=N 与--pilot/--all互斥；--budget=元 控制整个运行累计费用（按高峰费率保守预留，非充值余额）。
--refine-from=运行名 复用已有证据，按当前提示词重新修订/验收，不重做研究。
--resume=运行名 重用冻结清单、已通过结果、同请求原始响应和证据缓存，不重新支付相同请求。
--expand-rounds=2 最多两轮增量补充；--research-rounds=5；--max-tokens=2400；--attempts=2 请求/格式最多2次。
--jd-project=路径 复用现有京东VOP客户端；--jd-concurrency=2 独立限流；每类最多100候选、6详情。
--direct 当前进程直连API，不修改代理软件。公网搜索可设置TAVILY_API_KEY；没有时明确只查询本地已核验网络资料库。
输出 workspace/output/run-*/查看结果.md、templates.std.json、results.json、trace.jsonl、usage.json。无自动定版，无无限循环。`;
const positive=(s:string|undefined,def:number,max=10000)=>{const n=s===undefined?def:Number(s);if(!Number.isInteger(n)||n<1||n>max)throw new Error(`参数必须为1~${max}整数`);return n;};
export async function main(argv=Bun.argv.slice(2)){
 const {flags:f,positionals}=parseFlags(argv);if(f.help==='true'){console.log(HELP);return;}
 const allowed=['plan','pilot','all','limit','category','budget','concurrency','jd-concurrency','direct','jd-project','expand-rounds','research-rounds','max-tokens','attempts','resume','source','refine-from'];
 if(positionals.length||Object.keys(f).some(k=>!allowed.includes(k)))throw new Error('未知参数；使用--help查看，思考始终关闭');
 if(['pilot','all','limit'].filter(k=>f[k]!==undefined).length>1)throw new Error('pilot/all/limit互斥');
 const budget=Number(f.budget??2);if(!Number.isFinite(budget)||budget<=0)throw new Error('budget必须大于0');
 const manifestPath=f.resume?join(ROOT,'output',f.resume,'manifest.json'):undefined;
 if(f.resume&&!/^run-[\w-]+$/u.test(f.resume))throw new Error('resume必须是运行名');
 const previous=manifestPath?await optional<{selection:string;source:string;ids:string[];contextHash:string;configHash:string;options:RunOptions;jdProject:string;webLibraryHash:string;seedRun?:string}>(manifestPath):undefined;
 if(f.resume&&f['refine-from'])throw new Error('resume与refine-from互斥');
 if(f['refine-from']&&!/^run-[\w-]+$/u.test(f['refine-from']))throw new Error('refine-from必须是运行名');
 if(f.resume&&!previous)throw new Error('运行不存在');
 if(previous&&['category','pilot','all','limit','source','expand-rounds','research-rounds','max-tokens','attempts'].some(k=>f[k]!==undefined))throw new Error('resume使用冻结范围和参数；只可调整预算/并发/直连');
 const seedRun=previous?.seedRun??f['refine-from'];
 const seeds=seedRun?await read<Outcome[]>(join(ROOT,'output',seedRun,'results.json')):undefined;
 const context=await prepare(previous?.selection??f.category??'五金工具',previous?.source??f.source??SOURCE);
 let leaves=context.leaves;
 if(previous)leaves=previous.ids.map(id=>{const n=context.leaves.find(n=>n.id===id);if(!n)throw new Error('原运行类目缺失');return n;});
 else if(f.all!=='true'&&!f.limit){if(context.root.name!=='五金工具')throw new Error('其他范围请明确--all或--limit');leaves=PILOT.map(name=>{const found=leaves.filter(n=>n.name===name);if(found.length!==1)throw new Error(`试点类目不唯一：${name}`);return found[0]!;});}
 else if(f.limit)leaves=leaves.slice(0,positive(f.limit,6));
 if(seeds){const selected=new Set(leaves.map(n=>n.id));leaves=seeds.filter(s=>selected.has(s.category.id)).map(s=>{const c=context.leaves.find(n=>n.id===s.category.id)!;if(JSON.stringify(c.pathNames)!==JSON.stringify(s.category.pathNames))throw new Error('原始类目变化');return c;});if(!leaves.length)throw new Error('refine-from与范围无交集');}
 const options:RunOptions=previous?.options??{model:'deepseek-flash',attempts:positive(f.attempts,2,3),expandRounds:positive(f['expand-rounds'],2,4),researchRounds:positive(f['research-rounds'],5,8),maxTokens:positive(f['max-tokens'],2400,8000),concurrency:positive(f.concurrency,2,128)};
 if(f.concurrency)options.concurrency=positive(f.concurrency,2,128);
 const webLibraryHash=hash(await Bun.file(join(import.meta.dir,'knowledge/web-sources.json')).text());
 const configHash=hash([PROTOCOL,SYSTEM,AUDITOR,TOOLS,{...options,concurrency:0},context.contextHash,webLibraryHash,Boolean(process.env.TAVILY_API_KEY),seeds?hash(seeds):null]);
 if(previous&&previous.configHash!==configHash)throw new Error('协议、上下文或搜索能力改变；请新开运行，不覆盖原对话');
 console.log(`范围${context.root.name}：${context.leaves.length}个末级；本次${leaves.length}；思考关闭；预算${budget}元`);
 console.log(leaves.map(n=>n.pathNames.slice(1).join(' > ')).join('\n'));
 if(f.plan==='true'){console.log(`类目上下文：${context.dir}；无API调用`);return;}
 const runName=f.resume??'run-'+new Date().toISOString().replace(/[:.]/g,'-'),directory=join(ROOT,'output',runName);
 await locked(directory,async()=>{
  await save(join(directory,'manifest.json'),{protocol:PROTOCOL,selection:previous?.selection??f.category??'五金工具',source:previous?.source??f.source??SOURCE,seedRun,ids:leaves.map(n=>n.id),contextHash:context.contextHash,configHash,options,jdProject:previous?.jdProject??f['jd-project']??'/Users/sanheng/Project/sanheng/ai-core',webLibraryHash});
  const runtime=await deepseekRuntime(f.direct==='true');
  const meter=new Meter(directory,budget,runtime.chat);await meter.init();
  const sources=await Sources.create({direct:f.direct==='true',jdProject:previous?.jdProject??f['jd-project']??'/Users/sanheng/Project/sanheng/ai-core',jdConcurrency:positive(f['jd-concurrency'],2,8),maxCandidates:100,maxDetails:6,webKey:process.env.TAVILY_API_KEY});
  console.log(seeds?'复用已有证据，仅修订模板，不重新查询京东。':'开始按模型选择查询京东VOP；若IP白名单不可用会记录原因。');
  const results=await run(leaves,context.branch,meter,sources,options,seeds?new Map(seeds.map(s=>[s.category.id,s])):undefined);await report(directory,results,meter);
  await save(join(directory,'tool-usage.json'),{jdSearch:sources.searches,jdDetails:sources.details,webRequests:sources.webRequests,cacheHits:sources.cacheHits,jdUnavailable:sources.jdDisabled??null});
  console.log(JSON.stringify(meter.summary()));console.log(`结果：${join(directory,'查看结果.md')}`);
 });
}
if(import.meta.main)main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1;});
