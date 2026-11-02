import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {parseNeeds,parseSourceScope,parseClaimVerdicts,verifiedAllowlist,parseSemanticAudit,semanticFindings,repairFeedback} from '../src/scenarios/category_attributes_governance/semantic-contracts.ts';
import {governSemantic,parseRevisedSchema} from '../src/scenarios/category_attributes_governance/semantic-pipeline.ts';
import {Meter} from '../src/scenarios/category_attributes_governance/meter.ts';
import type {OpenAiChatRequest} from '../src/ai/types.ts';
import type {Attribute} from '../src/scenarios/category_attributes_governance/types.ts';
const needs=parseNeeds({needs:[{id:'fit',dimension:'接口尺寸',object:'接合部',scope:'intrinsic',meaning:'接合部直径',purpose:'判断能否装入'}],applicationContext:[],gaps:[]});
const plan={boundary:'PRODUCER_PRIVATE',identity:{ownBrand:'brand',ownModel:'model',omissionReason:''},dimensions:[{key:'brand',name:'品牌',purpose:'身份',importance:'core' as const},{key:'model',name:'型号',purpose:'采购标识',importance:'core' as const}],knowledgeGaps:[]};
const fields=[{k:'brand',n:'品牌',t:'text',r:'required',d:'产品品牌',e:['R0']},{k:'model',n:'型号',t:'text',r:'conditional',c:'制造商分配型号时',d:'制造商产品型号',e:['K']}];
const added={k:'diameter',n:'接口直径',t:'number',r:'required',u:'mm',d:'接合部直径',e:['K']};
const schema=(upsert:unknown[])=>({upsert,remove:[],done:true,gaps:[]});
const missing={coverage:[{need:'fit',keys:[],verdict:'missing',reason:'没有接口尺寸，不能判断安装适配'}],rows:['brand','model'].map(key=>({key,nameMeaning:'身份',definitionMeaning:'身份',verdict:'pass',reason:'身份定义清楚'})),issues:[],gaps:[]};
test('引用存在不能代替语义支持；unsupported和uncertain都不能进入外证白名单',()=>{
 const claims=[{key:'model',name:'型号',meaning:'自身型号',ref:'R0',quote:'品牌甲',sourceTitle:'产品',sourceField:'品牌',sourceValue:'品牌甲'}];
 const judged=parseClaimVerdicts({checks:[{key:'model',ref:'R0',verdict:'unsupported',reason:'该内容是品牌而非型号'}]},claims);
 expect(verifiedAllowlist(['model'],judged.checks)).toEqual({model:['K']});
 expect(()=>parseClaimVerdicts({checks:[]},claims)).toThrow('覆盖');
 expect(()=>parseClaimVerdicts({checks:[{key:'model',ref:'R9',verdict:'supported',reason:'存在'}]},claims)).toThrow();
});
test('缺失需求必须阻止验收，不需要编造不存在的属性key；空覆盖不能谎称covered',()=>{
 const attrs:Attribute[]=[['brand','品牌','text','required','',[],'','产品品牌','',['K']],['model','型号','text','conditional','',[],'制造商分配型号时','产品型号','',['K']]];
 const a=parseSemanticAudit(missing,attrs,needs);expect(semanticFindings(a)[0]!.key).toBe('need:fit');
 expect(()=>parseSemanticAudit({...missing,coverage:[{...missing.coverage[0],verdict:'covered'}]},attrs,needs)).toThrow('至少一个');
});
test('修订能增加缺失维度，但新维度不能借用已有属性的外证',()=>{
 const allowed={brand:['K','R0'],model:['K']},map={R0:'E.0'};
 expect(parseRevisedSchema(schema([...fields,added]),plan,allowed,map)).toHaveLength(3);
 expect(()=>parseRevisedSchema(schema([...fields,{...added,e:['R0']}]),plan,allowed,map)).toThrow('白名单');
 expect(()=>parseRevisedSchema(schema([fields[0],added]),plan,allowed,map)).toThrow('身份');
});
test('多轮修订补漏、独立审阅不看生成计划、剩余不确定不被裁决自动消除',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'semantic-v3-')),requests:OpenAiChatRequest[]=[];
 const final={coverage:[{need:'fit',keys:['diameter'],verdict:'covered',reason:'接口直径已提供'}],rows:[...missing.rows,{key:'diameter',nameMeaning:'接口直径',definitionMeaning:'接合部直径',verdict:'uncertain',reason:'测量部位仍需行业确认'}],issues:[],gaps:[]};
 const replies=[{documents:[{id:'D0',relation:'target',reason:'本类产品'},{id:'D1',relation:'related',reason:'关联整机'}]},needs,plan,{items:['brand','model'].map(key=>({key,links:[{ref:'R0',relation:'dimension',quote:'品牌甲',reason:'该字段提供身份信息'}],knowledgeNote:'知识候选'}))},{checks:[{key:'brand',ref:'R0',verdict:'supported',reason:'品牌标识'},{key:'model',ref:'R0',verdict:'unsupported',reason:'品牌不是型号'}]},schema(fields),missing,schema([...fields,added]),final];
 const meter=new Meter(dir,1,async req=>{requests.push(structuredClone(req));return{id:'mock',object:'chat.completion',created:0,model:'mock',choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(replies.shift())}}],usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130}};});
 try{
  const r=await governSemantic({id:'a',name:'接头',pathIds:['a'],pathNames:['接头'],parentId:null,categoryId:null,isLeaf:true,enabled:true},'branch',[{id:'E',kind:'jd',title:'产品资料',url:'https://example.com',retrievedAt:'2026',scope:'样例',fields:[['E.0','品牌','品牌甲']]},{id:'F',kind:'web',title:'WRONG_MACHINE_ONLY',url:'https://example.com/other',retrievedAt:'2026',scope:'关联整机',fields:[['F.0','风量','100']]}],meter,'mock',dir);
  expect(r.error).toBeUndefined();expect(r.attributes).toHaveLength(3);expect(r.status).toBe('needs_review');expect(r.review!.issues.some(i=>i.key==='diameter')).toBeTrue();expect(requests).toHaveLength(9);
  expect(JSON.stringify(requests[0])).not.toContain('PRODUCER_PRIVATE');
  expect(JSON.stringify(requests[2])).not.toContain('WRONG_MACHINE_ONLY');
  expect(JSON.stringify(requests[6])).not.toContain('PRODUCER_PRIVATE');expect(requests[6]!.messages.some(m=>m.role==='assistant')).toBeFalse();
  expect(requests.every(r=>r.thinking?.type==='disabled')).toBeTrue();
  expect(requests[5]!.messages.slice(0,requests[3]!.messages.length)).toEqual(requests[3]!.messages);
  expect(JSON.stringify(requests[7]!.messages.at(-1))).toContain('missing');
  expect(r.attributes.find(a=>a[0]==='model')![9]).toEqual(['K']);
 }finally{await rm(dir,{recursive:true});}
});

test('修订输入只省略通过项，缺失需求、问题定位和不确定性无损保留',()=>{
 const attrs:Attribute[]=[['brand','品牌','text','required','',[],'','产品品牌','',['K']],['model','型号','text','conditional','',[],'制造商分配型号时','产品型号','',['K']]];
 const feedback=repairFeedback(parseSemanticAudit(missing,attrs,needs),needs);
 expect(feedback.rows).toEqual([]);expect(feedback.coverage[0]!.requirement).toEqual(needs.needs[0]!);expect(feedback.coverage[0]!.verdict).toBe('missing');
});

test('资料范围判断不允许漏判或伪造目标，关联整机保留related而非target',()=>{
 const scope=parseSourceScope({documents:[{id:'D0',relation:'related',reason:'资料讨论整机而非目标部件'}]},['D0']);
 expect(scope.documents.filter(d=>d.relation==='target')).toHaveLength(0);
 expect(()=>parseSourceScope({documents:[]},['D0'])).toThrow('覆盖');
});
