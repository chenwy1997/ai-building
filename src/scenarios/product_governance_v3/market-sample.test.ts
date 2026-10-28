import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Budget} from './budget.ts';
import {ResponsesClient} from './responses.ts';
import {save,read,hash,canonical} from './core.ts';
import {inspectMarketPilot} from './market-sample-inspect.ts';
import {candidateContext,marketRequest,providerUsage,runMarketStages,checkMarketResult} from './market-sample.ts';

const category={id:'target',name:'独立目标',path:'根>独立目标',scope:'offline_fixture',scopeNote:'构造样例，不是业务批准',products:[{sku:'1',title:'原文标题',unknownField:0}],stats:{skuCount:1},
  evidence:[{id:'e1',name:'参数',value:'原始值',sku:'1'}],pool:[{name:'参数',values:[{value:'原始值',spuCount:1}],evidenceIds:['e1']}]};
const selection={stage:'selection',categoryId:'target',scopeAssessment:'范围待人工复核',decisions:[
  {sourceName:'参数',action:'keep',attributeName:'参数原名',reason:'原样理由',businessUse:'具体业务',professionalBasis:'模型提案',valueEvidence:'原文',evidenceIds:['e1'],nativeOwnerKey:null,applicability:'本类'}],attributes:[],openQuestions:[]};
const definition={stage:'definition',categoryId:'target',scopeAssessment:'本类',decisions:[],attributes:[
  {name:'参数原名',sourceNames:['参数'],type:'text',unit:null,definition:'完整模型原文',fillRule:'原词填写',examples:['原始值'],enumValues:[],required:false,requiredReason:'未确认必填',applicability:'本类',businessUse:'具体业务',quantityResponsibility:'非数量',openQuestions:[]}],openQuestions:[]};
const message=(v:any)=>({type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(v)}]});
test('two stages preserve exact input prefix, reasoning and matched tool outputs without business rewrites',async()=>{
  const bodies:any[]=[],recorded:Record<string,any>={};let tools=0;
  const outputs=[
    [{type:'reasoning',id:'r',summary:[{type:'summary_text',text:'原始思考'}]},{type:'function_call',call_id:'call1',name:'read_candidate_evidence',arguments:'{"sourceName":"参数","offset":0,"limit":20}'}],
    [message(selection)],[message(definition)],
  ];
  const result=await runMarketStages({instructions:'固定规则',initialInput:[{role:'user',content:'完整共享资料'},{role:'user',content:'类目与样本'}],category,
    identity:{releaseId:'v1',snapshotVersion:'s1'},client:{request:async(body:any)=>{
      bodies.push(structuredClone(body));return {key:String(bodies.length),cached:false,response:{status:'completed',output:outputs[bodies.length-1]!,usage:{input_tokens:1000,input_tokens_details:{cached_tokens:bodies.length===1?0:700},output_tokens:100}}};}},
    tool:async()=>{tools++;return category.evidence;},record:async(n,v)=>{recorded[n]=structuredClone(v);}});
  expect(tools).toBe(1);expect(bodies).toHaveLength(3);
  for(let i=1;i<bodies.length;i++) {
    expect(bodies[i].input.slice(0,bodies[i-1].input.length)).toEqual(bodies[i-1].input);
    expect(bodies[i].instructions).toBe(bodies[0].instructions);
    expect(bodies[i].tools).toEqual(bodies[0].tools);expect(bodies[i].text).toEqual(bodies[0].text);
  }
  expect(bodies[2].input).toContainEqual(outputs[0]![0]);
  expect(bodies[2].input.filter((x:any)=>x.type==='function_call_output')[0].call_id).toBe('call1');
  expect(recorded.definition.result).toEqual(definition);
  expect(result.summary.issues).toEqual([]);expect(result.summary.tokenUsage.cacheHitTokens).toBe(1400);
  expect(result.summary.codexBusinessEdits).toBe(0);
});
test('provider cache usage is separate from local replay; unavailable is not zero',()=>{
  expect(providerUsage({input_tokens:300,input_tokens_details:{cached_tokens:200}})).toMatchObject({cacheHitRate:2/3,cacheMissTokens:100});
  expect(providerUsage({input_tokens:300}).cacheHitTokens).toBe(null);
});
test('all candidate values and unknown product fields survive context projection',()=>{
  const c=candidateContext(category);
  expect(c.candidates[0].values).toEqual(category.pool[0].values);
  expect(c.products[0].unknownField).toBe(0);
  expect(c.candidates[0].evidenceCount).toBe(1);
});
test('missing decisions and unselected definitions are recorded without editing model output',()=>{
  const s=structuredClone(selection);s.decisions=[];const before=JSON.stringify(s);
  expect(checkMarketResult(s,'selection',category).length).toBeGreaterThan(0);expect(JSON.stringify(s)).toBe(before);
  const d=structuredClone(definition);d.attributes[0]!.name='意外新增';const original=JSON.stringify(d);
  expect(checkMarketResult(d,'definition',category,selection).length).toBe(2);expect(JSON.stringify(d)).toBe(original);
});
test('schema rejects wrong nullable field type rather than loosening validation',()=>{
  const d:any=structuredClone(definition);d.attributes[0].unit=3;
  expect(()=>checkMarketResult(d,'definition',category,selection)).toThrow();
});
test('request prefix does not depend on class name or phase; supplied history remains immutable',()=>{
  const h:any[]=[{role:'user',content:'data'}];const a=marketRequest('rules',h);
  h.push({role:'user',content:'next'});expect(a.input.length).toBe(1);
  expect(marketRequest('rules',h).instructions).toBe(a.instructions);
});
test('actual failure pattern: missing nullable unit remains absent in offline review; no repair request',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'market-original-'));
  try {
    const budget=new Budget(dir,0,'offline');await budget.init();
    let calls=0;const broken:any=structuredClone(definition);delete broken.attributes[0].unit;
    const client=new ResponsesClient({mode:'offline',transportId:'raw-test',fetch:async()=>{
      calls++;return new Response(JSON.stringify({status:'completed',output:[message(calls===1?selection:broken)],
        usage:{input_tokens:1000,input_tokens_details:{cached_tokens:calls===1?0:900},output_tokens:100}}));
    }},dir,budget);
    const identity={releaseId:'offline',snapshotVersion:'sample'};
    await save(join(dir,'market-run.manifest.json'),{identity,category:{id:category.id},model:'deepseek-flash',reasoningEffort:'low'});
    await expect(runMarketStages({instructions:'规则',initialInput:[{role:'user',content:'完整资料'}],category,client,identity,
      tool:async()=>[],record:(n,v)=>save(join(dir,n+'.json'),v)})).rejects.toThrow('unit: missing');
    const review=await inspectMarketPilot(dir);
    expect(calls).toBe(2);expect(review.modelCorrections).toBe(0);
    expect(Object.hasOwn(review.stages.definition.result.attributes[0],'unit')).toBe(false);
    expect(hash(review.stages.definition.result)).toBe(hash(broken));
    expect(review.checks.some((x:any)=>x.kind==='schema'&&x.message.includes('unit'))).toBe(true);
    expect(review.prefix.every((x:any)=>x.exactInputPrefix)).toBe(true);
    expect((await read<any>(join(dir,'definition.raw.json'))).rawText).toBe(JSON.stringify(broken));
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('offline inspection detects omitted candidate from actual wire input without inventing a decision',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'market-coverage-'));
  try {
    const budget=new Budget(dir,0,'offline');await budget.init();
    const omitted=structuredClone(selection);omitted.decisions=[];
    let calls=0;
    const client=new ResponsesClient({mode:'offline',transportId:'coverage-test',fetch:async()=>{
      calls++;return new Response(JSON.stringify({status:'completed',output:[message(calls===1?omitted:definition)],
        usage:{input_tokens:1000,input_tokens_details:{cached_tokens:0},output_tokens:100}}));
    }},dir,budget);
    const identity={releaseId:'offline',snapshotVersion:'frozen'};
    await save(join(dir,'market-run.manifest.json'),{identity,category:{id:category.id},model:'deepseek-flash',reasoningEffort:'low'});
    await runMarketStages({instructions:'规则',initialInput:[{role:'user',content:canonical(candidateContext(category))}],category,client,identity,
      tool:async()=>[],record:(n,v)=>save(join(dir,n+'.json'),v)});
    const review=await inspectMarketPilot(dir);
    expect(review.candidateCoverage?.missing).toEqual(['参数']);
    expect(review.stages.selection.result.decisions).toEqual([]);
    expect(review.checks.some(x=>x.kind==='candidate_coverage')).toBe(true);
    expect(review.stages.selection.parsedHash).toBe(hash(omitted));
    expect(calls).toBe(2);
  }finally{await rm(dir,{recursive:true,force:true});}
});
