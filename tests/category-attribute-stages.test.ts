import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parsePlan,parseSchema,parseAudit,staged,shortEvidence,restoreReferences} from '../src/scenarios/category_attributes_governance/staged.ts';
import {Meter} from '../src/scenarios/category_attributes_governance/meter.ts';
import {parseGrounding,evidenceAllowlist,checkAttributeReferences} from '../src/scenarios/category_attributes_governance/grounding.ts';
import {parseResolution,unresolved} from '../src/scenarios/category_attributes_governance/review-resolution.ts';
import {validateIdentityPolicy} from '../src/scenarios/category_attributes_governance/requirement-policy.ts';
import type {OpenAiChatRequest} from '../src/ai/types.ts';
const plan={boundary:'配件',identity:{ownBrand:'brand',ownModel:null,omissionReason:'此测试不定义型号'},dimensions:[{key:'brand',name:'品牌',purpose:'识别制造商标示',importance:'core'}],knowledgeGaps:[]};
const schema={upsert:[{k:'brand',n:'品牌',t:'text',r:'required',d:'商品标示品牌',e:['K']}],remove:[],done:true,gaps:[]};
test('业务必填策略与裁决边界：不确定不能放行，真实问题不能被去重丢失',()=>{
 const p=parsePlan(plan),attrs=parseSchema(schema,p,new Set());attrs[0]![3]='optional';expect(()=>validateIdentityPolicy(attrs,p)).toThrow('required');
 const audit={checkedKeys:['brand'],issues:[{key:'brand',field:'description' as const,quote:'品牌',reason:'偏好意见'},{key:'brand',field:'description' as const,quote:'品牌',reason:'待判断意见'}],knowledgeGaps:[]};
 const resolution=parseResolution({decisions:[{issue:0,verdict:'dismissed',reason:'现有定义已满足'},{issue:1,verdict:'uncertain',reason:'不能确定'}]},audit);
 expect(unresolved(audit,resolution)).toHaveLength(1);expect(unresolved(audit,resolution)[0]!.reason).toContain('待判断意见');
 expect(()=>parseResolution({decisions:[{issue:0,verdict:'dismissed',reason:'不能漏项'}]},audit)).toThrow('覆盖');
});
test('自身身份不能静默省略；类比和不相关证据不能进入属性引用',()=>{
 const camel={...plan,dimensions:[{...plan.dimensions[0],key:'ownBrand'}],identity:{...plan.identity,ownBrand:'ownBrand'}};
 expect(parsePlan(camel).identity.ownBrand).toBe('own_brand');expect(camel.identity.ownBrand).toBe('ownBrand');
 expect(()=>parsePlan({...camel,dimensions:[...camel.dimensions,{...camel.dimensions[0],key:'own_brand'}]})).toThrow('维度');
 expect(()=>parsePlan({...plan,identity:{ownBrand:null,ownModel:null,omissionReason:''}})).toThrow('解释');
 const g=parseGrounding({items:[{key:'brand',links:[{ref:'R0',relation:'analogy',quote:'甲',reason:'这是另一个对象的品牌'}],knowledgeNote:'本对象品牌未证实'}]},parsePlan(plan),[{fields:[['R0','品牌','甲']]}]);
 const allowed=evidenceAllowlist(g);expect(allowed.brand).toEqual(['K']);
 expect(()=>checkAttributeReferences({...schema,upsert:[{...schema.upsert[0],e:['R0']}]},allowed)).toThrow('白名单');
 const rejected=parseGrounding({items:[{key:'brand',links:[{ref:'R0',relation:'dimension',quote:'乙',reason:'伪造原文'}],knowledgeNote:''}]},parsePlan(plan),[{fields:[['R0','品牌','甲']]}]);expect(rejected.rejectedLinks).toHaveLength(1);expect(evidenceAllowlist(rejected).brand).toEqual(['K']);
});
test('短引用确定性映射回原始字段，不猜测修复错误ID',()=>{
 const compact=shortEvidence([{id:'Jabc',kind:'jd',title:'样本',url:'https://item.jd.com/1.html',retrievedAt:'2026',scope:'样本',fields:[['Jabc.0','品牌','甲']]}]);
 const s={...schema,upsert:[{...schema.upsert[0],e:['R0']}]};
 const restored=restoreReferences(s,compact.referenceMap) as typeof schema;
 expect(restored.upsert[0]!.e).toEqual(['Jabc.0']);expect(s.upsert[0]!.e).toEqual(['R0']);
 expect(()=>restoreReferences({...s,upsert:[{...s.upsert[0],e:['Jabc']}]},compact.referenceMap)).toThrow('非法引用');
});
test('阶段之间不可静默丢维度，审阅不能引用不存在的原文',()=>{
 const p=parsePlan(plan),attrs=parseSchema(schema,p,new Set());
 expect(()=>parseSchema({...schema,upsert:[]},p,new Set())).toThrow('覆盖');
 expect(()=>parseAudit({checkedKeys:['brand'],issues:[{key:'brand',field:'description',quote:'不存在的规则',reason:'误判'}],knowledgeGaps:[]},attrs)).toThrow('原文');
 expect(()=>parseAudit({checkedKeys:[],issues:[],knowledgeGaps:[]},attrs)).toThrow('覆盖');
 expect(parseAudit({checkedKeys:['brand'],issues:[],knowledgeGaps:[]},attrs).issues).toHaveLength(0);
 expect(parseAudit({checkedKeys:['brand'],issues:[{key:'brand',field:'unit',quote:'',reason:'仅测试空字段定位'}],knowledgeGaps:[]},attrs).issues).toHaveLength(1);
 expect(()=>parseAudit({checkedKeys:['brand'],issues:[{key:'brand',field:'description',quote:'',reason:'非空列不能空引用'}],knowledgeGaps:[]},attrs)).toThrow('原文');
});
test('四阶段隔离：规划无SKU，关系评估独立，非直接证据不可引用',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'attribute-stages-')),history:OpenAiChatRequest[]=[];
 const replies=[plan,{items:[{key:'brand',links:[],knowledgeNote:'测试无品牌证据'}]},schema,{requirements:[{key:'brand',r:'required',c:'',reason:'自身身份核心'}]},{checkedKeys:['brand'],issues:[],knowledgeGaps:[]}];
 const meter=new Meter(dir,0.5,async r=>{history.push(r);return{id:'mock',object:'chat.completion',created:0,model:'mock',choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(replies.shift())}}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}};});await meter.init();
 const result=await staged({id:'c',name:'配件',parentId:null,pathIds:['c'],pathNames:['配件'],enabled:true,isLeaf:true,categoryId:null},'CAT',[{id:'E',kind:'jd',title:'SECRET_SKU_MARKER',url:'https://item.jd.com/1.html',retrievedAt:'2026',scope:'样本',fields:[]}],meter,'mock');
 expect(result.status).toBe('accepted');expect(history).toHaveLength(5);
 expect(JSON.stringify(history[0])).not.toContain('SECRET_SKU_MARKER');expect(JSON.stringify(history[1])).toContain('SECRET_SKU_MARKER');expect(JSON.stringify(history[4])).not.toContain('SECRET_SKU_MARKER');
 expect(history.every(r=>r.thinking?.type==='disabled')).toBeTrue();expect(history[0]!.messages.slice(0,2)).toEqual(history[4]!.messages.slice(0,2));
 await rm(dir,{recursive:true});
});
