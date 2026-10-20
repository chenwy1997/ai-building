import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DeepSeek} from '../providers/deepseek.ts';
import {read} from '../runtime/store.ts';
const schema={type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false};
const completed=(text='{"value":"ok"}')=>({status:'completed',id:'test',model:'deepseek-flash',usage:{input_tokens:100,output_tokens:20},output:[{type:'message',content:[{type:'output_text',text}]}]});
async function withClient(testfn:(c:DeepSeek)=>Promise<void>){
 const dir=await mkdtemp(join(tmpdir(),'pgv2-api-')),original=globalThis.fetch,key=process.env.DEEPSEEK_API_KEY;
 process.env.DEEPSEEK_API_KEY='test-only-placeholder';
 try{const client=new DeepSeek(dir,'test',50);await client.init();await testfn(client);}
 finally{globalThis.fetch=original;if(key===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=key;await rm(dir,{recursive:true});}
}
test('identical concurrent and resumed calls issue only one paid request',()=>withClient(async c=>{
 let calls=0;globalThis.fetch=(async()=>{calls++;await Bun.sleep(3);return Response.json(completed());}) as any;
 const values=await Promise.all([c.generate('test',{},schema,100),c.generate('test',{},schema,100)]);
 expect(values[0].value).toEqual({value:'ok'});await c.generate('test',{},schema,100);expect(calls).toBe(1);
}));
test('one non-thinking recovery only for known token exhaustion and both usages retained',()=>withClient(async c=>{
 let calls=0;globalThis.fetch=(async(_url:any,init:any)=>{
  calls++;const body=JSON.parse(init.body);
  return Response.json(body.reasoning.effort==='low'?{status:'incomplete',incomplete_details:{reason:'max_output_tokens'},usage:{input_tokens:100,output_tokens:100},output:[]}:completed());
 }) as any;
 expect((await c.generate('review',{},schema,100,'low')).value).toEqual({value:'ok'});
 await c.generate('review',{},schema,100,'low');expect(calls).toBe(2);expect((await read(c.ledger.path)).entries).toHaveLength(2);
}));
test('network unknown is not automatically retried and reservation is retained',()=>withClient(async c=>{
 let calls=0;globalThis.fetch=(async()=>{calls++;throw new Error('socket');}) as any;
 await expect(c.generate('test',{},schema,100)).rejects.toThrow('unknown');
 await expect(c.generate('test',{},schema,100)).rejects.toThrow('unresolved');
 expect(calls).toBe(1);expect((await c.ledger.status()).committed).toBeGreaterThan(0);
}));
test('402 stops subsequent requests without another provider call',()=>withClient(async c=>{
 let calls=0;globalThis.fetch=(async()=>{calls++;return Response.json({error:'no credit'},{status:402});}) as any;
 await expect(c.search('a')).rejects.toThrow('402');await expect(c.search('b')).rejects.toThrow('stopped');expect(calls).toBe(1);
}));
test('layered layout reuses v1 and keeps unknown receipts instead of paying again',()=>withClient(async c=>{
 let calls=0;globalThis.fetch=(async(_url:any,init:any)=>{
  calls++;expect(JSON.parse(init.body).reasoning.effort).toBe('none');return Response.json(completed());
 }) as any;
 const input={sharedContext:{reference:'unchanged'},categoryId:'a'};
 const old=await c.generate('cards',input,schema,100);
 const next=await c.generate('cards',input,schema,100,'none',{layout:'layered'});
 expect(next.callHash).toBe(old.callHash);expect(calls).toBe(1);
 globalThis.fetch=(async()=>{calls++;throw Error('unknown transport');}) as any;
 await expect(c.generate('other',input,schema,100)).rejects.toThrow('unknown');
 await expect(c.generate('other',input,schema,100,'none',{layout:'layered'})).rejects.toThrow('unresolved');
 expect(calls).toBe(2);
}));
test('switching layout reuses historical completed requests unless benchmark explicitly opts out',()=>withClient(async c=>{
 let calls=0;globalThis.fetch=(async()=>{calls++;return Response.json(completed());}) as any;
 const input={card:{rules:['stable']},productId:'one'};
 const old=await c.generate('fill',input,schema,100,'none',{layout:'legacy'});
 const reused=await c.generate('fill',input,schema,100,'none');expect(reused.callHash).toBe(old.callHash);expect(calls).toBe(1);
 const fresh=await c.generate('fill',input,schema,100,'none',{reuseLegacy:false});expect(fresh.callHash).not.toBe(old.callHash);expect(calls).toBe(2);
 await c.generate('fill',input,schema,100,'none',{reuseLegacy:false});expect(calls).toBe(2);
}));
test('empty outline placeholders are removed without a paid repair or changing original response',()=>withClient(async c=>{
 const outlineSchema={type:'object',properties:{dimensions:{type:'array',minItems:1,items:{type:'object',
  properties:{name:{type:'string'},candidates:{type:'array',minItems:1,items:{type:'string'}}},required:['name','candidates'],additionalProperties:false}}},
  required:['dimensions'],additionalProperties:false};
 const data={dimensions:[{name:'公共已另行给定',candidates:[]},{name:'计量',candidates:['长度']}]};
 let calls=0;globalThis.fetch=(async()=>{calls++;return Response.json(completed(JSON.stringify(data)));}) as any;
 const r=await c.generate('outline',{},outlineSchema,100);
 expect(r.value.dimensions).toEqual([data.dimensions[1]]);expect(calls).toBe(1);
 const raw=await read(join(c.run,'calls',r.callHash,'response.json'));
 expect(JSON.parse(raw.output[0].content[0].text)).toEqual(data);
}));
