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
 expect((await c.generate('review',{},schema,100)).value).toEqual({value:'ok'});
 await c.generate('review',{},schema,100);expect(calls).toBe(2);expect((await read(c.ledger.path)).entries).toHaveLength(2);
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
