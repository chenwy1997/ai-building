import {join} from 'node:path';
import {read,save,digest} from '../runtime/storage.ts';
import {ROOT} from '../expansion/settings.ts';
const RUN=join(ROOT,'outputs/product-governance/clean-paper-21-revision-20261019');
const s:any=await read(join(RUN,'design/standard.json'));
const a:any=await read(join(RUN,'design/adjudication.json'));
const inputHash=digest(s);
if(inputHash!==a.finalCandidateHash)throw Error('Candidate changed after review dispatch');
const resolutions:Record<string,string[]>={
 deepseek:[
 '拒绝｜binding已有measurement_group，执行器测试证实原称一路完成不要求几何也filled；required旗标不是独立义务。',
 '拒绝（上下文纠正）｜完整标准的生活用纸已含计数/净重组及三元绑定；针对性提示只节选修改字段，不能把未展示绑定判为不存在。核对实际标准有效，不新增重复组。',
 '采纳说明｜三元同SKU同版本及原单位一致性适用于所有paper.quantity，不限OR组；把既有定义约束同步写入全局必填契约，预检核unit/per配对。'],
 glm:[
 '部分采纳｜执行器只读canonical，不执行legacyApplicabilityRule。为避免其他调用误用，将旧条件移到独立迁移审计记录；卷式长度仍不受分节约束。',
 '拒绝（上下文纠正）｜paper.inner_mass在完整89定义中实际存在；补丁提示只节选相关定义造成误判。结构校验已证明组路径引用存在。',
 '拒绝（上下文纠正）｜roll.dispense实际定义及绑定存在；补丁提示遗漏显示不是标准缺失。本轮保留互斥类目投影并检查无双绑定。'],
 kimi:[
 '拒绝（上下文纠正）｜完整标准确有paper.inner_mass，路径引用校验通过；针对性输入节选遗漏该定义。不可按提示省略认定标准缺项，更不可删除有效净重路径。',
 '拒绝｜无来源计数导致必填缺失是允许的业务状态，并非执行器不能运行；可交付已核实字段但不报完整。本轮无真实按重餐巾样本证明需替换核心，不凭假设降必填，后续真实样本可提出标准变更。',
 '拒绝｜包装词本身不证明层级，既有定义已要求确认最内实际包含层；多包/多卷集合提不得填为内单位。也不能仅按“提”字断言所有实际包装结构，异常原称保留证据复核。'],
 qwen:[
 '部分采纳｜只有active计数值须三元有效，未选路径缺值不阻断另一有效路线；不把仅因另一条完成而未知的路径改不适用。',
 '已有机制｜OR组两路都缺为核心未完整；其中一路有效即可。两路同时有可信值也合法，不按建议变成互斥填充。',
 '采纳说明｜显式单卷长度可直接提取；整销售SKU总长除同规格卷数须同SKU证据及算式，无卷数不能估。已有规则支持，补清多卷包装例义。'],
};
const targeted:any[]=[];
for(const model of ['deepseek','kimi','glm','qwen']){
 const r:any=await read(join(RUN,'normalized/final-changes-review-'+model+'.json'));
 if(r.content.standardHash!==inputHash)throw Error('Wrong targeted review hash '+model);
 const reasons=resolutions[model];if(!reasons||reasons.length!==r.content.issues.length)throw Error('Missing targeted adjudication '+model+' '+r.content.issues.length);
 r.content.issues.forEach((issue:any,i:number)=>{const [action,...reason]=reasons[i]!.split('｜');targeted.push({...issue,id:model+'-targeted-'+(i+1),model,action,reason:reason.join('｜'),inputHash:r.requestHash,standardHash:inputHash,record:r.sourceRecord,syntaxRecovery:r.syntaxRecovery});});
}
const edits:any[]=[];
const append=(id:string,text:string,reason:string)=>{const d=s.definitions.find((x:any)=>x.id===id),before=d.rule;d.rule+=' '+text;edits.push({target:id,before,after:d.rule,reason});};
append('paper.quantity','张须指独立成品张；按层累计的张数或成品/层累计口径不明时不可作为成品数，不能用层数乘除猜换算。数量、原计数单位、最内包装单位须同SKU同版本成组取证；固定旧字段名不能代替单位或包装层级证据。','终审自查恢复裁定合并时被截断的层累计防护文字，元数据和迁移要求原已保留。');
append('roll.length','多卷装可取明确单卷长度，或同SKU同规格销售总长÷明确卷数，保留总长与卷数各自证据及算式；包装为提/包不证明卷数。缺卷数时不得估算。','Qwen针对性复核要求明确多卷装计算出口；不改变既有同口径计算要求。');
s.requirednessContract.countTriple='凡填写paper.quantity，必须同时核验paper.count_unit与paper.inner_unit及数量unit/per，一致、同SKU同版本同口径才是有效成品计数；未选路径无active值不触发填值校验，不适用必须另有反证。';
const legacyConditions:any[]=[];
for(const b of s.bindings){if(b.legacyApplicabilityRule){legacyConditions.push({categoryId:b.categoryId,attributeId:b.attributeId,legacyRule:b.legacyApplicabilityRule,canonical:b.applicabilityCondition});delete b.legacyApplicabilityRule;}}
if(legacyConditions.length)edits.push({target:'旧条件归档',before:'legacyApplicabilityRule保留在绑定',after:'移至独立design/legacy-condition-audit.json',reason:'避免外部工具误读；本执行器从未执行旧条件。'});
await save(join(RUN,'design/legacy-condition-audit.json'),{reviewedCandidateHash:inputHash,executable:false,records:legacyConditions});
s.reviewState={status:'codex_adjudicated_operations_pending',rootAdjudicated:true,independentModelsReviewed:['deepseek','kimi','glm','qwen'],initialDraftHash:a.reviewedDraftHash,targetedCandidateHash:inputHash,operationsReview:'not_reviewed',productRegression:'not_executed',productionWrite:false,contextLimitations:'针对性复核节选字段曾造成4条缺定义/缺绑定误判，Codex按完整标准和引用校验纠正。'};
s.rootRevisionsApplied={...s.rootRevisionsApplied,finalReviewStatus:'Codex已裁定，待运营确认'};
for(const d of s.definitions){if(typeof d.origin==='string')d.origin=d.origin.replace('尚待外部模型评审及运营审核','历史来源记录；本修订已四模型评审及Codex裁定，待运营审核').replace('待最终变化独立复核','最终变化已独立复核并由Codex裁定');}
a.targetedReviewStatus='four_models_reviewed_codex_adjudicated';a.targetedCandidateHash=inputHash;a.targetedReviewLimitations=s.reviewState.contextLimitations;a.decisions.push(...targeted);a.appliedChanges.push(...edits);a.finalCandidateHash=digest(s);a.productRegressionStatus='not_executed';
await save(join(RUN,'design/standard.json'),s);await save(join(RUN,'design/adjudication.json'),a);
const contract:any=await read(join(RUN,'design/condition-contract.json'));contract.registeredFactNames=s.conditionFactDefinitions.map((f:any)=>f.fact);contract.standardHash=digest(s);await save(join(RUN,'design/condition-contract.json'),contract);
console.log({issues:a.decisions.length,initial:71,targeted:targeted.length,finalHash:digest(s)});
