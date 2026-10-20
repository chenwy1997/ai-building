import {join} from 'node:path';
import {read,save,digest} from '../runtime/storage.ts';
import {ROOT} from '../expansion/settings.ts';

const SOURCE=join(ROOT,'outputs/product-governance/clean-paper-five-20261019');
const RUN=join(ROOT,'outputs/product-governance/clean-paper-21-revision-20261019');
const source:any=await read(join(SOURCE,'design/standard.json'));
const trial:any=await read(join(SOURCE,'analysis/final.json'));
const s:any=structuredClone(source);
const edits:any[]=[];
const def=(id:string):any=>{const d=s.definitions.find((d:any)=>d.id===id);if(!d)throw new Error('Unknown definition '+id);return d;};
const cat=(name:string):any=>{const c=s.categories.find((c:any)=>c.name===name);if(!c)throw new Error('Unknown category '+name);return c;};
const bind=(name:string,id:string):any=>s.bindings.find((b:any)=>b.categoryId===cat(name).id&&b.attributeId===id);
const change=(id:string,reason:string,fn:(d:any)=>void)=>{const d=def(id),before=structuredClone(d);fn(d);d.version=(before.version??1)+1;d.origin=before.origin+'；clean-paper-21-revision-20261019修订草稿，待四模型及root审核';edits.push({kind:'definition_revision',attributeId:id,reason,before,after:structuredClone(d)});};
const addDefinition=(d:any)=>{if(s.definitions.some((x:any)=>x.id===d.id))throw new Error('Duplicate definition '+d.id);s.definitions.push({enum:[],selection:'',formula:'',version:1,origin:'clean-paper-21-revision-20261019；基于250件实证的新展示/原称属性草稿，未发布',...d});edits.push({kind:'definition_added',attributeId:d.id,reason:d.rule,after:d});};
const addBinding=(name:string,id:string,required:boolean,rationale:string)=>{if(bind(name,id))return;const b={categoryId:cat(name).id,attributeId:id,required,level:'SKU',applicability:'当前SKU已按原V2用途与形态边界确认属于本类；仅填写当前SKU明确证据。',rationale};s.bindings.push(b);edits.push({kind:'binding_added',categoryId:b.categoryId,categoryName:name,attributeId:id,after:b});};
const predicate=(r:any):any=>r?.fact?{fact:r.fact,equals:r.equals??true}:r?.all?{all:r.all.map(predicate)}:r?.any?{any:r.any.map(predicate)}:undefined;
const fact=(name:string,equals=true)=>({fact:name,equals});
const all=(...values:any[])=>({all:values});

s.releaseId='clean-paper-21-v2-draft-20261019';
s.status='可审核修订草稿；未冻结、未发布、未获运营审核';
s.baseRelease={releaseId:source.releaseId,standardHash:digest(source),path:'outputs/product-governance/clean-paper-five-20261019/design/standard.json'};
s.reviewState={rootAdjudicated:false,independentModelsPlanned:['deepseek','kimi','glm','qwen'],independentModelsReviewed:[],operationsReview:'not_reviewed',productionWrite:false};

for(const id of ['face.form','kitchen.form'])change(id,'组织结构与取出动作拆分；卷式与抽取动作可以同时成立。',d=>{
 d.name=id==='face.form'?'巾体组织形态':'厨房纸组织形态';
 d.definition='纸/巾本体是否成卷，或由独立成张的成品平叠组织；这是物理组织结构，不是取出动作或包装形式。';
 d.enum=['卷式','平叠单张式'];d.aliases=[{from:'平叠式',to:'平叠单张式',condition:'同SKU明确为独立单张平叠结构；不能仅凭抽取动作或软袋/盒形映射'}];
 d.rule='卷式须有当前本体卷状结构、卷筒式说明或明确每卷成品结构证据；平叠单张式须明确独立成张且平叠的本体结构。抽取式只描述动作，不能填为平叠单张式或反证卷式；袋装、桶装、硬盒和卷数本身不代替本体结构。动作另存paper.dispense；分节事实单独判断。';
 d.migration={retainedId:true,oldValues:{'卷式':'有同SKU卷式结构证据可保留','平叠式':'核对同SKU独立单张平叠结构后迁移','抽取式':'仅可迁入paper.dispense的抽取式（路径未注明）；组织形态仍待证'},preserveOriginalValue:true,noBlindCopy:true};
});
change('paper.dispense','复用共享取纸定义承接洗脸巾；宽泛抽取动作不强行识别中心或外圈。',d=>{
 d.enum=[...d.enum,'抽取式（路径未注明）'];
 d.definition='纸/巾取出动作及已明确的取出路径；仅用于取出方式，不表示是否成卷。';
 d.rule+=' 原文仅抽取式、抽式且没有明确路径时，可记录抽取式（路径未注明），不可补成中心抽取或逐张独立平叠；已明确中心/外圈路径时取具体值。滚筒抽取式拆为组织卷式与抽取动作，两个字段分别引用原文。';
 d.aliases=[{from:'抽取式',to:'抽取式（路径未注明）',condition:'当前SKU明确抽取动作且未明确中心/外圈路径；不推断组织形态'}];
});
addBinding('洗脸巾','paper.dispense',true,'修复原face.form混维度后的取出动作维度；组织形态与动作分别留证，新增必填建议须四模型与root业务审核，不因样本填充率作调整。');

addDefinition({id:'paper.nominal_mass',name:'标称质量（展示用）',kind:'类目特性属性',type:'数值',unit:'按原证据质量单位',semantic:'nominal_mass_display',operator:'positive_declared_mass_with_scope',definition:'当前干纸/干巾SKU厂家或销售资料明确标示的质量原数值；不预设是否含芯、包装或属于单卷/整提。',rule:'value必须为有限正数，unit必须在原句明确，保留原数值与原单位。weightScope为per_roll、per_piece、per_inner_pack、sales_unit或unspecified；前三者须明确对应对象及per单位，销售总量不能当单卷。无法确认范围时用unspecified保留原数值展示，不补per，不声称是单卷/单包重量。重量口径另见paper.mass_basis，未知口径留needs_evidence。标称质量不得复制到净纸重、不得进入采购OR路径、不得豁免任何核心必填。',measurement:{kind:'nominal_mass',displayOnly:true,valueType:'finite_positive_number',unitFrom:'claim.unit',perFrom:'claim.per',weightScopeFrom:'claim.weightScope',allowedUnits:['g','克','kg','千克','公斤','斤','市斤'],weightScopeEnum:['per_roll','per_piece','per_inner_pack','sales_unit','unspecified'],perUnitsByScope:{per_roll:['卷'],per_piece:['张','片','节','段','条','件'],per_inner_pack:['包','袋','盒','筒','桶','提','箱'],sales_unit:['包','袋','盒','卷','筒','桶','提','箱','件','套'],unspecified:[]},basisField:'paper.mass_basis',evidenceRequired:true,sourceScopeEvidenceRequired:true,unspecifiedScopePolicy:'允许按原值展示，per须为空；不能形成单卷/内包装采购量或净纸重。',conversionPolicy:'默认不换单位；若确需转换须保留原值原单位、明确等值关系及算式，不能附加源中没有的覆盖范围。'}});
addDefinition({id:'paper.mass_basis',name:'标称质量口径',kind:'类目特性属性',type:'选项',unit:'',selection:'单选',operator:'explicit_mass_composition_basis',enum:['本体净质量（不含芯及包装）','含芯净质量（不含包装）','含包装质量（毛重）'],definition:'与paper.nominal_mass同一质量声明中明确包含或排除的组成口径，不根据字段名称或纸型默认。',rule:'须分别核对本体/纸芯/包装的明确纳入或排除口径。只写100g、重量或净重、但芯/包装范围未明时留needs_evidence，不填默认净纸重，也不设置已确认的未知选项。厂商其他明确口径保留枚举候选和原文；不把面积定量g/㎡当质量。该字段仅解释同一标称质量，不代替严格净纸重字段。',measurement:{nominalField:'paper.nominal_mass',sameDeclarationRequired:true,evidenceRequired:true,unknownStatus:'needs_evidence',noDefaultFromCategory:true}});
const massClasses=['软包抽纸','盒装抽纸','有芯小卷纸','中心抽大卷纸','抽式擦手纸','手帕纸','无芯小卷纸','洗脸巾','餐巾纸','厨房纸巾','大卷纸','大卷擦手纸','生活用纸','平板卫生纸'];
for(const name of massClasses)for(const id of ['paper.nominal_mass','paper.mass_basis'])addBinding(name,id,false,'展示明确标称质量及其组成口径；无声明可缺，不进入计量OR，不降低净纸重/长度等原有业务必填。');
addDefinition({id:'hand.fold_original',name:'厂商折法原称',kind:'类目特性属性',type:'文本',unit:'',operator:'exact_fold_designation',definition:'当前SKU厂家/销售原文对擦手纸折法的直接称谓，如三折；与几何折型分类分开。',rule:'保留原文折法，不把三折自动变为Z折、N折或三次折叠/三张纸；三折未明确指面数、折线或厂商行业名称时不拆数值。此原称不自动满足hand.fold几何分类，也不降低其原有必填；是否应将采购原称纳入必填组留待业务审核。'});
addBinding('抽式擦手纸','hand.fold_original',false,'承接四个SKU明示三折原称并保留未知几何含义，避免把不同维度直接塞进单选几何折型枚举。');

const ordinaryCandidates=trial.fieldRecords.filter((r:any)=>r.status==='enum_candidate'&&r.missingReason==='枚举待扩充');
const modelingCandidates=trial.fieldRecords.filter((r:any)=>r.status==='enum_candidate'&&r.missingReason==='属性定义口径待完善');
const scentValues=[...new Set(ordinaryCandidates.filter((r:any)=>r.attributeId==='common.scent').map((r:any)=>r.value))] as string[];
change('common.scent','只补已逐件审证的厂家明确香型原称，不把系列名或近似香型当别名。',d=>{d.enum=[...new Set([...d.enum,...scentValues])];d.rule+=' 本轮新增具体原称保持原义，淡茶香/清新茶香不自动并茶香，乌龙香味不自动并绿茶香，甜心桃味不自动并果香；不同气味或强度名不建无证据等价别名。';});
change('paper.count_unit','PCS是当前SKU原始英文计数单位，不能凭常识指定为张或片。',d=>{d.enum=[...d.enum,'PCS'];d.rule+=' PCS仅保留来源英文实物计数原单位，不自动对应张/片/抽/件，不代表层数。pcs/Pcs仅允许大小写字形归一，须保留originalUnit原文。';d.aliases=[{from:'pcs',to:'PCS',condition:'仅ASCII大小写归一，保留originalUnit；不改变数量/实物单位含义'},{from:'Pcs',to:'PCS',condition:'仅ASCII大小写归一，保留originalUnit；不映射中文单位'}];});
bind('洗脸巾','paper.count_unit').allowedValues.push('PCS');

const rollFact=s.conditionFactDefinitions.find((f:any)=>f.fact==='isRollFormat');
const beforeRollFact=structuredClone(rollFact);
rollFact.trueEvidence='当前SKU明确卷式/卷筒本体，或已核实物连续卷状结构；抽取动作可同时存在';
rollFact.falseEvidence='明确为非卷式的独立成张平叠本体，或可核实物确认独立单张组织且非卷状';
rollFact.notEvidence='抽取式/抽式、袋/盒/筒包装和没有形态说明均不能单独证明非卷或卷式；中心抽也不证明有纸芯';
edits.push({kind:'condition_fact_revision',fact:'isRollFormat',reason:'F29/F43证明卷式结构和抽取动作可同时成立。',before:beforeRollFact,after:structuredClone(rollFact)});

for(const b of s.bindings){
 const before=structuredClone(b);
 if(b.applicabilityRule){
  if(b.applicabilityRule.false==='optional'){
   b.legacyApplicabilityRule=structuredClone(b.applicabilityRule);delete b.applicabilityRule;
   b.applicability+=' 原旧规则false=optional只是未选采购路径，不是不适用；由成组计量评估控制完整性。';
  }else b.applicabilityCondition=predicate(b.applicabilityRule);
 }
 if(b.requiredWhen){b.requiredWhenMetadata=structuredClone(b.requiredWhen);b.requiredWhen=predicate(b.requiredWhen);}
 if(digest(before)!==digest(b))edits.push({kind:'binding_condition_revision',categoryId:b.categoryId,attributeId:b.attributeId,before,after:structuredClone(b)});
}
for(const g of s.requirementGroups){
 const before=structuredClone(g);
 if(g.applicabilityRule)g.applicabilityCondition=predicate(g.applicabilityRule);
 g.paths=g.atLeastOne.map((attributes:string[],i:number)=>{
  const count=attributes.includes('paper.quantity'),mass=attributes.includes('paper.inner_mass'),length=attributes.includes('roll.length');
  const c=count?fact('hasCountBasedSelling'):mass?fact('hasMassBasedSelling'):length?all(fact('isRollFormat'),fact('hasExplicitPerforation',false)):undefined;
  return {id:g.id+'-'+(count?'count':mass?'net-mass':length?'continuous-length':String(i+1)),attributes,applicabilityCondition:c,evidenceCoherence:{sameSku:true,sameVersion:true,sameHomogeneousContent:true,sourceUnitAndDenominatorTogether:true,countUnitsInterchangeable:false,excludeGiftsBeforeDivision:true,explicitArithmeticRequired:true}};
 });
 g.requirednessMode='measurement_group';
 g.completionContract='组适用为真且至少一路路径适用为真、所有成员适用为真并有效filled才完成；未选路径未知仍记待补，但不阻断已完整路径。组外独立核心绝不豁免。';
 for(const id of new Set(g.atLeastOne.flat())){
  const b=s.bindings.find((b:any)=>b.categoryId===g.categoryId&&b.attributeId===id);
  b.requirednessMode='measurement_group';b.requirementGroupId=g.id;
  if(g.applicabilityCondition)b.applicabilityCondition=b.applicabilityCondition?all(g.applicabilityCondition,b.applicabilityCondition):g.applicabilityCondition;
 }
 edits.push({kind:'measurement_group_revision',groupId:g.id,before,after:structuredClone(g)});
}
s.requirednessContract={...source.requirednessContract,canonicalConditionField:'applicabilityCondition',conditionTruthDomain:[true,false,'unknown'],applicabilityAndRequirednessSeparate:true,unknown:'条件未知留needs_evidence，仍计保守待补；仅有明确反证才能not_applicable。没有证据既不是false也不是optional。',requiredWhenSemantics:'附加触发：required=true核心不被requiredWhen=false/unknown降低；required=false且requiredWhen=true时触发。普通multipack不触发common.pack。',measurementGroups:'仅requirednessMode=measurement_group成员由组级至少一路完整处理，不再同时要求每条备选路径；原required旗标保留声明。外层组未知不能完成；未选路线未知保留缺项统计、不阻断已完成路线。R净纸重、中心抽长度等组外核心独立计达标。'};
s.revisionRules={schema:'product-governance-revision-rules-v1',canonicalConditions:'applicabilityCondition；旧applicabilityRule只作兼容展示，冲突时修订规则优先。',measurement:'所有计数三元/内包装净质量二元必须同SKU同版本同口径成组；不把原单位换算、总量拆分或条件未知作捷径。',nominalMass:'paper.nominal_mass及paper.mass_basis仅展示原标称声明；单位、覆盖对象、芯/包装口径分开，不能转为核心净纸重或OR量。',preserveEvidence:'旧候选原值、旧证据和迁移原因必须保留；新标准不自动改写250件冻结结果。',entityLevels:'公共/类目特性是定义复用维度，SPU/SKU是实体层级维度，两者不混同。保留全部旧SKU绑定；新增字段均SKU，不用SPU继承覆盖所选型号/颜色/包装差异。'};
s.boundaryDecisionsFile='outputs/product-governance/clean-paper-five-20261019/design/boundary-decisions.json';

const evidenceFor=(r:any):any=>{
 const row=trial.rows.find((x:any)=>x.key===r.key);
 const e=row?.evidence.find((e:any)=>e.id===r.evidenceId&&e.productId===r.productId);
 if(!e||!e.text.includes(r.quote))throw new Error('Candidate evidence cannot be located '+r.key+':'+r.attributeId);
 return {key:r.key,productId:r.productId,category:r.category,attributeId:r.attributeId,originalValue:r.value,originalStatus:r.status,originalMissingReason:r.missingReason,evidenceId:r.evidenceId,quote:r.quote,evidence:structuredClone(e),finalPointer:'analysis/final.json#fieldRecords/'+r.key+'/'+r.attributeId};
};
const candidateAudit=ordinaryCandidates.map((r:any)=>({...evidenceFor(r),decision:r.attributeId==='hand.fold'?'保留厂商原称；不扩几何折型枚举':'接受明确原称枚举扩充',targetAttributeId:r.attributeId==='hand.fold'?'hand.fold_original':r.attributeId,rationale:r.attributeId==='hand.fold'?'三折未明确指折线、面数或厂商命名，不能等同Z/N，也不假定折叠次数；原hand.fold必填不降。':r.attributeId==='paper.count_unit'?'PCS保持原计数单位；不映射中文张/片/抽。':'当前SKU有明确具体香型证据；不是系列名猜香型，不强并近似香型。'}));
const modelingAudit=modelingCandidates.map((r:any)=>{
 const row=trial.rows.find((x:any)=>x.key===r.key);
 return {...evidenceFor(r),decision:'拆分组织形态与取出方式，分别引用当前SKU事实',targetAttributeIds:['face.form','paper.dispense'],supportingEvidence:row.evidence.filter((e:any)=>['T','S','J'].includes(e.id)).map((e:any)=>structuredClone(e)),noAutomaticProductRewrite:true,rationale:'抽取动作不反证卷式；F29的80段/卷结构和抽取式可并存，F43滚筒抽取式分别表达两轴。不得自动迁移为平叠单张式或抹掉原材质等真实冲突。'};
});
const reviewQuestions=[
 {id:'RQ-FOLD-01',attributeIds:['hand.fold','hand.fold_original'],question:'厂商三折原称已保留，是否有足够业务理由把厂商原称作为折叠采购信息的独立达标路径？目前不扩几何枚举、不降低hand.fold必填；不得未经证据映射Z/N或次数。'},
 {id:'RQ-FACE-02',attributeIds:['face.form','paper.dispense'],question:'拆分后新增洗脸巾取出方式是否作为核心必填足以支持筛选/适配？草稿先按原供给识别意图列必填，须独立业务审核，不能因填充率高低决定。'},
 {id:'RQ-MASS-03',attributeIds:['paper.nominal_mass','paper.mass_basis'],question:'标称质量的原unit/per/weightScope元数据是否足以无损展示？范围unspecified只展示原数值、口径未知仍缺项，不能用于采购量或严格净纸重。'},
 {id:'RQ-GROUP-04',question:'检查五个OR组的路径、外层适用性与独立核心是否完全隔离；不能把未选路径unknown误计不适用，也不能因该路线unknown否定已完成路径。'},
 {id:'RQ-ENUM-05',attributeIds:['common.scent','paper.count_unit'],question:'14条香型证据补8个具体原称与PCS保留原单位；不建立近似气味或PCS到张/片的无依据别名。'},
];
s.openReviewQuestions=reviewQuestions;
s.statistics={...source.statistics,definitions:s.definitions.length,publicDefinitions:s.definitions.filter((d:any)=>d.kind==='公共属性').length,categorySpecificDefinitions:s.definitions.filter((d:any)=>d.kind==='类目特性属性').length,bindings:s.bindings.length,requiredBindings:s.bindings.filter((b:any)=>b.required).length,categoryCounts:s.categories.map((c:any)=>{const bs=s.bindings.filter((b:any)=>b.categoryId===c.id);c.attributeCount=bs.length;return {categoryId:c.id,name:c.name,attributes:bs.length,requiredBindings:bs.filter((b:any)=>b.required).length};}),revision:{baseDefinitions:source.definitions.length,baseBindings:source.bindings.length,definitionIdsAdded:s.definitions.filter((d:any)=>!source.definitions.some((x:any)=>x.id===d.id)).map((d:any)=>d.id),originalRequiredFlagsPreserved:true,originalEntityLevelsPreserved:true,originalBoundariesPreserved:true}};
delete s.statistics.freezeChanges;

const failures:string[]=[];
if(s.categories.length!==21||digest(s.categories.map((c:any)=>[c.id,c.path,c.parentId,c.boundary]))!==digest(source.categories.map((c:any)=>[c.id,c.path,c.parentId,c.boundary])))failures.push('Category IDs/paths/boundaries changed');
if(new Set(s.definitions.map((d:any)=>d.id)).size!==s.definitions.length)failures.push('Duplicate definition');
if(new Set(s.bindings.map((b:any)=>b.categoryId+':'+b.attributeId)).size!==s.bindings.length)failures.push('Duplicate binding');
for(const b of source.bindings){const n=s.bindings.find((x:any)=>x.categoryId===b.categoryId&&x.attributeId===b.attributeId);if(!n||n.required!==b.required||n.level!==b.level)failures.push('Old binding/required/level changed '+b.attributeId);}
for(const b of s.bindings){if(!s.categories.some((c:any)=>c.id===b.categoryId)||!s.definitions.some((d:any)=>d.id===b.attributeId))failures.push('Dangling binding');if(b.allowedValues?.some((v:string)=>!def(b.attributeId).enum?.includes(v)))failures.push('Allowed value outside enum '+b.attributeId);}
for(const g of s.requirementGroups)for(const path of g.atLeastOne)for(const id of path)if(!s.bindings.some((b:any)=>b.categoryId===g.categoryId&&b.attributeId===id))failures.push('Dangling group path '+g.id);
if(!bind('有芯小卷纸','roll.net_paper_mass').required||bind('有芯小卷纸','roll.net_paper_mass').applicabilityCondition)failures.push('Net paper core requirement weakened');
if(!bind('中心抽大卷纸','roll.length').required||bind('中心抽大卷纸','roll.length').applicabilityCondition)failures.push('Center roll length weakened');
if(ordinaryCandidates.length!==19||modelingCandidates.length!==2)failures.push('Candidate audit coverage wrong');
if(failures.length)throw new Error(failures.join('\n'));
const changes={schema:'product-governance-standard-revision-changes-v1',status:'draft-for-four-independent-model-reviews',createdAt:new Date().toISOString(),base:s.baseRelease,trial:{file:'outputs/product-governance/clean-paper-five-20261019/analysis/final.json',hash:digest(trial),ordinaryEnumCandidateSlots:19,modelingIssueSlots:2,notOperationsAccuracyEvidence:true},summary:{categories:21,definitionsBefore:source.definitions.length,definitionsAfter:s.definitions.length,bindingsBefore:source.bindings.length,bindingsAfter:s.bindings.length,ordinaryCandidateSlotsAudited:candidateAudit.length,modelingIssueSlotsAudited:modelingAudit.length,oldRequiredFlagsPreserved:true,oldLevelsPreserved:true,categoryBoundariesChanged:false,oldStandardChanged:false},changes:edits,enumCandidateAudit:candidateAudit,modelingIssueAudit:modelingAudit,migrations:{faceAndKitchen:'原形态ID保留但维度澄清；抽取式迁动作，形态另取本体证据，不自动copy为平叠。',threeFold:'原词可进hand.fold_original；几何hand.fold不自动升级为filled，也不降原必填。',nominalMass:'原质量数值及unit/per/weightScope独立展示；严格净纸重不回填、不豁免。',results:'本生成器不修改任何冻结商品结果或生产数据。'},openReviewQuestions:reviewQuestions,verification:{passed:true,failures,definitionsAndBindingsComplete:true,conditionEngineContract:'revision/conditions.ts；measurement_group仅组内生效',oldStandardHashUnchanged:digest(await read(join(SOURCE,'design/standard.json')))===digest(source)},reviewState:s.reviewState};
await save(join(RUN,'design/standard-draft.json'),s);
await save(join(RUN,'design/changes.json'),changes);
console.log(JSON.stringify({categories:s.categories.length,definitions:s.definitions.length,bindings:s.bindings.length,candidates:19,modelingIssues:2,draftHash:digest(s),verification:changes.verification}));
