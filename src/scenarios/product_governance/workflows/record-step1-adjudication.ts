/** Codex于本轮逐项阅读实际模型意见及商品证据后写定的裁定；不是自动投票器。 */
import {join,resolve} from 'node:path';
import {read,save,digest,append} from '../runtime/storage.ts';
import type {Standard,ValueResult} from '../domain/types.ts';
import type {Adjudication} from '../runtime/report.ts';
const run=resolve(process.argv[2]??'outputs/product-governance/step1-20261018');
const standard=await read<Standard>(join(run,'standard-r2.json')),results=await read<ValueResult[]>(join(run,'results-r2.json'));
const approvedSnapshot={
 'standard-r2.json':'d67180f4667fa23dd7023c4f7c7ffbfd56c16823e2f392fa82e9fff87491a907',
 'results-r2.json':'175ef7fc645b204a1f5b4103a9f3130d3d6df2bdd4667ada01ae66d6bcb57e3e',
 'cases-r2.json':'2b3045f2902c4244cbcf72954948bba513c1368f755ace91519755dc68fb6891',
 'reviews-r1.json':'1254d8ed8e9e0a872a563b85667a8fab7c21f1604fd31f9b2621ea589e21139a',
 'reviews-r2.json':'61c4851f6fdff2fbc2c3b3d27606cc4b347c902a41b43b7d19a62ae19904ad59',
};
for(const [file,hash] of Object.entries(approvedSnapshot))if(digest(await read(join(run,file)))!==hash)throw new Error('本次人工裁定仅适用已审阅快照；输入改变必须重新裁定：'+file);
const decisions:Adjudication['decisions']=[];
const d=(reviewFile:string,modelId:string,findingId:string,action:Adjudication['decisions'][number]['action'],reason:string,implementation:string)=>decisions.push({reviewFile,modelId,findingId,action,reason,implementation});
d('reviews-r1.json','deepseek','F01','deferred','接受正式品牌字典是发布前提。本轮仅验证模型和规则，参考ID不代表生产ID；已补复合别名，但不把5条参考项当完整品牌库。','pilot-v2.json标明productionIdsVerified=false；后续核验生产字典并重验。');
d('reviews-r1.json','deepseek','F02','adopted','无品牌也是需要审核的选项，缺少选项时必须进入候选转正流程，不能自动建生产记录。','brand.resolve.v2.onFailure写明复核、抽检、生产ID核验、版本发布和重验。');
d('reviews-r1.json','deepseek','F03','adopted','明确本版完全不执行抽片转换；同品资料确实明示片数时作为新证据，未来转换规则须单独审议。','wet_count.resolve.v2.preconditions显式说明；Q09、H04保留待补证。');
d('reviews-r1.json','deepseek','F04','adopted','混合包需要组成资料，不能通过填写主规格或平均值代表整个SKU。','规则onFailure保留组成信息补证请求，原始片段在案例证据内保留。');
d('reviews-r1.json','deepseek','F05','rejected','scope应是经证据确认的包装范围标识。文本同义不证明属于同一个包装实例，自动模糊归一可能合并不同箱组。','r2明确scope精确比较；范围标识的语义确认由取证审核承担。');
d('reviews-r2.json','deepseek','F01','rejected','代码先通过placeholders过滤“国产”，随后才建立mapped与unique；并未让国产与舒克兔作为两个品牌参与冲突判定。保留“舒克兔”为字典外候选不等于品牌已确认或已发布。','保留现规则；H06经Codex逐字段复核仍为enum_candidate，禁止计入已填/正式发布。');
d('reviews-r2.json','deepseek','F02','adopted','标题词需要语义复核，这一提醒成立。本轮Codex核对H06全文，未见适配、供应商或仿同款修饰，允许保留待核品牌候选；并未将其转正。','新增历史12字段逐条Codex裁定与导出门槛；引擎初检本身不等于语义已核实。');
d('reviews-r2.json','deepseek','F03','adopted','保留缺项。H03是单包范围未明，H04是抽片单位未明，两种原因不同；不按模型简略措辞混为同一原因。','历史字段裁定分别记录原因，后续以同SKU包装或规格资料补证。');
d('reviews-r2.json','kimi','R2-F01','adopted','采用选项型，支持稳定品牌展示、搜索筛选与别名归一；源文本完整保存在观察层，字典外值保留候选。','公共属性类型为选项；raw evidence、enum_candidate及reference字典分开。');
d('reviews-r2.json','kimi','R2-F02','adopted','多个自身品牌不凭版面或模型偏好选一个主品牌；单值模型下保持冲突，后续为联名组合建专门规则。','现有BRAND_CONFLICT、BRAND_VS_BRANDLESS；B06与B11回归。');
d('reviews-r2.json','kimi','R2-F03','adopted','包装图也可能来自其他规格，不能无条件优先于标题。先确认同SKU再裁定。','brand.resolve.v2新增来源冲突不自动挑选前提。');
d('reviews-r2.json','kimi','R2-F04','adopted','采用草案明确无品牌声明机制，未知值不默认无品牌。','B07缺证据，B08明确无品牌可填，B11冲突被拦截。');
d('reviews-r2.json','kimi','R2-F05','deferred','承认5条参考项不能覆盖生产目录。本轮只展示局部规则，不据此判断品牌字段可获得率或全量治理效果。','正式品牌库映射及候选转正为下一步，报告保留限制。');
d('reviews-r2.json','kimi','R2-F06','adopted','统一复合口径片/包。抽、张、层不得自动当片，本版不执行条件换算。','字段、规则与报告单位均为片/包；Q09与H04保持缺项。');
d('reviews-r2.json','kimi','R2-F07','rejected','本属性定义为整个SKU的统一单内包装片数。混合包中一个内包装的明确数值不能代表其他规格；直接值优先会静默丢掉组成差异。','保持MIXED_PACKS；将来拆为组成明细或明确销售子SKU后，另建经过审核的模型。');
const historicalDecisions:Adjudication['historicalDecisions']=[];
const hd=(caseId:string,attributeId:string,status:ValueResult['status'],value:string|number|null,reason:string,evidenceIds:string[])=>historicalDecisions.push({caseId,attributeId,status,value,reason,evidenceIds});
const b='common.brand',q='wet_wipes.pieces_per_pack';
hd('H01',b,'filled','清风','标题自身品牌与结构化品牌一致，按参考字典归一。',['H1-e1','H1-e3']);
hd('H01',q,'filled',80,'标题明确80片/包；4包/箱不改变单包值。销售规格“抽纸”保留为历史归属风险，本步未认定其类目已完成审核。',['H1-e1','H1-e2']);
hd('H02',b,'filled','清风','标题清风与品牌字段清风相互支持，无适配对象修饰。',['H2-e1','H2-e3']);
hd('H02',q,'filled',80,'原文80片/包*12，直接取80，不取整组960。',['H2-e1']);
hd('H03',b,'filled','清风','标题与品牌字段一致，品牌归一可作为样例结果。',['H3-e1','H3-e3']);
hd('H03',q,'needs_evidence',null,'原文60片、6包装未明确60是单包还是总量；不伪造60片/包引用，也不计算60÷6。',['H3-e1','H3-e2']);
hd('H04',b,'filled','清风','标题与结构化品牌一致，参考字典可归一。',['H4-e1','H4-e3']);
hd('H04',q,'needs_evidence',null,'原文80抽和3包，缺明确片数，不把抽直接改写为片。',['H4-e1','H4-e2']);
hd('H05',b,'filled','全棉时代','标题中文品牌和复合品牌字段指向相同已知中英文别名，补别名后归一；生产ID仍未核验。',['H5-e1','H5-e3']);
hd('H05',q,'filled',70,'原文70片/包*3包，单包明确70。',['H5-e1']);
hd('H06',b,'enum_candidate','舒克兔','国产是非品牌占位词；标题舒克兔婴儿手口柔湿巾中的舒克兔可保留待核候选。无正式品牌映射，不算已填。',['H6-e1','H6-e3']);
hd('H06',q,'needs_evidence',null,'标题无数量，销售规格为空，不能猜片数。',['H6-e1','H6-e2']);
const out:Adjudication={authority:'Codex',status:'pilot_accepted_with_limits',revision:'r2',standardHash:digest(standard),resultsHash:digest(results),decisionAt:new Date().toISOString(),conclusion:'首步已跑通属性定义、类目挂载、受限规则、独立提案、双模型审核与Codex裁定。试点结果可供业务审阅；正式品牌映射、运营抽检和更大样本验证尚待完成。',proposalSynthesis:[
 {topic:'品牌字段类型',decision:'选项型，原文另存证据',reason:'两个模型提案为文本型；本项目需要统一展示与筛选，因此采用受控字典，未知和字典外分别处理。'},
 {topic:'公共与特性属性',decision:'品牌共用1个定义、3条挂载；每包片数仅挂湿纸巾',reason:'公共定义不复制，类目适用性和必填分别配置；纸巾盒与软包抽纸不使用湿巾片数。'},
 {topic:'SPU/SKU与包装层级',decision:'SKU记录；每包片数描述单个内包装',reason:'当前无可靠SPU关联，不推断跨SKU共享。整箱或整提是销售范围，不是单包口径。'},
 {topic:'多品牌和来源冲突',decision:'保留冲突，确认同SKU后裁定',reason:'拒绝凭包装优先或标题主词自动选一个品牌；保留双方来源。'},
 {topic:'数量公式',decision:'明确单包值优先；同范围总片数÷同规格包数有条件使用',reason:'同规格、赠品排除和范围必须明确；整数除法不取整，混合装不填均值。'},
 {topic:'模型自身错误',decision:'拒绝将“800片×10包”直接除出80',reason:'Kimi提案中的这个反例未证明800是总量；乘法表达可能描述每包800，必须先确认范围。'},
 {topic:'语义与证据校验',decision:'引用定位是初检；独立意见和Codex裁定另存',reason:'字符串包含不能证明自身品牌、包装归属和赠品语义；多模型一致不当作生产准确率。'},
],decisions,disagreements:[{revision:'r2',caseId:'H06',attributeId:b,decision:'保留舒克兔为enum_candidate；国产过滤，不形成品牌冲突',reason:'依据完整标题和占位词过滤逻辑裁定；DeepSeek的冲突意见建立在国产参与归一的错误前提上。Kimi认可候选。候选仍待品牌身份和正式字典核验。'}],historicalDecisions,limits:[
 '仅实现两种属性和3类挂载，未完成3类全部属性，也未扩到21类。6条历史商品均为湿纸巾候选样例；软包抽纸和纸巾盒主要验证公共属性复用及不适用边界。',
 '历史样例来自既有ES缓存，非随机抽样，未刷新上下架状态、商品详情、图片或京东资料；旧归属建议不等于本轮分类已确认。',
 '品牌字典只有5条参考项，ID不是生产ID；候选不计入已填。本轮8/12是选定样例出值数量，不是生产准确率、全量填充率或完整达标率。',
 '规则初检只处理提供的结构化观察和受限运算，无法独自证明描述对象、计量单位及真假信息；新的大样本观察必须经过独立语义审核及最终裁定。',
 '两模型最终给出40项准则意见，DeepSeek仍保留品牌相关2项不通过与1项不确定；已按事实逐项裁定，未将其改写为全票通过。',
 '运营随机抽检尚未进行；无生产数据库写入或线上同步，当前标准为pilot_draft。Kimi首次格式失败与首轮超时均如实保留。'
],next:[
 '请业务先查看两张属性卡、典型分歧和6件样例，随机挑选疑点反馈，形成下一轮回归案例。',
 '接入正式品牌字典；对字典外候选核实品牌身份，新增已审核别名和映射后重验。',
 '为3个代表类目选独立商品样本，接入模型取证与独立复核；优先为核心缺项补同SKU规格、包装图等证据。',
 '取得实际抽检效果后确定扩到清洁纸品21类的门槛，再推进线上端到端验证。'
]};
for(const d of historicalDecisions){const r=results.find(r=>r.caseId===d.caseId&&r.attributeId===d.attributeId);if(!r||r.status!==d.status||r.value!==d.value)throw new Error('人工裁定与当前结果不一致，请先重验');}
await save(join(run,'codex-adjudication.json'),out);await append(join(run,'events.jsonl'),{stage:'adjudication',status:'completed',authority:'Codex',standardHash:out.standardHash,resultsHash:out.resultsHash});
console.log('已记录15条问题裁定、1项案例分歧及12个历史字段裁定。');
