import {join} from 'node:path';
import {ROOT,read,save,hash} from './storage.ts';
import {parseAudit} from './staged.ts';
import {Meter} from './meter.ts';
import {report} from './report.ts';
import type {Outcome} from './types.ts';
import type {OpenAiChatResponse} from '../../ai/types.ts';

/** Re-evaluate a saved audit after parser fixes. Never calls an AI or changes original outputs. */
export async function revalidate(name:string){
 if(!/^run-[\w-]+$/u.test(name??''))throw new Error('请提供run-运行名');const source=join(ROOT,'output',name);
 const results=await read<Outcome[]>(join(source,'results.json'));if(results.length!==1||!results[0]?.attributes.length)throw new Error('只恢复具有完整模板的单类实验');
 const usage=await read<Array<{phase:string;requestHash:string}>>(join(source,'usage.json'));
 const responses=await read<Record<string,OpenAiChatResponse>>(join(source,'responses.json'));
 const last=usage.filter(r=>r.phase==='04-consistency').at(-1);if(!last)throw new Error('没有第四阶段原始响应');
 const raw=responses[last.requestHash],choice=raw?.choices[0];if(!choice?.message.content||choice.finish_reason==='length')throw new Error('没有完整审阅内容');
 const original=results[0],audit=parseAudit(JSON.parse(choice.message.content),original.attributes);
 const result:Outcome={...original,status:audit.issues.length?'needs_review':'accepted',error:undefined,review:{pass:!audit.issues.length,issues:audit.issues.map(i=>({key:i.key,reason:i.reason})),gaps:audit.knowledgeGaps},gaps:[...original.gaps,...audit.knowledgeGaps,'离线重新校验原始审阅；没有模型重答，也未人工改写模板或审阅意见']};
 const destination=join(source,'revalidated');await save(join(destination,'manifest.json'),{kind:'local-parser-revalidation',sourceRun:name,originalResultHash:hash(original),responseHash:hash(raw),requestHash:last.requestHash,parserHash:hash(await Bun.file(join(import.meta.dir,'staged.ts')).text()),apiRequests:0});
 await save(join(destination,'results.json'),[result]);await save(join(destination,'04-consistency.json'),audit);
 const manifest=await read<{budget:number}>(join(source,'manifest.json'));
 const meter=new Meter(source,manifest.budget,async()=>{throw new Error('离线模式禁止API');});await meter.init();await report(destination,[result],meter);
 console.log(JSON.stringify({status:result.status,attributes:result.attributes.length,issues:audit.issues.length,apiRequests:0,destination}));
}
if(import.meta.main)revalidate(Bun.argv[2]??'').catch(e=>{console.error(String(e));process.exitCode=1;});
