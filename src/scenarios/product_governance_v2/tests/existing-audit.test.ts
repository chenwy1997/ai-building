import {test,expect} from 'bun:test';
import {auditExisting,guardAuditPatch} from '../workflows/existing-audit.ts';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {read} from '../runtime/store.ts';
import {coverageIds} from '../domain/quality-checks.ts';
import {applyDirected} from '../workflows/directed-audit.ts';

test('directed delta preserves baseline and rejects unauthorized changes and core downgrades',()=>{
 const card={attributes:[{id:'x',name:'材质'}],bindings:[{attributeId:'x',requiredness:'always'}],rules:[],dimensions:[]};
 const decision={ids:['x'],addIds:[]};
 const patch={edits:[{attributeId:'x',group:'attributes',field:'name',valueJson:'"本体材质"'}],additions:[]};
 expect(applyDirected(card,patch,decision).card.attributes[0].name).toBe('本体材质');
 expect(card.attributes[0]!.name).toBe('材质');
 expect(()=>applyDirected(card,patch,{ids:[],addIds:[]})).toThrow('unapproved edit');
 expect(()=>applyDirected(card,{...patch,edits:[{attributeId:'x',group:'bindings',field:'requiredness',valueJson:'"optional"'}]},decision)).toThrow('core downgrade');
 expect(()=>applyDirected(card,{...patch,edits:[{attributeId:'x',group:'attributes',field:'id',valueJson:'"renamed"'}]},decision)).toThrow('invalid directed field');
});

test('existing-card audit never regenerates, applies scoped patch and resumes without calls',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'existing-audit-'));
 const a={id:'material',name:'材质',kind:'类目特性属性',definition:'本体原料',describes:'本体',fieldType:'文本',unit:'',excludedMeanings:[],enumValues:[],enumPolicy:''};
 const b={attributeId:a.id,requiredness:'optional',condition:'',valueLevel:'SKU',scope:'本商品',uses:['展示'],rationale:'材料差异'};
 const r={attributeId:a.id,directRule:'原文',operator:'direct',inputs:[],formula:'',preconditions:[],onMissing:'未知',onConflict:'待确认',examples:[{input:'合成：木',expected:'木',reason:'原文'},{input:'合成：未写',expected:'未知',reason:'缺证'}]};
 const p={attributeId:a.id,claims:[{sourceId:'model-knowledge',relation:'提出',claim:'业务判断',quote:''}]};
 const card={categoryId:'c',boundary:{includes:'配件',excludes:[]},dimensions:[{name:'结构',purpose:'区分',attributeIds:[a.id]}],attributes:[a],bindings:[b],rules:[r],provenance:[p],unresolved:[]};
 const review={categoryId:'c',verdict:'revise',summary:'限定对象',findings:[{attributeId:'material',criterion:'适用性',severity:'medium',issue:'对象要明确',recommendation:'限定本体'}],
  coverageChecks:coverageIds.map(checkId=>({checkId,status:'covered',attributeIds:[a.id],reason:'夹具说明'}))};
 const patch={replacements:[{attribute:{...a,definition:'配件本体的原料'},binding:b,rule:r,provenance:p}],removeIds:[],dimensions:card.dimensions,unresolved:[],changes:['限定本体']};
 expect(guardAuditPatch(card,patch,review)).toEqual([]);
 expect(guardAuditPatch(card,patch,{...review,findings:[]})).toContain('unreported field changed material');
 const m={protocol:'existing-audit-v1',standardHash:'fixed',categories:[{id:'c',name:'配件'}],entries:[{category:{id:'c',name:'配件'},card,sources:[{id:'model-knowledge',kind:'model_knowledge'}],sampleContext:{}}]};
 let calls=0;
 const call=async(stage:string)=>{calls++;return {value:stage==='existing_review'?review:stage==='existing_patch'?patch:{...review,verdict:'pass',findings:[]}};};
 try{
  const result=await auditExisting(dir,m,call,32);expect(result.errors).toEqual([]);expect(calls).toBe(3);
  const out=await read(join(dir,'categories/c/result.json'));
  expect(out.card.attributes[0].definition).toBe('配件本体的原料');
  expect(out.card.bindings).toEqual(card.bindings);
  await auditExisting(dir,m,call,32);expect(calls).toBe(3);
 }finally{await rm(dir,{recursive:true,force:true});}
});
