import {join} from 'node:path';
import {read,save,digest} from '../runtime/storage.ts';
import {ROOT} from '../expansion/settings.ts';
import {applyRootRevisions} from './apply-root-revisions.ts';
import {applyConditionRevisions} from './apply-condition-revisions.ts';
const RUN=join(ROOT,'outputs/product-governance/clean-paper-21-revision-20261019');
// Each entry is an evidence-based adjudication of the corresponding saved model issue.
const rationale:Record<string,string[]>={
'deepseek-1':[
'拒绝｜未知分节结构仍属待补证，不能移出必填分母；明确不分节才不适用，缺资料可以交付已核实字段但不标完整。',
'拒绝｜与有芯小卷纸相同：条件未知不得当否，不能通过移出分母提高完整率。',
'部分采纳｜折叠信息改为几何折型或厂商明确原称至少一个有证据；三折保留原文，不据此断言Z/N几何或设备可互换。',
'采纳说明｜枚举外明确用途保留原值候选及证据；尚未审定不作标准枚举命中，不用“其他”掩盖。',
'已有机制｜归属总闸已将错挂、待判及未确认目标排除填充率；不必每个属性复制类别条件。',
'部分采纳｜混规格、赠品、加量必须核实同一分子分母及组成后计算；无须强制先填一个文本属性才能采纳已有明确单包证据。'],
'deepseek-2':[
'部分采纳｜新增形态/动作跨字段冲突检查；不要求已知取出动作才可采纳明确数量，也不从抽取式反推组织形态。',
'部分采纳｜结构与取出动作独立取证并检查冲突；卷式但分节未知是真实信息缺口，不强制猜成长度或计数路线。',
'已有机制｜归属总闸先确认原类及目标；中心抽错挂不进入本类计率，不在各尺寸字段重复用途门槛。',
'已有机制｜用途不符先判错挂/待判；确认本类之后才计率，不以字段补全绕过类别门槛。',
'采纳｜将适配卷纸、折叠擦手纸、抽取纸张等分支编译为有正反证的条件事实；适配类型未知不能记不适用。',
'部分采纳｜增加质量口径关联校验，含芯/包装或不明声明不复制净纸重；明确净纸重本身的证据无需依赖另一个选填字段先填好。'],
'deepseek-3':[
'拒绝｜输入已有measurement_group模式，组内旗标不同时作为独立必填。未选路径未知可留缺项，不阻断另一条完整有效路线。',
'拒绝｜已有组级至少一路完整语义；不将未选路径未知伪装为不适用。',
'拒绝｜现有条件执行器已区分组成员与独立必填，组为明确不适用时不重复要求各成员。',
'部分采纳｜一次性枕面分支以可追溯归属证据和条件事实承载，补pillow.hole结构化分支；不为记录审核证据新增冗余商品属性。',
'采纳说明｜非纸质套入式分支须先裁定归属，不能因seat.form枚举可填就算归属确认；写入跨字段/归属闸口约束。',
'部分采纳｜明确电气件仍需适配范围；是否需要机械接口按真实结构证据判，不能只凭电气件名称一概豁免。'],
'qwen-1':[
'拒绝｜有芯小卷纸已有独立核心净纸重，模型遗漏该字段；不新增强制长度来重复容量要求。',
'拒绝｜用途是重要边界和搜索信息，不能因来源常缺而降必填；信息不足须归属复核或字段待补。',
'部分采纳｜改为折叠信息OR组保留明确原称；没有几何折型不等于有厂商原称，不能靠空值触发造值。',
'拒绝｜同SKU单包量与总量冲突需要补证，不能默认优先单包数后掩盖不一致。',
'拒绝｜不从用途推断含酒精的安全性或去污效果；第一期保留事实属性，不引入未经依据支持的安全联动。',
'拒绝｜类别边界已区分消耗纸与可复用容器；不为盒装抽纸批量默认容器不可复用，避免无证据新字段。'],
'qwen-2':[
'部分采纳｜平叠结构与中心/外圈卷式动作不能同时成立；不引入干湿状态推断组织形态。',
'部分采纳｜卷式与平叠揭取冲突需复核；分节卷可以逐张取用，不按模型建议一并禁止。',
'拒绝｜净纸重核心不因难获取降级；标称质量口径不明不能作为等效路径，明确同口径证据可填写净纸重。',
'拒绝｜不凭“大盘卷”默认外圈拉取，也不降必填；明确图片结构可作为证据，不能用行业默认代替。',
'拒绝｜“通用”不等于所有纸型兼容；未知适配范围留待补，不能据外形尺寸自动保证兼容。',
'暂缓｜折型与折后尺寸均可保留选填，当前不新增依赖；缺一个不使另一个失效，更不能默认推算展开面积。'],
'qwen-3':[
'拒绝｜原定义已指单内包装；销售总量层级未知不能塞入此槽，也不能因缺层级将核心降选填。',
'拒绝｜模型误读条件，输入实际为isSingleHomogeneousItem=true；无需反转已有正确条件。',
'拒绝｜“通用/万能”宣传不能证明没有几何接口需求；缺适配证据保留待补。',
'部分采纳｜补一次性面枕分支canonical条件；不扩成所有纺织品开孔字段，不默认纺织品无孔。',
'已有机制｜无声明不是不可冲散，也不是可冲散；保持未知，未来展示须区分未知和否，不凭“纸质”推断。'],
'glm-1':[
'采纳说明｜仅写湿巾不猜具体用途，wet.use记needs_evidence；湿巾身份已确认可归类但不完整，产品形态也不明才归属待判。',
'部分采纳｜无折型证据待补；有厂商明确原称可完成折叠信息OR路径，但不能声称几何规格已知。',
'采纳｜公共颜色明确为纸/巾本体，容器类为容器本体；销售包装印刷色不得混入。',
'采纳说明｜同SKU“有芯”原文可同时用于归属及条件事实，须保持原证据ID和原文，类别标签本身不是证据。',
'拒绝｜公共属性可复用不代表所有类目必须对称绑定；湿巾颜色需求需业务价值支持，本轮不为对称新增。',
'采纳｜湿巾迁移为数量、原计数单位、最内包装单位三元组，避免片/抽和袋/桶混淆；历史值带证据重验。'],
'glm-2':[
'部分采纳｜修正餐巾纸计数适用文字，维持三个独立核心；缺数量资料不是不适用，不按信息是否存在设置事实门槛。',
'采纳说明｜保留大卷擦手纸长度核心并写明采购容量/补充频次依据；缺值needs_evidence，不强填、不冒充完整。',
'部分采纳｜保留适配纸品核心并写明缺证据待补；泛称纸巾盒不能当枚举外具体纸型。',
'采纳｜执行器明确纯选填缺值不阻断必填全齐；质量组成未知只限制合法展示和转换，不升级为必填。',
'采纳｜各补充绑定写独立业务理由及一致的SKU归属前提，移除通用复制话术。',
'采纳｜本草案尚未发布；终审时收口必填决议及理由、移除待定话术，记录原审核版与终审版哈希。'],
'glm-3':[
'部分采纳｜保留OR组控制，不把成员当独立必填；对齐重量路径事实但未知未选路线不妨碍有效计数路线完成。',
'采纳｜条件树规范化，合并重复事实和重复同型组合；不改变三值逻辑。',
'拒绝｜平板纸具体类的归属闸已判断混合装，不能对所有已确认商品额外制造单一品条件缺口；组仍保留路径未知语义。',
'部分采纳｜坐垫纸数量三元保留独立核心，修正适用文字；仅一路且三个均需的条件无须人为建OR组。',
'拒绝｜通用件仍须真实适配范围或接口证据；无适配声明不是不适用，不降核心。',
'采纳说明｜明确枕巾枚举外真实单位留候选，单位不明或不配对时不计算销售数量。'],
'kimi-3':[
'采纳｜明确平板卫生纸为非互叠抽取供给的平板/刀切纸；干式互叠抽取厕纸由已登记生活用纸分支承接。两类互写排除边界，局部计数单位不再直接允许抽。',
'部分采纳｜真实“个”计数可保留枚举候选，不改成片；非纸质套入式分支仍须先裁定归属，本轮不凭假设升级全类枚举。',
'采纳说明｜多纸型兼容证据完整保存在compatibility，跨本类allowedValues的真实值留候选；按明确主要设备/用途归类，无主要用途不能随意二选一。',
'采纳｜删除“相同数值不同单位不算冲突”的放宽；张/抽/片等跨口径须保留各方证据并待核，仅字形归一可自动处理。',
'部分采纳｜默认保留原数原单位：一对记1对；仅有明确同SKU1对=2条等值证据时可转换并留算式，不删除对或凭常识无条件换算。',
'部分采纳｜将历史迁移说明移出applicability到migrationNotes；执行器只读取canonical AST，原本不会执行自然语言。'],
'kimi-2': [
'部分采纳｜删除餐巾纸计数适用文字与核心声明的冲突；保持数量三元为独立核心，不能按有没有数量资料豁免。',
'采纳说明｜这是未发布审核草案；终审收口取出方式的业务理由和必填决议，消除待定与生效描述混用。',
'拒绝｜模型加入了原边界没有的“有芯小卷纸只限外圈”假设；明确如厕、有芯、小卷可归有芯小卷纸并保留取纸方式，不因中心抽改大卷。',
'部分采纳｜保留大卷擦手纸长度核心并写采购容量/补充频次理由；明确节距与节数可按规则核算，不能用纸幅宽度当节距。',
'部分采纳｜问题在长度路线被过度限定为不分节卷；洗脸巾与厨房纸巾改为已确认卷式即可采用可靠长度路线，补洗脸巾分节选填，不重复强加节数必填。',
'采纳说明｜声明paper.dispense为广义动作、roll.dispense为卷纸投影，相同卷路径值语义一致；本批互斥绑定不重复采集，后续统一ID须显式迁移。'],
'kimi-1': [
'部分采纳｜折叠信息改OR组：标准几何或明确厂商原称可完成信息义务；未取到证据不降必填。',
'采纳｜软包/盒装/湿巾数量迁移至计数三元，保留原抽/张/片/PCS；累计层张不是成品数量，不乘除层数猜换算。',
'部分采纳｜用途不明明确留needs_evidence；不新增“通用”值代替具体用途，产品身份不明再归属待判。',
'采纳｜有芯小卷纸补选填纸幅宽度与取纸方式、中心抽大卷纸补条件化单节尺寸，复用已有定义。',
'暂缓｜销售卷数有展示价值先保选填；当前不是自动计价采购闭环，强制升级需业务用途确认，不能因整套有数就推断。',
'拒绝｜这7类原审稿没有计量OR组，因此分组输入为空；完整21类标准已有5组，模型误将局部分组当全量缺失。']
};
let s:any=await read(join(RUN,'design/standard-draft.json'));
const reviewedDraftHash=digest(s);
if(reviewedDraftHash!=='a95b5d102f7915fb64482cd511cfdbb6b4c91dfc681a155e1961eb6af611f2cc')throw Error('Reviewed draft changed; these adjudications require renewed review.');
const root:any=applyRootRevisions(s);s=root.s??root.standard;
const cond:any=applyConditionRevisions(s);s=cond.s??cond.standard;
const appliedChanges=[...(root.appliedChanges??root.changes?.appliedChanges??[]),...(cond.appliedChanges??cond.changes??[])];
const edit=(id:string,extra:string)=>{const d=s.definitions.find((x:any)=>x.id===id);if(d){const before=d.rule;d.rule=before+' '+extra;appliedChanges.push({target:id,before,after:d.rule,reason:'Codex逐项终审补充明确执行出口'});}};
edit('wet.use','仅写湿巾、便携等不能推出具体用途，记needs_evidence；产品身份明确为湿巾时可确认类目但必填不完整。明确枚举外用途保留原文候选与证据，审定前不作标准枚举命中。');
edit('pillow.count_unit','来源明确的枚举外单位保留原文候选，不填其他；单位或包装层级未配对时不得推算销售数量。');
edit('seat.form','非纸质套入式分支的枚举仅用于记录候选事实，须经类目承接裁定；未确认不能计为坐垫纸归属正确或完整达标。');
const rationaleFor:Record<string,string>={'roll.width':'纸幅宽度支持分配器尺寸匹配与展示；无证据可缺，不从整卷外径换算。','paper.print':'纸/巾本体是否印花支持展示筛选；包装印刷和压花不作印花证据。','paper.dispense':'取出动作支持取用方式筛选并区分类目边界；它与卷式/平叠结构是独立维度。','paper.use':'明确用途用于类别边界复核和搜索筛选；不能直接复制挂载类目名称。'};
for(const b of s.bindings){if(rationaleFor[b.attributeId]&&(b.rationale?.includes('补充取纸路径')||b.rationale?.includes('须四模型')))b.rationale=rationaleFor[b.attributeId];if(b.attributeId==='roll.length'&&s.categories.find((c:any)=>c.id===b.categoryId)?.name==='大卷擦手纸')b.rationale='单卷长度用于采购容量与分配器补充频次判断，维持核心；无可信证据记needs_evidence，不凭净重推长度。';}
s.requirednessContract.requiredWhen='附加必填触发使用三值逻辑；原核心不被条件降低。未知触发保留待补并阻断宣称必填完整，明确不触发才不增加义务。';
s.requirednessContract.optionalMissing='纯选填字段缺值或适用条件未知仍记录缺项，但不阻断必填全齐；仅已核实、适用的值可交付。';
s.requirednessContract.evidenceReuse='同一当前SKU原始证据可复用于归属、属性、条件事实，均保留ID与原文；类别名和模型结论不能代替源证据。';
s.requirednessContract.metricUnits='字段填充率以字段槽位计算；OR组完整度以义务数计算，两者分开展示，不将组与字段混称必填字段填充率。';
// Resolve final Kimi findings without extending the V2 tree.
const quantity=s.definitions.find((d:any)=>d.id==='paper.quantity');
quantity.rule=quantity.rule.replace(/ 同SKU来源分别写相同数值[\s\S]*$/u,'')+' 同SKU不同来源出现张/抽/片等不同实物计数口径，即使数值相同也须保留双方原文并标记冲突待核，不自动按选定来源覆盖。仅PCS大小写等字形归一允许自动统一。';
const pillow=s.definitions.find((d:any)=>d.id==='pillow.sales_count');pillow.rule='与pillow.count_unit成组，默认保留来源数值及原单位：一对记1对。只有当前SKU明确证明1对=2条等值关系才可换算，保留证据、原值和公式；套装不能推断本体数量，赠品另列。';pillow.formula='同规格每包数×包数；换单位须同SKU明确等值证据，不默认对转条';
const flat=s.categories.find((c:any)=>c.name==='平板卫生纸'),house=s.categories.find((c:any)=>c.name==='生活用纸');
const beforeFlat=flat.boundary;flat.boundary='明确如厕用途、非互叠抽取供给的平板/刀切形态干卫生纸，按原张计数或净纸重记录。排除卷纸、预浸湿厕纸、面巾抽纸及干式互叠抽取厕用纸；后者走生活用纸已登记分支。仅“抽”字不足以确认结构，来源形态不明须补证。';house.boundary+=' 本分支的抽取指互叠抽取供给，排除非互叠供给的平板/刀切纸（归平板卫生纸）；须有结构证据，不能只凭单位“抽”改类。';
s.bindings.find((b:any)=>b.categoryId===flat.id&&b.attributeId==='paper.count_unit').allowedValues=['张'];
for(const b of s.bindings){if(typeof b.applicability==='string'&&b.applicability.includes('原旧规则')){b.migrationNotes=b.applicability.slice(b.applicability.indexOf('原旧规则'));b.applicability=b.applicability.slice(0,b.applicability.indexOf('原旧规则')).trim();}}
edit('accessory.compatibility','明确同时兼容跨类纸型时完整保留各设备及用途证据；按主要设备/用途确定类目，未能确定主用途保持归属待判，不丢弃跨类兼容事实。');
edit('accessory.fit_paper','超出当前类目allowedValues的明确兼容纸型保留候选与原证据，并在accessory.compatibility记录全貌，不擅自改成同类值。');
appliedChanges.push({target:'平板卫生纸/生活用纸边界',before:beforeFlat,after:flat.boundary+'；'+house.boundary,reason:'消除干式抽取厕纸与平板/刀切供给边界重叠；仍保留V2节点和ID。'},{target:'paper.quantity',before:'同数不同单位可选一方',after:quantity.rule,reason:'Kimi发现语义放宽会掩盖计数口径冲突，恢复逐源待核。'},{target:'pillow.sales_count',before:'一对默认2条',after:pillow.rule,reason:'保留原单位，转换必须同SKU明确等值证据。'});
s.reviewState={status:'codex-adjudicated-pending-targeted-review',reviewedDraftHash,operations:'pending',productRegression:'not_executed',online:'not_executed'};
s.status='candidate-not-published';s.releaseId='clean-paper-21-revision-20261019';
s.openReviewQuestions=[];
for(const c of s.categories)c.attributeCount=s.bindings.filter((b:any)=>b.categoryId===c.id).length;
s.statistics={categories:s.categories.length,definitions:s.definitions.length,activeDefinitions:new Set(s.bindings.map((b:any)=>b.attributeId)).size,bindings:s.bindings.length,requiredBindings:s.bindings.filter((b:any)=>b.required).length,categoryCounts:s.categories.map((c:any)=>({categoryId:c.id,name:c.name,attributes:c.attributeCount,requiredBindings:s.bindings.filter((b:any)=>b.categoryId===c.id&&b.required).length})),note:'requiredBindings为声明数，条件和OR组另评估，不代表每个SKU全部必填；历史值不自动迁移。'};
const decisions:any[]=[],coverage:any[]=[];
for(const model of ['deepseek','kimi','glm','qwen']){
 const ids=new Set<string>();
 for(let g=1;g<=3;g++){
  const stage='cards-independent-'+g+(model==='glm'&&g<3?'-protocol-r2':'');
  const r:any=await read(join(RUN,'models',stage+'-'+model+'.json'));
  if(r.status!=='completed')throw Error('incomplete '+stage+' '+model);
  const rs=rationale[model+'-'+g];if(!rs||rs.length!==r.content.issues.length)throw Error('Adjudication missing '+model+'-'+g+' '+r.content.issues.length);
  r.content.reviewedCategoryIds.forEach((id:string)=>ids.add(id));
  r.content.issues.forEach((issue:any,i:number)=>{const [action,...reason]=rs[i]!.split('｜');decisions.push({...issue,id:model+'-'+g+'-'+(i+1),model,action,reason:reason.join('｜'),inputHash:r.requestHash,record:stage+'-'+model+'.json'});});
 }
 coverage.push({model,categoryIds:[...ids],stage:'independent_initial_draft'});
}
await save(join(RUN,'design/standard.json'),s);
await save(join(RUN,'design/adjudication.json'),{reviewedDraftHash,finalCandidateHash:digest(s),coverage,decisions,appliedChanges,migrations:root.migrations??root.changes?.migrations,operationsStatus:'pending',targetedReviewStatus:'pending'});
console.log({definitions:s.definitions.length,bindings:s.bindings.length,issues:decisions.length,hash:digest(s)});
