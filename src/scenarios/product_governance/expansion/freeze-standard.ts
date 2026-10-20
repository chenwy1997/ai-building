import {join} from 'node:path';
import {read,save,digest} from '../runtime/storage.ts';
import {RUN,TARGET_NAMES} from './settings.ts';
const draft:any=await read(join(RUN,'design/standard-draft.json'));
const decisions:any=await read(join(RUN,'design/adjudication.json'));
if(decisions.status!=='root-approved')throw new Error('先逐项记录root审稿裁定');
const s=structuredClone(draft),def=(id:string)=>s.definitions.find((a:any)=>a.id===id),cat=(name:string)=>s.categories.find((c:any)=>c.name===name);
const binding=(name:string,id:string)=>s.bindings.find((b:any)=>b.categoryId===cat(name).id&&b.attributeId===id);
const condition=(fact:string,equals=true,falseState='not_applicable')=>({fact,equals,false:falseState,unknown:'needs_evidence',evidenceRequired:true});
const all=(facts:any[],falseState='not_applicable')=>({all:facts,false:falseState,unknown:'needs_evidence',evidenceRequired:true});
const addOptional=(name:string,id:string,applicability:string,rationale:string)=>{
 if(binding(name,id))return;
 if(!def(id)||!cat(name))throw new Error(`补绑找不到既有定义/类目 ${name}:${id}`);
 s.bindings.push({categoryId:cat(name).id,attributeId:id,required:false,level:'SKU',applicability,rationale});
};
s.releaseId='clean-paper-21-v1';s.status='Codex离线试点标准；待运营随机抽检与审核';
delete def('common.brand').enum;
def('soft.size').definition='干式单张纸品成品展开后的二维长宽，包含抽取、平叠、平板及刀切等单张形态；卷纸单节另用roll.section_size。';
def('soft.size').rule+=' 共享ID前缀不限制纸型；只取干式成品单张展开尺寸，卷式分节使用roll.section_size，折后尺寸另存，不在两个槽位重复。';
def('soft.size').version+=1;
def('soft.layers').definition='单张或单节干纸成品的叠合层数；抽取、平叠、平板或卷式仅是供给形态，不改变层数口径。';
def('soft.layers').version+=1;
def('wet.use').rule+=' 全局枚举候选机制同样适用于用途：明确用途按本义归既有枚举；确实无法归入的明示用途保留原文枚举候选，待扩充，不用其他兜底，不降低业务必填。';
def('wet.use').version+=1;
for(const id of ['soft.size','soft.layers','wet.use'])def(id).origin+='；按本轮root裁定澄清共享语义/通用规则，保持稳定定义ID';
addOptional('软包抽纸','paper.print','确认软包干面巾纸，且纸本体有明确印花证据','供展示筛选；压花、包装图案和未说明均不能代替印花证据。');
addOptional('中心抽大卷纸','roll.core_diameter','明确有纸芯；无芯不适用，芯状态未知待补','补充明示有芯中心抽卷适配规格；中心抽不证明有芯。');
for(const id of ['roll.dispense','paper.use','roll.width','paper.print'])addOptional('无芯小卷纸',id,'确认本类当前SKU；只录该属性明确证据','补充取纸路径、用途、纸幅或印花的展示适配价值；保持选填，不因兄弟类对称升必填。');
addOptional('餐巾纸','paper.use','确认本类当前SKU且有明示用途','补充明示餐饮用途供展示与审计；归属证据仍留category.reason。');
for(const name of ['大卷纸','大卷擦手纸','厨房纸巾'])addOptional(name,'roll.section_size','明确分节卷式纸品；非卷式/不分节不适用，分节未知待补','单节尺寸与纸幅宽度、单张尺寸分开，不造展开尺寸。');
for(const name of ['大卷纸','大卷擦手纸']){
 addOptional(name,'paper.print','确认本类当前SKU且有明示纸本体印花证据','保留印花筛选价值；未说明不填否。');
 addOptional(name,'roll.sales_count','当前SKU同规格主体总卷数及层级明确','明确销售总卷数独立记录；普通同品多包装不触发common.pack条件必填。');
}
s.conditionFactDefinitions=[
 ['hasExplicitCrossCategoryComposition','当前SKU固定主体组成跨V2专类','明示套装/完整清单同时含跨专类主体','明确单品或完整主体清单均在同一专类','搭配/使用示意、适配纸型、多款任选、同品多包入箱均不是触发依据'],
 ['hasExplicitMixedProductOrSpecificationComposition','固定同时销售不同品种/用途/规格主体，与set.is_combo一致','明确异品或异规格主体及其共同销售组成','明确同品同规格multipack；赠品独列不自动改变主体组合状态','新旧包装随机替代、比较图片、系列多规格任选不能当同时混装'],
 ['hasExplicitBonusQuantityComposition','当前所选SKU明确加量/赠量的主体数量规格','明确加量装、增加数量或有原单位和对象的10+2；基准未明仍触发并保留组成缺项','明确正常规格/非加量装','只有升级/更厚、无单位对象10+6、普通multipack不自动触发'],
 ['hasExplicitGiftComposition','当前销售SKU明确含赠品','本SKU附赠/含赠品/包装清单列明赠品','明确无赠品/不含赠品/仅正装','商品合照、搭配购买、示意纸、其它SKU促销不证明当前附赠'],
 ['hasExplicitPerforation','当前卷纸是否明确分节','明示分节/点断/虚线撕取，或明确每卷节数/节距','明示不分节/无断点/连续纸','未给节数、卷纸名称和层数不构成否定'],
 ['isRollFormat','当前纸本体是否为卷式','明示卷式/卷筒本体','明示抽取式/平叠式单张本体','包装文字含卷或缺少形态说明不能单独推断'],
 ['hasExplicitPaperCore','当前纸卷是否明确仍有纸芯','明示有芯/纸芯或纸芯内径','明示无芯/已去芯','中心抽、中心空洞、未提纸芯不能单独推断'],
 ['hasMassBasedSelling','仅已定义OR组内采用重量采购计量路径','明示按重计量，或以明确单内包装净纸重作为采购内容量','明确计数采购路径，重量仅可选参考','任意g/克数字不足；该事实不能豁免R净纸重或中心抽长度等独立核心'],
 ['hasCountBasedSelling','当前商品采用成品原单位计数路径','明确每内包装张/抽/片/段/节等成品量；日杂可按个/只/件/双等实物计数','明示只按净重或连续长度计量，不采用成品计数','纸品整箱卷数不能替代每卷成品数；未给成品数不是否'],
 ['isSingleHomogeneousItem','当前SKU主体单一品种同规格，同品同规格多包仍可成立','单一品名型号规格的同规格包装语法，或完整主体清单确认同规格','明示异品种/用途/规格主体固定组合','组成不全/多款待选不能因为没写组合就填真'],
 ['requiresGeometricInterfaceFit','专用替换安装零件需要独立几何接口匹配','机械轴/支架/固定/出纸零件的明确安装功能和几何配合需求','明确钥匙或仅电气/感应/电路件，不采用独立几何匹配路径','只写配件/通用/材质不足，类型不明留未知'],
 ['hasOneToOneManufacturerReplacementMapping','厂商准确一对一替换映射已完整确定适配','厂家对应表含准确原件号及设备型号并明确一对一替换','明确须按孔距/轴径等独立选配，不由厂商准确型号唯一确定','形似/只适配品牌/未提映射不能自动判假'],
].map(([fact,definition,trueEvidence,falseEvidence,notEvidence]:string[])=>({fact,definition,trueEvidence,falseEvidence,notEvidence,scope:'当前所选SKU',evidenceRequired:true,unknownPolicy:'每个真/假均须evidenceId与精确quote；未知不当否，不用置信度或来源覆盖率代替事实。'}));
for(const id of ['soft.draws','wet.pieces'])def(id).rule+=' 出现10+6、赠、加量、混规格时，须先核对内包装组成，不直接相加或相除；标题与所选规格、主图实质冲突时保留冲突。';
def('box.lock').rule+=' 防盗、防偷仅是宣传，不直接证明带锁。';
def('boxed.draws').rule+=' 先由归属证据确认硬质盒为直接内包装；外箱/销售盒数不是直接纸盒结构或每盒抽数的证据。';
def('paper.quantity').rule+=' 手帕纸4层10片取10片，不乘层数。包装中的卷数不能替代每卷的张/片/段数或纸卷长度。数量、计数单位及内包装单位必须成组核验，任一口径缺失不得把该组认作完整。';
def('paper.quantity').rule+=' 同SKU来源分别写相同数值但不同计数单位时，可按选定证据的原单位整组记录，并保留其他来源原表述；这不代表单位可换算，不能只因抽/张/片措辞不同就认定实质冲突。若数值、包装层级、型号或版本有矛盾才按冲突处理。';
def('paper.quantity').semantic='quantity';def('paper.quantity').quantity={unitField:'paper.count_unit',perField:'paper.inner_unit'};
for(const b of s.bindings){
 const c=s.categories.find((c:any)=>c.id===b.categoryId);
 if(['roll.sections','roll.section_size'].includes(b.attributeId))b.applicabilityRule={fact:'hasExplicitPerforation',equals:true,false:'not_applicable',unknown:'needs_evidence',evidenceRequired:true};
 if(c.name==='厨房纸巾'&&b.attributeId==='roll.section_size')b.applicabilityRule=all([{fact:'isRollFormat',equals:true},{fact:'hasExplicitPerforation',equals:true}]);
 if(b.attributeId==='roll.core_diameter')b.applicabilityRule=condition('hasExplicitPaperCore');
 if(c.name==='厨房纸巾'&&b.attributeId==='soft.size'){b.applicability='仅抽取/平叠干式单张；卷式单节改用roll.section_size，不重复填';b.applicabilityRule=condition('isRollFormat',false);}
 if(c.name==='洗脸巾'&&b.attributeId==='roll.length')b.applicabilityRule={all:[{fact:'isRollFormat',equals:true},{fact:'hasExplicitPerforation',equals:false}],false:'not_applicable',unknown:'needs_evidence',evidenceRequired:true};
 if(c.name==='厨房纸巾'&&b.attributeId==='roll.length')b.applicabilityRule={all:[{fact:'isRollFormat',equals:true},{fact:'hasExplicitPerforation',equals:false}],false:'not_applicable',unknown:'needs_evidence',evidenceRequired:true};
 if(['平板卫生纸','生活用纸'].includes(c.name)&&b.attributeId==='paper.inner_mass')b.applicabilityRule={fact:'hasMassBasedSelling',equals:true,false:'optional',unknown:'needs_evidence',groupId:c.name==='平板卫生纸'?'flat-measurement':'household-single-measurement',evidenceRequired:true};
 if(['平板卫生纸','生活用纸'].includes(c.name)&&['paper.quantity','paper.count_unit'].includes(b.attributeId))b.applicabilityRule={...condition('hasCountBasedSelling',true,'optional'),groupId:c.name==='平板卫生纸'?'flat-measurement':'household-single-measurement'};
 if(['洗脸巾','厨房纸巾'].includes(c.name)&&['paper.quantity','paper.count_unit','paper.inner_unit'].includes(b.attributeId))b.applicabilityRule=condition('hasCountBasedSelling');
 if(c.name==='一次性日杂'&&['paper.quantity','paper.count_unit','paper.inner_unit'].includes(b.attributeId))b.applicabilityRule=all([{fact:'isSingleHomogeneousItem',equals:true},{fact:'hasCountBasedSelling',equals:true}]);
 if(c.name==='生活用纸'&&['soft.layers','soft.pulp','soft.size','common.color','paper.inner_unit'].includes(b.attributeId))b.applicabilityRule=condition('isSingleHomogeneousItem');
 if(['一次性日杂','生活用纸'].includes(c.name)&&b.attributeId==='set.contents')b.applicabilityRule=condition('hasExplicitMixedProductOrSpecificationComposition');
 if(c.name==='洗脸巾'&&b.attributeId==='paper.count_unit')b.allowedValues=b.allowedValues.filter((v:string)=>v!=='卷');
 if(c.name==='洗脸巾'&&['paper.quantity','paper.count_unit'].includes(b.attributeId))b.applicability='按张/片/抽/段/节等成品计数；内包装卷数不能代替每卷成品数，计数路径未知待补证。';
 if(b.attributeId==='accessory.fit_paper')b.allowedValues=c.name==='卷纸配件'?['小卷卫生纸','大卷卫生纸','中心抽卫生卷纸']:['卷筒擦手纸','折叠擦手纸'];
 if(b.attributeId==='accessory.interface'){
  b.applicabilityRule=all([{fact:'requiresGeometricInterfaceFit',equals:true},{fact:'hasOneToOneManufacturerReplacementMapping',equals:false}]);
  b.applicability='仅需独立几何接口匹配的当前安装/替换件；明确钥匙/纯电气件不适用；厂商准确一对一替换已完整确定适配时不强制另走几何校核路径；两项事实未知均须待补。';
 }
 if(b.applicabilityRule)b.requirednessMeaning='required=true表示适用范围内核心必填；明确不适用才排除，条件未知须记录缺项；不得把条件未知自动降为选填。';
}
for(const g of s.requirementGroups){
 if(g.id==='household-single-measurement')g.applicabilityRule=condition('isSingleHomogeneousItem');
 g.measurementContract='只有当前组明确适用才执行至少一路完整；不能豁免组外独立核心必填。组适用性未知须待补，不能自动全部跳过。';
}
s.requirementGroups.push({id:'misc-counted-single-measurement',categoryId:cat('一次性日杂').id,when:'仅已明确单一同规格且按成品计数销售的一次性日杂；组合/非计数商品不被此组强制计数。',applicabilityRule:all([{fact:'isSingleHomogeneousItem',equals:true},{fact:'hasCountBasedSelling',equals:true}]),atLeastOne:[['paper.quantity','paper.count_unit','paper.inner_unit']],reason:'明确计数单品需数量+原计数单位+内包装单位完整；不能把所有杂项强制计数。未知保留待补。'});
s.requirednessContract={required:'在适用范围内的业务必填。未知不得造值，不以缺信息降低必填。',applicabilityRule:'当前SKU证据明确条件为否才不适用；条件未知保留待补证。false=optional时字段保留为选填槽位，不冒充不适用。',requiredWhen:'基于当前SKU可定位原文的显式事实触发；无正面触发事实不强制普通包装组成。',measurementGroups:'至少一条完整计量路径；不能因两路都缺信息就把两路都记不适用。字段适用性与必填情况逐SKU记录。',complete:'所有适用必填字段及当前类目计量组均完成，才记必填全齐。'};
s.requirednessContract.applicabilityRule+=' fact/all/any采用三值逻辑：all有明确假即假、全部真才真，其余未知；any有真即真、全部明确假才假，其余未知；每个真/假事实均须原文证据。';
s.requirednessContract.measurementGroups+=' “已有计数不强制质量/连续长度”仅限明确OR计量组；R净纸重、中心抽大卷纸长度保持独立核心必填，不受节数存在与否豁免。日杂组合或明确非计数商品不强制计数。';
s.requirednessContract.requiredWhen+=' 四类触发含义及正反证见conditionFactDefinitions；普通同品同规格multipack不触发。';
s.rules.conditional+=' 以本轮requirednessContract、conditionFactDefinitions及applicabilityRule为准；不得把OR组规则普遍用于降低卷纸质量/长度核心。';
s.broadCategoryAdmission=[{categoryId:cat('生活用纸').id,productType:'干式抽取厕用卫生纸',status:'Codex离线已确认，待运营审核',rule:'销售主体明确为干式、可冲散抽取厕用卫生纸；不是预浸湿巾，也不是面巾纸。全V2末级核对未见更专门的干式抽取厕纸末级，承接于已有生活用纸。',evidence:'本轮H20/H50标题及主图；全V2叶节点核对',excluded:'仅可冲散宣称、湿厕纸、用途未明的抽纸，均不得据此直接承接。'}];
cat('生活用纸').boundary+=' 本轮已登记的具体承接类型：干式抽取厕用卫生纸；须明示干式厕用主体，排除预浸湿厕纸和普通面巾纸。';
for(const o of s.openDecisions??[]){o.rootDecision=o.id==='broad-combination-register'?'先登记干式抽取厕用卫生纸这一明确类型；其他类型和跨类组合逐项登记，未定义组合不自动入宽类。':'保留明确核心边界；边缘分支缺证据或尚未确定业务范围时归属待确认，不把模型建议当运营批准。';}
s.reviewState={initialModels:['deepseek','kimi'],full21FinalModels:['deepseek','kimi'],rootAdjudicated:true,operationsReview:'not_reviewed',productionWrite:false,draftHash:digest(draft),adjudicationFile:'design/adjudication.json'};
s.sharedRules={schema:'product-governance-shared-rules-v1',source:'src/scenarios/product_governance/expansion/rule-catalog.json'};
s.statistics.categoryCounts=s.categories.map((c:any)=>{const rows=s.bindings.filter((b:any)=>b.categoryId===c.id);c.attributeCount=rows.length;return {categoryId:c.id,name:c.name,attributes:rows.length,requiredBindings:rows.filter((b:any)=>b.required).length,conditionalRequiredBindings:rows.filter((b:any)=>b.required&&b.applicabilityRule).length,explicitRequiredWhenBindings:rows.filter((b:any)=>b.requiredWhen).length};});
s.statistics.definitions=s.definitions.length;s.statistics.bindings=s.bindings.length;s.statistics.requiredBindings=s.bindings.filter((b:any)=>b.required).length;
s.statistics.freezeChanges={optionalBindingsAdded:s.bindings.length-draft.bindings.length,sampledFiveBindingCountsPreserved:true,kimiFinalIssuesAdjudicated:18};
if(s.categories.length!==21||new Set(s.categories.map((c:any)=>c.id)).size!==21)throw new Error('21类完整性失败');
if(s.bindings.some((b:any)=>!def(b.attributeId)||!s.categories.some((c:any)=>c.id===b.categoryId)))throw new Error('悬空绑定');
if(s.definitions.length!==86||s.bindings.length!==304)throw new Error(`属性基数异常 ${s.definitions.length}/${s.bindings.length}`);
if(new Set(s.bindings.map((b:any)=>`${b.categoryId}:${b.attributeId}`)).size!==s.bindings.length)throw new Error('重复绑定');
for(const name of TARGET_NAMES){const a=draft.bindings.filter((b:any)=>b.categoryId===cat(name).id),b=s.bindings.filter((b:any)=>b.categoryId===cat(name).id);if(a.length!==b.length||a.some((x:any)=>!b.some((y:any)=>x.attributeId===y.attributeId&&x.required===y.required)))throw new Error(`原五类绑定变化 ${name}`);}
if(!binding('有芯小卷纸','roll.net_paper_mass').required||binding('有芯小卷纸','roll.net_paper_mass').applicabilityRule)throw new Error('R核心净纸重被豁免');
if(!binding('中心抽大卷纸','roll.length').required||binding('中心抽大卷纸','roll.length').applicabilityRule)throw new Error('中心抽长度被豁免');
if(!binding('平板卫生纸','soft.layers').required||binding('平板卫生纸','soft.layers').applicabilityRule)throw new Error('平板层数核心被豁免');
if(decisions.decisions.filter((d:any)=>d.round==='final'&&d.model==='kimi').length!==18)throw new Error('Kimi终审18项未齐');
for(const b of s.bindings)if(b.allowedValues?.some((v:string)=>!def(b.attributeId).enum?.includes(v)))throw new Error('绑定取值域超出定义');
for(const g of s.requirementGroups)for(const path of g.atLeastOne)for(const id of path)if(!s.bindings.some((b:any)=>b.categoryId===g.categoryId&&b.attributeId===id))throw new Error(`计量组悬空 ${g.id}:${id}`);
await save(join(RUN,'design/standard.json'),s);await save(join(RUN,'design/standard-freeze.json'),{frozenAt:new Date().toISOString(),standardHash:digest(s),draftHash:digest(draft),adjudicationHash:digest(decisions),productionWrite:false});
console.log({release:s.releaseId,categories:s.categories.length,definitions:s.definitions.length,bindings:s.bindings.length,hash:digest(s)});
