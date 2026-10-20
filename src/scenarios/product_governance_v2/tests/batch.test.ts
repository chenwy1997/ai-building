import {test,expect} from 'bun:test';
import {layeredPrefixInput,governanceInstructions} from '../providers/prefix.ts';
import {selectLeaves,warmedPool} from '../runtime/batch.ts';
import {batchEngine,assembleCard} from '../workflows/batch-engine.ts';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {save,read} from '../runtime/store.ts';
import {validate} from '../domain/meta.ts';
import {normalizeModelKnowledgeQuotes} from '../domain/normalize.ts';
import {coverageIds,checkCoverage,consistencySignals,conceptChecklist,checkConceptCoverage,repairReview} from '../domain/quality-checks.ts';
test('layered shared context is lossless and invariant under task/category changes',()=>{
 const shared={reference:[{text:'原文 不能压缩 1.0',id:'a'}],units:['张','抽']};
 const a=layeredPrefixInput('outline',{sharedContext:shared,category:{id:'a'},value:null});
 const b=layeredPrefixInput('review',{category:{id:'b'},sharedContext:shared,value:2});
 expect(a.prefixHash).toBe(b.prefixHash);
 expect(JSON.parse(a.text)).toEqual({sharedContext:shared,instance:{category:{id:'a'},value:null,stage:'outline'}});
 expect(governanceInstructions({b:'乙',a:'甲'})).toBe(governanceInstructions({a:'甲',b:'乙'}));
});
for(const protocol of ['batch-v1-layered-v2','batch-v2-quality','batch-v3-concepts'])test('batch shared-first/review/repair/resume '+protocol,async()=>{
 const dir=await mkdtemp(join(tmpdir(),'governance-batch-'));
 const attr=(id:string,name:string)=>({id,name,kind:id.startsWith('common.')?'公共属性':'类目特性属性',definition:'明确的'+name,describes:'当前商品'+name,fieldType:'文本',unit:'',excludedMeanings:[],enumValues:[],enumPolicy:''});
 const rule=(id:string)=>({attributeId:id,directRule:'按原文',operator:'direct',inputs:[],formula:'',preconditions:[],onMissing:'缺失',onConflict:'待核',
  examples:[{input:'合成例：甲',expected:'甲',reason:'有原文'},{input:'合成例：无',expected:'缺失',reason:'无原文'}]});
 const prov=(id:string)=>({attributeId:id,claims:[{sourceId:'model-knowledge',relation:'提出',claim:'业务候选',quote:''}]});
 const common={attributes:[attr('common.brand','品牌'),attr('common.model','型号/货号')],rules:['common.brand','common.model'].map(rule),provenance:['common.brand','common.model'].map(prov),unresolved:[]};
 const categories=['a','b'].map(id=>({id,parentId:'r',name:id,path:'r>'+id,isLeaf:true}));
 const manifest={protocol,standardHash:'frozen',createdAt:'2026-10-20',categories,contextNodes:categories,references:[],referenceByCategory:{}};
 const calls:string[]=[];let fail=true;
 try{
  for(const c of categories)await save(join(dir,'samples',c.id+'.json'),{queryFile:'raw',fetchedAt:'2026-10-20',products:[{id:'p'+c.id,title:'样本',saleSpec:'',detailStatusConflicts:[]}]});
  const call=async(stage:string,input:any,schema:any)=>{
   calls.push(stage+':'+(input.category?.id??'shared'));
   if(stage==='outline'&&input.category.id==='b'&&fail)throw Error('simulated network stop');
   const ids=['local','common.brand','common.model'],bindings=ids.map(attributeId=>({attributeId,requiredness:'optional',condition:'',valueLevel:'SKU',scope:'本商品',uses:['展示'],rationale:'展示区别'}));
   let value:any;
   if(stage==='common_definitions')value=common;
   else if(stage==='common_review')value={categoryId:'shared',verdict:'pass',summary:'通过',findings:[]};
   else if(stage==='outline')value={categoryId:input.category.id,boundary:{includes:'物品',excludes:[]},samples:[{productId:'p'+input.category.id,status:'matched',reason:'符合'}],
    dimensions:[{name:'识别',purpose:'区分',candidates:[{name:'参数',definition:'描述参数',fieldType:'文本',use:'展示',sourceIds:['model-knowledge']}]}],unresolved:[]};
   else if(stage==='cards')value={categoryId:input.category.id,boundary:{includes:'物品',excludes:[]},dimensions:[{name:'识别',purpose:'区分',attributeIds:ids}],
    sharedIds:['common.brand','common.model'],attributes:[attr('local','参数')],bindings,rules:[rule('local')],provenance:[prov('local')],unresolved:[]};
   else if(stage==='review')value={categoryId:input.category.id,verdict:'revise',summary:'需明确',findings:[{attributeId:'local',criterion:'名称',severity:'low',issue:'过于笼统',recommendation:'明确对象'}],referenceDecisions:[]};
   else if(stage==='repair1')value={replacements:[{attribute:attr('local','产品参数'),binding:bindings[0],rule:rule('local'),provenance:prov('local')}],removeIds:[],
    dimensions:[{name:'识别',purpose:'区分',attributeIds:ids}],unresolved:[],changes:['明确参数名']};
   else value={categoryId:input.category.id,verdict:'pass',summary:'修复完成',findings:[]};
   if(protocol!=='batch-v1-layered-v2'&&(stage==='review'||stage.startsWith('recheck')))
    value.coverageChecks=coverageIds.map(checkId=>({checkId,status:'covered',attributeIds:['local'],reason:'测试夹具：当前属性覆盖'}));
   if(protocol==='batch-v3-concepts'&&(stage==='review'||stage.startsWith('recheck'))){
    // A false overall pass must not suppress a declared concept omission.
    if(stage==='review'){value.verdict='pass';value.findings=[];}
    value.conceptChecks=conceptChecklist.map(c=>({conceptId:c.id,
     status:c.id==='body_material'?(stage==='review'?'needs_attribute':'covered'):'not_applicable',
     attributeIds:c.id==='body_material'&&stage!=='review'?['local']:[],
     reason:c.id==='body_material'?'夹具的本体参数需要明确':'本测试对象没有该业务维度'}));
   }
   expect(validate(schema,value)).toEqual([]);
   return {value,callHash:stage};
  };
  const first=await batchEngine(dir,manifest,call,16);
  expect(first.errors.length).toBe(1);expect(first.completed).toBe(1);
  expect(calls.slice(0,2)).toEqual(['common_definitions:shared','common_review:shared']);
  const before=calls.length;fail=false;
  const second=await batchEngine(dir,manifest,call,32);
  expect(second.errors).toEqual([]);expect(second.completed).toBe(2);
  expect(calls.slice(before).every(c=>c.endsWith(':b'))).toBe(true);
  const result=await read(join(dir,'categories','a','result.json'));
  expect(result.card.attributes.find((a:any)=>a.id==='local').name).toBe('产品参数');
  expect(result.card.attributes.find((a:any)=>a.id==='common.brand')).toEqual(common.attributes[0]);
  expect(()=>assembleCard({...result.card,sharedIds:['common.brand','common.model']},common)).toThrow('referenced');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('concept decisions cannot be hidden by six broad groups or missing-data excuses',()=>{
 const card={attributes:[{id:'common.brand'},{id:'ply'}]};
 const review:any={findings:[],coverageChecks:coverageIds.map(checkId=>({checkId,status:'covered',attributeIds:['ply'],reason:'已有层数'})),
  conceptChecks:conceptChecklist.map(c=>({conceptId:c.id,status:'not_applicable',attributeIds:[],reason:'对象无此业务含义'}))};
 expect(checkCoverage(review,card)).toEqual([]);
 review.conceptChecks[0]={conceptId:'body_material',status:'needs_attribute',attributeIds:[],reason:'层数不能代表原料'};
 expect(checkConceptCoverage(review,card).some(x=>x.includes('omission requires'))).toBe(true);
 expect(repairReview(review,[]).findings[0].criterion).toBe('遗漏');
 review.conceptChecks[0]={conceptId:'body_material',status:'covered',attributeIds:['common.brand'],reason:'有品牌'};
 expect(checkConceptCoverage(review,card).some(x=>x.includes('substantive'))).toBe(true);
 review.conceptChecks[0]={conceptId:'body_material',status:'not_applicable',attributeIds:[],reason:'没有样本所以不要'};
 expect(checkConceptCoverage(review,card).some(x=>x.includes('missing evidence'))).toBe(true);
 review.conceptChecks.pop();
 expect(checkConceptCoverage(review,card).some(x=>x.includes('distinct'))).toBe(true);
});
test('repair regression leads catch fragrance, complete packaging chain and installation over-inference',()=>{
 const a=(id:string,name:string)=>({id,name,fieldType:'文本',enumValues:[]});
 const r=(attributeId:string,input:string,expected:string,reason='')=>({attributeId,operator:'direct',examples:[{input,expected,reason}],preconditions:[]});
 const card={attributes:[a('scent','香型'),a('total','销售总卷数'),a('install','安装方式')],bindings:[],
  rules:[r('scent','薰衣草香','有香型'),r('total','10卷/提×4提/箱×2箱','unknown','不同层级不得计算'),r('install','免打孔','粘贴')]};
 expect(consistencySignals(card)).toEqual([]); // Frozen older runs stay unchanged.
 expect(consistencySignals(card,true).map(x=>x.code)).toEqual(['Q_SCENT_GENERALIZATION','Q_COMPLETE_PACKAGING_CHAIN','Q_INSTALL_INFERENCE']);
 card.rules[0]!.examples[0]!.expected='薰衣草香（枚举外候选）';
 card.rules[1]!.examples[0]!.expected='80';
 card.rules[2]!.examples[0]!.input='免打孔粘贴式';
 expect(consistencySignals(card,true)).toEqual([]);
});
test('parent/child overlap is de-duplicated and unknown roots fail',()=>{
 const tree=[{id:'r',parentId:'',name:'根',path:'根',isLeaf:false},{id:'a',parentId:'r',name:'甲',path:'根>甲',isLeaf:true}];
 expect(selectLeaves(tree,['r','a','r']).map(x=>x.id)).toEqual(['a']);
 expect(()=>selectLeaves(tree,['missing'])).toThrow();
});
test('model proposals cannot claim quotations; actual external quotes and raw values remain intact',()=>{
 const raw={provenance:[{attributeId:'brand',claims:[
  {sourceId:'model-knowledge',claim:'常识候选',quote:'未核验的模型陈述'},
  {sourceId:'source-1',claim:'真实资料',quote:'原文 ABC 123'}]}]};
 const next=normalizeModelKnowledgeQuotes(raw);
 expect(next.changes).toHaveLength(1);
 expect(next.value.provenance[0].claims[0].quote).toBe('');
 expect(next.value.provenance[0].claims[1]).toEqual(raw.provenance[0]!.claims[1]);
 expect(raw.provenance[0]!.claims[0]!.quote).toBe('未核验的模型陈述');
});
test('global warmed queue skips completed tasks and honors bound',async()=>{
 let active=0,max=0;const done:number[]=[];
 const r=await warmedPool([0,1,2,3,4,5,6],async x=>x===0,async x=>{
  if(x>=3)expect(done).toEqual(expect.arrayContaining([1,2]));
  active++;max=Math.max(max,active);await Bun.sleep(2);active--;done.push(x);
 },3);
 expect(r.errors).toEqual([]);expect(r.skipped).toBe(1);expect(max).toBe(3);
});
test('quality checks flag contradictory examples and missing review dimensions without inventing fields',()=>{
 const card={attributes:[{id:'fragrance',enumValues:['柠檬香'],unit:''},{id:'count',enumValues:[],unit:'包'},{id:'size',enumValues:[],unit:'mm'}],
  bindings:[{attributeId:'count',requiredness:'conditional'}],
  rules:[{attributeId:'fragrance',operator:'direct',examples:[{input:'柠檬香盒装纸',expected:'枚举外待确认'}]},
   {attributeId:'count',operator:'multiply',preconditions:['可整除'],onMissing:'不必填',examples:[]},
   {attributeId:'size',operator:'direct',preconditions:['不随原文换算'],examples:[]}]};
 expect(consistencySignals(card).map(x=>x.code)).toEqual(['Q_ENUM_EXAMPLE','Q_MULTIPLY_DIVISION','Q_MISSING_APPLICABILITY','Q_UNIT_CONVERSION']);
 expect(checkCoverage({coverageChecks:[]},card)).toContain('Q_COVERAGE: six unique review dimensions required');
 expect(checkCoverage({coverageChecks:coverageIds.map(checkId=>({checkId,status:'covered',attributeIds:['invented'],reason:'x'}))},card)).toHaveLength(6);
 card.rules[0]!.examples=[{input:'柠檬香盒装纸',expected:'柠檬香'}];
 card.rules[1]!.preconditions=['乘法不要求可整除'];card.rules[1]!.onMissing='已知适用缺数量为missing';
 card.rules[2]!.preconditions=['明确cm可换算mm'];
 expect(consistencySignals(card)).toEqual([]);
});
