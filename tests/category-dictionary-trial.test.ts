import { expect, test } from 'bun:test';
import { seed } from '../src/scenarios/category_attributes_governance/dictionary/seed.ts';
import { auditRequest, buildKnowledge, firstRequest, parseReply } from '../src/scenarios/category_attributes_governance/dictionary/trial/protocol.ts';
import { Meter } from '../src/scenarios/category_attributes_governance/meter.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('未知ID、伪造定义、错类目和条件格式不进入模板',()=>{
 const x={categoryId:'id',selections:[{propertyId:'sh.own.brand',revision:1,requirement:'required',rationale:'身份'}],newConcepts:[],note:'定义'};
 expect(parseReply(JSON.stringify(x),'id',seed).attributes).toHaveLength(1);
 expect(()=>parseReply(JSON.stringify(x),'other',seed)).toThrow('类目ID');
 expect(()=>parseReply(JSON.stringify({...x,selections:[{...x.selections[0],propertyId:'unknown'}]}),'id',seed)).toThrow('未知属性');
 expect(()=>parseReply(JSON.stringify({...x,selections:[{...x.selections[0],name:'强改'}]}),'id',seed)).toThrow('不允许覆盖');
 expect(()=>parseReply(JSON.stringify({...x,selections:[{...x.selections[0],requirement:'conditional'}]}),'id',seed)).toThrow('适用条件');
});
test('二轮完整保留前缀，思考显式关闭，不包含参考选择',()=>{
 const k=buildKnowledge(seed),c={id:'id',name:'充电式电钻',pathNames:['五金工具','充电式电钻']};
 const a=firstRequest('deepseek-flash',c,k),b=auditRequest(a,'{"modelOutput":true}');
 expect(b.messages.slice(0,a.messages.length)).toEqual(a.messages);
 expect(b.thinking).toEqual({type:'disabled'});expect(b.response_format).toEqual({type:'json_object'});
 expect(a.messages.some(m=>m.content?.includes('referenceHash'))).toBe(false);
 expect(b.messages[b.messages.length-2]?.content).toBe('{"modelOutput":true}');
});
test('预算预留不足时不发请求；恢复只本地重放且不重复计费',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dict-trial-'));let calls=0;
 const reply:any={id:'test',model:'deepseek-flash',choices:[],usage:{prompt_tokens:100,completion_tokens:10,prompt_cache_hit_tokens:20,prompt_cache_miss_tokens:80}};
 const req:any={model:'deepseek-flash',messages:[{role:'user',content:'x'}],max_tokens:100,thinking:{type:'disabled'}};
 try{
  const low=new Meter(join(dir,'low'),0.000001,async()=>{calls++;return reply});await expect(low.request(req,'cat','select')).rejects.toThrow('预算不足');expect(calls).toBe(0);
  const m=new Meter(join(dir,'ok'),1,async()=>{calls++;return reply});await m.init();await m.request(req,'cat','select');expect(calls).toBe(1);
  const resumed=new Meter(join(dir,'ok'),1,async()=>{calls++;return reply});await resumed.init();await resumed.request(req,'cat','select');expect(calls).toBe(1);expect(resumed.summary().requests).toBe(1);expect(resumed.summary().localReplays).toBe(1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
