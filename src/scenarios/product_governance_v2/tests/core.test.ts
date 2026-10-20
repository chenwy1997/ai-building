import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Ledger,canonical,hash,tokenCost,pool} from '../runtime/store.ts';
import {descendants} from '../tools/catalog.ts';
import {calculate,checkCard,applyRepair} from '../domain/validate.ts';
import {validate,outlineSchema} from '../domain/meta.ts';
import {parseOutput,normalizeSampleIds,usableWebText} from '../domain/normalize.ts';
import {registry} from '../domain/registry.ts';
test('only explicit common IDs merge; definition conflicts stop publication',()=>{
 const a={id:'common.brand',definition:'自身品牌'};
 expect(registry([{categoryId:'a',attributes:[a]},{categoryId:'b',attributes:[a]}]).shared).toHaveLength(1);
 expect(()=>registry([{attributes:[a]},{attributes:[{...a,definition:'兼容品牌'}]}])).toThrow('conflicting');
 expect(registry([{categoryId:'a',attributes:[{id:'size'}]},{categoryId:'b',attributes:[{id:'size'}]}]).categoryScoped).toHaveLength(2);
});
test('format normalization changes only invalid token outside quoted evidence',()=>{
 expect(parseOutput('{"text":"原文","}')).toEqual({value:{text:'原文'},repairs:1});
 const text=JSON.stringify({text:'包含 ,"} 和 \\" 的真实原文'});expect(parseOutput(text)).toEqual({value:JSON.parse(text),repairs:0});
 expect(()=>parseOutput('{"text":"unterminated')).toThrow();
});
test('sample ID normalization requires exact known ID and login pages are ineligible',()=>{
 expect(normalizeSampleIds([{productId:'sample-a'},{productId:'sample-b'}],new Set(['a']))).toEqual([{productId:'a'},{productId:'sample-b'}]);
 expect(usableWebText('Account\\:\nPassword\\:\nForgot password\\?\nSign in')).toBe(false);
 expect(usableWebText('产品参数：200抽，3层')).toBe(true);
});
test('stable JSON roundtrip preserves values, ordering and Unicode',()=>{
 const x={z:'中文\n001',a:[null,0,false,'1',1],n:{b:2,a:1}};
 expect(JSON.parse(canonical(x))).toEqual(x);expect(hash(x)).toBe(hash({n:{a:1,b:2},a:x.a,z:x.z}));
});
test('category IDs distinguish same names and reject cycles',()=>{
 const nodes:any[]=[{id:'a',name:'纸',parentId:'root',isLeaf:false},{id:'b',name:'纸',parentId:'other',isLeaf:true},{id:'c',name:'抽',parentId:'a',isLeaf:true}];
 expect(descendants(nodes,'a').map(x=>x.id)).toEqual(['a','c']);expect(()=>descendants(nodes,'unknown')).toThrow();
 expect(()=>descendants([{id:'x',parentId:'y'},{id:'y',parentId:'x'}] as any,'x')).toThrow();
});
test('shared budget remains bounded across concurrent reservations and restarts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pgv2-'));
 try{
  const l=new Ledger(dir,1);await l.init();
  const outcomes=await Promise.allSettled(Array.from({length:10},(_,i)=>l.reserve('r'+i,'responses',.3)));
  expect(outcomes.filter(x=>x.status==='fulfilled')).toHaveLength(3);
  const state=await l.status();expect(state.committed).toBeCloseTo(.9);
  await new Ledger(dir,1).init();expect((await l.status()).entries).toHaveLength(3);
  await expect(new Ledger(dir,50).init()).rejects.toThrow('budget changed');
  await l.finish(state.entries[0].id,'unknown',null);expect((await l.status()).committed).toBeCloseTo(.9);
  await expect(l.reserve(state.entries[0].id,'responses',.1)).rejects.toThrow('already reserved');
 }finally{await rm(dir,{recursive:true});}
});
test('cache usage costs are separated; missing usage retains reserve',()=>{
 expect(tokenCost({input_tokens:1000,output_tokens:100,input_tokens_details:{cached_tokens:800}})).toBeCloseTo(.001232);
 expect(tokenCost({})).toBeNull();expect(tokenCost({input_tokens:1,output_tokens:0,input_tokens_details:{cached_tokens:2}})).toBeNull();
});
test('counts use exact same-scope division, never guess unknown or fractional packs',()=>{
 expect(calculate('divide',[2000,4],true)).toBe(500);
 expect(()=>calculate('divide',[2000,3],true)).toThrow();
 expect(()=>calculate('divide',[2000,0],true)).toThrow();
 expect(()=>calculate('divide',[2000,4],false)).toThrow();
});
test('schema rejects missing fields, invented keys and fabricated type',()=>{
 expect(validate(outlineSchema,{categoryId:'a',samples:[],dimensions:[],unresolved:[]})).toContain('$.boundary:missing');
 expect(validate({type:'object',properties:{type:{type:'string',enum:['数值']}},required:['type'],additionalProperties:false},{type:'数字',extra:1})).toHaveLength(2);
});
function fixture(){
 return {categoryId:'a',boundary:{includes:'测试',excludes:[]},dimensions:[{name:'识别',purpose:'区分',attributeIds:['x']}],
 attributes:[{id:'x',name:'名称',kind:'公共属性',definition:'含义',describes:'商品',fieldType:'文本',unit:'',excludedMeanings:[],enumValues:[],enumPolicy:'保留原文'}],
 bindings:[{attributeId:'x',requiredness:'always',condition:'',valueLevel:'SKU',scope:'单件',uses:['展示'],rationale:'辨认'}],
 rules:[{attributeId:'x',directRule:'原文',operator:'direct',inputs:[],formula:'',preconditions:[],onMissing:'待补',onConflict:'保留冲突',examples:[{input:'a',expected:'a',reason:'直接'},{input:'',expected:'待补',reason:'缺失'}]}],
 provenance:[{attributeId:'x',claims:[{sourceId:'s',relation:'支持',claim:'示例',quote:'事实'}]}],unresolved:[]};
}
const sources:any=[{id:'s',kind:'web_page',text:'原文事实',platform:'test'}];
test('card validation rejects false evidence and lost definitions',()=>{
 const c=fixture();expect(checkCard(c,'a',sources)).toEqual([]);
 c.provenance[0]!.claims[0]!.quote='编造';expect(checkCard(c,'a',sources).join()).toContain('unverifiable quotation');
 c.bindings=[];expect(checkCard(c,'a',sources).join()).toContain('bindings');
});
test('numeric units and enum distinctions are validated',()=>{
 const c=fixture();c.attributes[0]!.fieldType='数值';expect(checkCard(c,'a',sources).join()).toContain('numeric unit missing');
 c.attributes[0]!.fieldType='选项';expect(checkCard(c,'a',sources).join()).toContain('enum missing');
});
test('repair leaves unrelated items intact and does not execute formula strings',()=>{
 const c=fixture(),p={removeIds:[],replacements:[],dimensions:c.dimensions,unresolved:['待确认']};
 const r=applyRepair(c,p);expect(r.attributes).toEqual(c.attributes);expect(c.unresolved).toEqual([]);
});
test('bounded scheduler completes remaining work and reports failures',async()=>{
 let active=0,peak=0;
 const r=await pool([1,2,3,4],async n=>{active++;peak=Math.max(peak,active);await Bun.sleep(3);active--;if(n===2)throw new Error('fail');},{initial:2,max:2,auto:false});
 expect(peak).toBe(2);expect(r.errors).toHaveLength(1);
});
