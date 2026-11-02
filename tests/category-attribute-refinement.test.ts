import {test,expect} from 'bun:test';
import {parseGroundedPlan,preciseSchema,preciseGrounding} from '../src/scenarios/category_attributes_governance/refinement.ts';
const p={boundary:'商品',identity:{ownBrand:'brand',ownModel:'model',omissionReason:''},dimensions:[{key:'brand',name:'品牌',purpose:'识别',importance:'core'},{key:'model',name:'型号',purpose:'订货',importance:'core'},{key:'contents',name:'附件清单',purpose:'确定交付内容',importance:'supplementary'}],knowledgeGaps:[]};
const plan=parseGroundedPlan(p);
const raw={upsert:[{k:'brand',n:'品牌',t:'text',r:'required',d:'自身品牌',e:['K']},{k:'model',n:'型号',t:'text',r:'conditional',c:'制造商分配了型号时',d:'自身型号',e:['K']},{k:'contents',n:'附件清单',t:'multi',r:'optional',d:'实际附带的附件',e:['K']}],remove:[],done:true,gaps:[]};
const allowed={brand:['K'],model:['K'],contents:['K']};
test('开放列表错误精确定位但不偷偷修改类型或补枚举',()=>{
 expect(()=>preciseSchema(raw,plan,allowed,{})).toThrow('contents.t=multi');expect(raw.upsert[2]!.t).toBe('multi');
 const fixed=structuredClone(raw);fixed.upsert[2]!.t='text';expect(preciseSchema(fixed,plan,allowed,{})[2]![5]).toEqual([]);
});
test('空知识说明仅补未核验元数据，不把不匹配引用变成外证',()=>{
 const g=preciseGrounding({items:p.dimensions.map(d=>({key:d.key,links:d.key==='brand'?[{ref:'R0',relation:'dimension',quote:'伪造',reason:'品牌'}]:[],knowledgeNote:''}))},plan,[{fields:[['R0','品牌','甲']]}]);
 expect(g.rejectedLinks).toHaveLength(1);expect(g.items.every(i=>i.links.length===0)).toBeTrue();expect(g.items.every(i=>i.knowledgeNote.includes('待核验'))).toBeTrue();
 expect(()=>preciseGrounding({items:[]},plan,[])).toThrow('缺少计划key');
});
test('标准件身份不能因模型称不重要而省略',()=>{
 expect(()=>parseGroundedPlan({...p,identity:{ownBrand:null,ownModel:null,omissionReason:'通用标准件'}})).toThrow('标准件也保留自身品牌');
});
test('传输类型标识与业务字段分离，原始响应不改写',()=>{
 const fixed=structuredClone(raw);fixed.upsert[2]!.t='text';const envelope={...fixed,type:'json_object'};
 expect(preciseSchema(envelope,plan,allowed,{})).toHaveLength(3);expect(envelope.type).toBe('json_object');
 expect(()=>preciseSchema({...fixed,type:'unexpected'},plan,allowed,{})).toThrow('未知字段');
});

test('专家参考必须绑定原始字段哈希，保留类目并且不修改模型原文',async()=>{
 const {applyExpertReview}=await import('../src/scenarios/category_attributes_governance/apply-review-entry.ts');
 const {hash}=await import('../src/scenarios/category_attributes_governance/storage.ts');
 const a=preciseSchema({...raw,upsert:raw.upsert.map(x=>x.k==='contents'?{...x,t:'text'}:x)},plan,allowed,{});
 const original=[{category:{id:'c',name:'测试类目',parentId:null,enabled:true,isLeaf:true,pathIds:['c'],pathNames:['测试类目'],categoryId:null},attributes:a,evidence:[],status:'needs_review' as const,gaps:[],rounds:0,fingerprint:'original'}];
 const review={version:'test',sourceRun:'run-test',sourceSha256:'',scope:'测试',sources:[],decisions:[{categoryId:'c',name:'测试类目',note:'独立审阅',changes:[{key:'contents',before:hash(a[2]),set:{description:'按实际随附条目填写'},reason:'明确实际交付对象'}]}]};
 const result=applyExpertReview(original,review);expect(result[0]!.category).toEqual(original[0]!.category);expect(original[0]!.attributes[2]![7]).toBe('实际附带的附件');expect(result[0]!.attributes[2]![7]).toBe('按实际随附条目填写');
 review.decisions[0]!.changes[0]!.before='stale';expect(()=>applyExpertReview(original,review)).toThrow('原文已变化');
});

test('审阅语法错误只重做审阅结果，不复制造成截断的取证输入',async()=>{
 const {refine}=await import('../src/scenarios/category_attributes_governance/refinement.ts');
 const {Meter}=await import('../src/scenarios/category_attributes_governance/meter.ts');
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=await mkdtemp(join(tmpdir(),'attribute-refine-'));
 const fixed={...raw,upsert:raw.upsert.map(x=>x.k==='contents'?{...x,t:'text'}:x)};
 const replies=[JSON.stringify(p),JSON.stringify({items:p.dimensions.map(d=>({key:d.key,links:[],knowledgeNote:'仅行业知识'}))}),JSON.stringify(fixed),'{"checkedKeys": [',JSON.stringify({checkedKeys:p.dimensions.map(d=>d.key),issues:[],knowledgeGaps:[]})];
 const requests:import('../src/ai/types.ts').OpenAiChatRequest[]=[];
 const meter=new Meter(dir,0.5,async request=>{requests.push(structuredClone(request));return{id:'mock',object:'chat.completion',created:0,model:'mock',choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:replies.shift()!}}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}};});
 try{
  const result=await refine({id:'c',name:'商品',parentId:null,enabled:true,isLeaf:true,pathIds:['c'],pathNames:['商品'],categoryId:null},'BRANCH',[{id:'J',kind:'jd',title:'PRIVATE_EVIDENCE_MARKER',url:'https://item.jd.com/1.html',retrievedAt:'2026',fields:[],scope:'测试'}],meter,'mock',dir);
  expect(result.status).toBe('accepted');expect(requests).toHaveLength(5);
  expect(JSON.stringify(requests[3])).toContain('PRIVATE_EVIDENCE_MARKER');expect(JSON.stringify(requests[4])).not.toContain('PRIVATE_EVIDENCE_MARKER');
  expect(requests.every(r=>r.thinking?.type==='disabled')).toBeTrue();expect(JSON.stringify(requests[0]!.messages.slice(0,2))).not.toContain('PRIVATE_EVIDENCE_MARKER');
 }finally{await rm(dir,{recursive:true});}
});
