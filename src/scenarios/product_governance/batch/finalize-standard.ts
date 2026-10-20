import {join,resolve} from 'node:path';
import {read,save,digest} from '../runtime/storage.ts';
const root=resolve(import.meta.dir,'../../../..'),dir=join(root,'outputs/product-governance/three-category-20261019');
const s:any=await read(join(dir,'design/standard-draft.json'));
const d=(id:string)=>s.definitions.find((a:any)=>a.id===id);
for(const [id,unit] of [['soft.draws','抽'],['wet.pieces','片']])d(id!).rule=`优先取明确单个内包装数量。标题以“单包${unit}数×包数”（如80${unit}×6包）重复列举且无相反说明时取80。总量÷包数仅限同规格、同一销售单元、总量和包数都有证据、赠品已剔除且整除，必须输出计算式与证据。无需先填写销售包装组成字段；直接引用原始证据。总量、层数、抽/片/张不得默认互换。`;
d('common.scent').type='选项';d('common.scent').enum=['无香','薰衣草香','柠檬香','薄荷香','绿茶香','茉莉香','玫瑰香','花香','果香','茶香','草本香','有香（未注明香型）'];d('common.scent').selection='单选';d('common.scent').rule='明确标注无香才填无香；无香精不一定无气味，不自动等同无香。具体香型精确匹配，未收录的香型保留枚举候选，不强归相近香型；明确清香但无具体香型可录有香（未注明香型）。';
d('wet.closure').enum=['翻盖','贴封','翻盖+贴封','密封撕口','旋盖'];d('wet.closure').rule='按明示封口结构取值。桶/盒/独立小袋属于包装形态，记录销售包装组成，不能凭这些词推断封口结构。';
d('common.color').enum=d('common.color').enum.filter((x:string)=>x!=='随机');d('common.color').rule='只提取本体明确颜色；包装、系列、印刷用途不作为颜色。实际双色允许多选；随机发色记录销售说明，固定颜色缺项。无色指明示无色透明材料，彩色/多色须明确指本体；枚举外色名保留候选，近似色不强行合并。';
const reasons:any={'common.brand':'品牌用于商品识别、检索和复购；未知不能冒充无品牌。','soft.draws':'每包抽数是同规格数量比较和采购核心计量维度。','soft.layers':'层数区分纸体基础结构，需与抽数同时表达，防止计量混淆。','wet.pieces':'每包片数是湿巾采购数量比较的基础。','wet.use':'本末级承接手口、如厕、厨房等不同用途，必须记录用途以避免混用。','box.material':'盒体材质影响清洁维护与耐用性，是容器采购关键筛选维度。','box.size':'盒体尺寸影响摆放与空间适配，是采购关键参数。','box.fit':'适用纸品决定容器是否可用，属于基础适配条件。'};
for(const b of s.bindings)if(b.required)b.rationale=reasons[b.attributeId];
s.brandSpecialValues=[{id:'reference:brandless',name:'无品牌',condition:'仅商品明确自称无品牌；结构化占位值不构成证据'}];
s.rules.referenceDictionary='品牌使用本次ES实体ID作为引用参考，不声称已完整核验生产品牌字典；明示自身品牌未收录进入候选。';
s.rules.criteria='已有可选单张尺寸/浆料仍保留有价值属性；首期核心围绕品牌、计量、用途与盒体适配。必填策略是业务范围选择，不能按填充率调整，待运营确认。';
s.adjudication={actor:'Codex',at:new Date().toISOString(),status:'离线试点标准已裁定，运营未审核',inputHash:digest(await read(join(dir,'design/standard-draft.json')))};
const decisions:any[]=[];
for(const model of ['deepseek','kimi']){
 const r:any=await read(join(dir,`models/design-cross-review-${model}.json`));
 for(const [i,issue] of (r.content?.issues??[]).entries()){
  let action='保留当前修订口径',reason='核对历史卡、提案和当前卡；不把提案与定稿的差异本身当作定稿错误。';
  if(model==='kimi'){
   const notes:any={
    'wet.pieces':['采纳','删除复制残留，单包片数规则独立使用片，抽数规则独立使用抽。'],
    'soft.draws':['采纳','改为明确的单包数量×包数语法，并保留反证优先。'],
    'common.pack':['部分采纳','包数推导直接引用原始证据，不依赖先填包装字段；拒绝无业务论证升必填。DeepSeek提案原文包装为可选，非两方一致。'],
    'common.scent':['采纳','统一可扩展选项，具体香型与无香保留，枚举外候选不丢弃。'],
    'wet.closure':['采纳','封口结构与包装形态分离，移除桶装/盒装/独立小袋。'],
    'bindings':['采纳','为每个核心属性独立给出必填理由。'],
    'common.color':['部分采纳','随机发色不当固定颜色；保留本体明确的无色/多色等描述，不强合并近似色。'],
    'common.brand':['采纳','增加有严格证据条件的reference:brandless；不冒充生产ID。']};
   [action,reason]=notes[issue.attributeId]??[action,reason];
  }else if(['soft.size','wet.size','soft.pulp','common.pack'].includes(issue.attributeId)){
   action='部分采纳';reason='本轮保持这些字段可选，但拒绝以标注覆盖率作为必填依据；按识别/计量/适配业务目标分层，后续运营确认。';
  }else if(issue.attributeId==='box.material'){
   action='纠正审核事实';reason='跨类手套/工具文字来自历史稿，当前修订卡和DeepSeek提案已改为盒体；拒绝将已修正问题记为未修正。保留当前文本材质便于表达复合部位。';
  }else if(issue.attributeId==='common.scent'){
   action='综合裁定';reason='改用受控选项并保留枚举候选，避免无香/有香吞并具体香型；不采用其他兜底。';
  }
  decisions.push({id:`${model}-${i+1}`,model,...issue,action,reason,adjudicator:'Codex'});
 }
}
await save(join(dir,'design/standard.json'),s);
await save(join(dir,'design/adjudication.json'),{standardHash:digest(s),decisions,proposalDisposition:{accepted:'公共品牌引用、用途、多选适配、盒体材质定义修复；单包数量和尺寸边界',deferred:'产地、是否杀菌、适配品牌、工艺等候选先留提案记录；当前以33个字段完成三类核心及主要展示筛选，避免未经定义的功效字段。',rejected:'无证据无品牌、抽/张/层互换、颜色近似强制合并、按覆盖率设置必填'}});
console.log({hash:digest(s),bindings:s.bindings.length,decisions:decisions.length});
