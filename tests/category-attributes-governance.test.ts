import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {toStdText,fromStdText,prepare} from '../src/scenarios/category_attributes_governance/context.ts';
import {attributes,applyPatch,patch,review} from '../src/scenarios/category_attributes_governance/protocol.ts';
import {Meter,BudgetError} from '../src/scenarios/category_attributes_governance/meter.ts';
import {govern} from '../src/scenarios/category_attributes_governance/runner.ts';
import type {Attribute,Category} from '../src/scenarios/category_attributes_governance/types.ts';
import type {Sources} from '../src/scenarios/category_attributes_governance/tools.ts';
import type {OpenAiChatRequest,OpenAiChatResponse} from '../src/ai/types.ts';
const response=(content:string):OpenAiChatResponse=>({id:'test',object:'chat.completion',created:0,model:'deepseek-flash',choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content}}],usage:{prompt_tokens:100,prompt_cache_hit_tokens:80,prompt_cache_miss_tokens:20,completion_tokens:40,total_tokens:140}});
const a:Attribute=['brand','品牌','text','required','',[],'','商品标示品牌','',['K']];
const req:OpenAiChatRequest={model:'deepseek-flash',messages:[{role:'user',content:'test'}],max_tokens:100,thinking:{type:'disabled'}};
test('短键属性无损转换，省略的可选字段有默认值，错误字段类型不能被吞掉',()=>{
 const input={upsert:[{k:'brand',n:'品牌',t:'text',r:'required',d:'商品标示品牌',e:['K']}],remove:[],done:true,gaps:[]};
 expect(patch(structuredClone(input),new Set()).upsert).toEqual([a]);
 const wrong={...input,upsert:[{...input.upsert[0],u:123}]};
 expect(()=>patch(wrong,new Set())).toThrow('类型');
 const enumInput={...input,upsert:[{k:'system',n:'制式',t:'single',r:'required',o:['公制','英制'],d:'制造商标示尺寸制式',e:['K']}]};
 expect(patch(enumInput,new Set()).upsert[0]![5]).toEqual(['公制','英制']);
});
test('类目压缩恢复原ID、父级、路径、名称和状态；共享父级仅记录一次',()=>{
 const c:Category={id:'a',name:'五金|工具\n特殊名称',parentId:'root',pathIds:['root','a'],pathNames:['标准类目','五金|工具\n特殊名称'],isLeaf:false,enabled:true,categoryId:null};
 const child:Category={...c,id:'b',name:'充电式热风枪',parentId:'a',pathIds:[...c.pathIds,'b'],pathNames:[...c.pathNames,'充电式热风枪'],isLeaf:true};
 const text=toStdText([child,c],[['root','标准类目']]);expect(fromStdText(text)).toEqual([c,child]);expect(text.split('五金|工具').length-1).toBe(1);
});
test('引用、枚举、条件、重复字段必须校验；补丁保留未修改字段',()=>{
 expect(()=>attributes([[...a.slice(0,9),['unknown']]],new Set())).toThrow('引用');
 const bool=[...a] as Attribute;bool[2]='boolean';bool[4]='W';expect(()=>attributes([bool],new Set())).toThrow('单位');
 const cond=[...a] as Attribute;cond[3]='conditional';expect(()=>attributes([cond],new Set())).toThrow('条件');
 const model=[...a] as Attribute;model[0]='model';model[1]='型号';
 expect(applyPatch([a],{upsert:[model],remove:[],done:true,gaps:[]},new Set())).toEqual([a,model]);
 expect(()=>applyPatch([a],{upsert:[],remove:['missing'],done:true,gaps:[]},new Set())).toThrow('不存在');
 expect(()=>review({pass:true,issues:[{key:'a',reason:'错误'}],gaps:[]})).toThrow();
});
test('并发预算先预留，超限不发送；无usage错误保留未知费用',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'attr-budget-'));let calls=0;
 const meter=new Meter(dir,0.012,async()=>{calls++;throw new Error('network timeout');});await meter.init();
 await Promise.allSettled([meter.request(req,'a','one'),meter.request(req,'b','two')]);
 expect(calls).toBe(1);expect(meter.used()).toBeGreaterThan(0);expect(meter.summary().unknownChargedRequests).toBe(1);
 await rm(dir,{recursive:true});
});
test('原始响应本地重放不付费；缓存计量分开输入输出，显式关闭思考',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'attr-replay-'));let calls=0;const meter=new Meter(dir,2,async r=>{expect(r.thinking?.type).toBe('disabled');calls++;return response('{}');});await meter.init();await meter.request(req,'a','draft');await meter.request(req,'a','draft');
 const resumed=new Meter(dir,2,async()=>{throw new Error('不应请求');});await resumed.init();await resumed.request(req,'a','draft');
 expect(calls).toBe(1);expect(resumed.summary()).toMatchObject({requests:1,input:100,hit:80,miss:20,output:40,localReplays:1});await rm(dir,{recursive:true});
});
test('多轮保留先前消息原文；独立验收不带生成者历史；零外部证据不自动通过',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'attr-flow-')),history:OpenAiChatRequest[]=[];
 const script=[{use:[],scope:'热风枪',gaps:[]},{use:[],scope:'热风枪',gaps:[]},{upsert:[a],remove:[],done:false,gaps:[]},{upsert:[],remove:[],done:true,gaps:[]},{pass:true,issues:[],gaps:[]}];
 const meter=new Meter(dir,2,async r=>{history.push(structuredClone(r));return response(JSON.stringify(script.shift()));});await meter.init();
 const sources={session:()=>({evidence:new Map(),execute:async()=>{throw new Error('无工具调用');}})} as unknown as Sources;
 const c:Category={id:'a',name:'热风枪',pathIds:['a'],pathNames:['热风枪'],parentId:null,isLeaf:true,enabled:true,categoryId:null};
 const result=await govern(c,'CAT',meter,sources,{model:'deepseek-flash',attempts:1,expandRounds:2,researchRounds:2,maxTokens:1000,concurrency:1});
 expect(result.status).toBe('needs_review');expect(result.attributes).toEqual([a]);expect(history[2]!.messages.slice(0,history[1]!.messages.length)).toEqual(history[1]!.messages);
 expect(history.at(-1)!.messages.length).toBe(3);expect(history.every(r=>r.thinking?.type==='disabled')).toBeTrue();await rm(dir,{recursive:true});
});
