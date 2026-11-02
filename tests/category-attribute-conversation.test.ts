import {test,expect} from 'bun:test';
import {ProducerConversation} from '../src/scenarios/category_attributes_governance/conversation.ts';
import {refine} from '../src/scenarios/category_attributes_governance/refinement.ts';
import {Meter} from '../src/scenarios/category_attributes_governance/meter.ts';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import type {OpenAiChatRequest} from '../src/ai/types.ts';
test('连续前缀包含逐字响应，调用方修改不能污染历史',()=>{
 const c=new ProducerConversation('system',{evidence:'fixed'}),m=c.request('plan',{});const raw='{ "k": "a" }';c.commit(m,raw);
 m[0]!.content='mutated';const next=c.request('schema',{});expect(next[0]!.content).toBe('system');expect(next[3]!.content).toBe(raw);expect(next).toHaveLength(5);
});
test('生成共享历史和一次证据，独立审阅看不到生成对话',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'category-conversation-'));const reqs:OpenAiChatRequest[]=[];
 const p={boundary:'GENERATOR_ONLY_MARKER',identity:{ownBrand:'brand',ownModel:'model',omissionReason:''},dimensions:[{key:'brand',name:'品牌',purpose:'身份',importance:'core'},{key:'model',name:'型号',purpose:'订货',importance:'core'}],knowledgeGaps:[]};
 const planRaw=JSON.stringify(p);const replies=[planRaw,JSON.stringify({items:p.dimensions.map(d=>({key:d.key,links:[],knowledgeNote:'知识候选'}))}),JSON.stringify({upsert:[{k:'brand',n:'品牌',t:'text',r:'required',d:'产品品牌',e:['K']},{k:'model',n:'型号',t:'text',r:'conditional',c:'制造商分配型号时',d:'产品型号',e:['K']}],remove:[],done:true,gaps:[]}),JSON.stringify({checkedKeys:['brand','model'],issues:[],knowledgeGaps:[]})];
 const meter=new Meter(dir,1,async r=>{reqs.push(structuredClone(r));return{id:'mock',object:'chat.completion',created:0,model:'mock',choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:replies.shift()!}}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}};});
 try{
  const result=await refine({id:'c',name:'配件',pathIds:['c'],pathNames:['配件'],parentId:null,categoryId:null,isLeaf:true,enabled:true},'TREE',[{id:'E',kind:'jd',title:'FIXED_EVIDENCE',url:'https://item.jd.com/1.html',retrievedAt:'2026',scope:'测试',fields:[]}],meter,'mock',dir,'conversation');
  expect(result.status).toBe('accepted');expect(reqs).toHaveLength(4);
  expect(reqs[1]!.messages.slice(0,reqs[0]!.messages.length)).toEqual(reqs[0]!.messages);expect(reqs[1]!.messages[3]!.content).toBe(planRaw);
  expect(reqs[2]!.messages.slice(0,reqs[1]!.messages.length)).toEqual(reqs[1]!.messages);
  expect(reqs[2]!.messages.filter(m=>m.role==='user'&&m.content?.includes('FIXED_EVIDENCE'))).toHaveLength(1);
  expect(reqs[3]!.messages.some(m=>m.role==='assistant')).toBeFalse();expect(reqs[3]!.messages).toHaveLength(3);
  expect(reqs.every(r=>r.thinking?.type==='disabled')).toBeTrue();
 }finally{await rm(dir,{recursive:true});}
});
