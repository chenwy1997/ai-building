import {join} from 'node:path';
import {parseFlags} from '../category_governance/util.ts';
import {prepare,SOURCE} from './context.ts';
import {ROOT,read,save,locked,hash} from './storage.ts';
import {staged,BASE,STAGED_VERSION} from './staged.ts';
import {Meter} from './meter.ts';
import {report} from './report.ts';
import {deepseekRuntime} from '../../ai/deepseek-runtime.ts';
import type {Outcome} from './types.ts';

export async function main(argv=Bun.argv.slice(2)){
 const {flags:f,positionals}=parseFlags(argv);
 if(f.help==='true'){console.log('bun run src/scenarios/category_attributes_governance/staged-entry.ts --category=热风枪发热芯 --evidence-from=run-2026-09-15T02-54-03-942Z --budget=0.5 --direct\n四阶段实验；一次一个末级类目，仅复用原始证据，不读候选属性；所有请求关闭思考。');return;}
 if(positionals.length||Object.keys(f).some(k=>!['category','evidence-from','budget','direct','replay-from'].includes(k)))throw new Error('未知参数，使用--help');
 const from=f['evidence-from']??'run-2026-09-15T02-54-03-942Z',budget=Number(f.budget??0.5);
 if(!/^run-[\w-]+$/u.test(from)||!Number.isFinite(budget)||budget<=0)throw new Error('运行名或预算不合法');
 if(f['replay-from']&&!/^run-[\w-]+$/u.test(f['replay-from']))throw new Error('replay-from运行名非法');
 const context=await prepare(f.category??'热风枪发热芯',SOURCE);if(context.leaves.length!==1)throw new Error('本实验一次仅允许一个末级类目');const category=context.leaves[0]!;
 const prior=await read<Outcome[]>(join(ROOT,'output',from,'results.json')),evidence=prior.find(r=>r.category.id===category.id)?.evidence;if(!evidence)throw new Error('缺少该类目原始证据');
 const directory=join(ROOT,'output','run-'+new Date().toISOString().replace(/[:.]/g,'-')+'-staged');
 await locked(directory,async()=>{
  await save(join(directory,'manifest.json'),{protocol:STAGED_VERSION,replayFrom:f['replay-from'],categoryId:category.id,evidenceFrom:from,evidenceHash:hash(evidence),promptHash:hash([await Bun.file(join(import.meta.dir,'staged.ts')).text(),await Bun.file(join(import.meta.dir,'grounding.ts')).text()]),scope:'仅类目属性模板；维度规划阶段不传商品证据，规范阶段仅传原始证据，不传旧属性模板',budget});
  const runtime=await deepseekRuntime(f.direct==='true'),meter=new Meter(directory,budget,runtime.chat);await meter.init();if(f['replay-from'])meter.replies=await read(join(ROOT,'output',f['replay-from'],'responses.json'));
  console.log(`${category.name}：身份与维度规划 → 证据支持度 → 字段规范 → 内部一致性检查；预算${budget}元；思考关闭`);
  const result=await staged(category,context.branch(category),evidence,meter,runtime.model);await save(join(directory,'results.json'),[result]);await report(directory,[result],meter);
  console.log(JSON.stringify({status:result.status,attributes:result.attributes.length,error:result.error,usage:meter.summary(),directory}));
 });
}
if(import.meta.main)main().catch(e=>{console.error(String(e));process.exitCode=1;});
