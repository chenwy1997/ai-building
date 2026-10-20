import {join,resolve} from 'node:path';
import {read,save,hash,exists} from '../runtime/store.ts';
import {checkTrial} from './check.ts';
// Explicit Codex adjudications after inspecting the current product text and model results.
// No inference from images, and no writes to production.
const run=resolve(process.argv[2]!),dir=join(run,'trial');
const products=await read(join(dir,'selected-products.json')),screen=await read(join(dir,'screen-final.json'));
const categories=await read(join(run,'selected-categories.json')),tree=await read(join(run,'tree-original.json'));
const cards:any={};for(const c of categories)cards[c.id]=(await read(join(run,'categories',c.id,'result.json'))).card;
const records:any[]=[],decisions:any[]=[];
for(const p of products){
 const original=screen.find((s:any)=>s.productId===p.id),category={...original};
 const recommendation=(id:string,reason:string,status='已有V2目标，待运营确认')=>{
  category.targetId=id;category.targetStatus=status;category.reason=reason;
 };
 if(['e1de9567','db1cb29d','bb0d775e'].some(x=>p.id.startsWith(x)))
  recommendation('0015377d-022a-4616-97d6-faae073a45c2','食品用锡纸/铝箔盘，标题明示烤箱、烘焙或耐热食品操作用途，V2已有“厨具>烘焙用具”可承接；不应因没有名为铝箔的专属末级即判缺类。');
 if(p.id.startsWith('f43e68a5'))
  recommendation('463ae2dd-354b-4f05-aa8f-8e282864ca6f','一次性纸杯，V2已有厨具下“一次性用品”可承接。');
 if(p.id.startsWith('c2e172ea'))
  recommendation('','13件礼盒为商品组合，缺少组件清单及主要商品，不能由销售规格“抽纸”直接确定整套归属。','需补组件信息');
 if(p.id.startsWith('e0fb28ed'))
  recommendation('433be34e-e1cc-4b5f-b955-df3d802ed2ec','湿厕纸为专用清洁湿巾；全V2末级检索未见专属湿厕纸。湿纸巾可作候选，但当前卡将其列入边界待确认项，须先由运营确认纳入范围。','已有候选，待边界确认');
 if(category.targetId){
  const n=tree.nodes.find((n:any)=>n.id===category.targetId&&n.isLeaf);if(!n)throw Error('invalid target');
  category.targetPath=n.path;category.targetName=n.name;
  category.targetStatus??=category.status==='matched'?'当前类目符合':'已有V2目标，待运营确认';
 }
 if(JSON.stringify(category)!==JSON.stringify(original))decisions.push({productId:p.id,kind:'归属目标',attributeId:'',before:original,after:category,reason:category.reason});
 if(category.status!=='matched'){records.push({product:p,category,eligible:false,values:[]});continue;}
 const model=await read(join(dir,'context-final',p.id+'.json')),card=cards[p.categoryId],values=structuredClone(model.final.values);
 const set=(id:string,patch:any,reason:string)=>{
  const i=values.findIndex((v:any)=>v.attributeId===id);if(i<0)throw Error(id);
  const before=structuredClone(values[i]);values[i]={...values[i],...patch,explanation:reason};
  decisions.push({productId:p.id,kind:'属性裁定',attributeId:id,before,after:structuredClone(values[i]),reason});
 };
 const ev=(text:string,origin='')=>{
  const e=model.evidence.find((e:any)=>e.id.includes(origin)&&e.text.includes(text));
  if(!e)throw Error(`missing quote ${p.id} ${text} ${origin}`);
  return {id:e.id,quote:text};
 };
 const fill=(id:string,value:string,quote:string,reason:string,origin='',calc:any={operator:'none',operands:[],formula:''})=>{
  const a=card.attributes.find((a:any)=>a.id===id);
  set(id,{status:'filled',value,rawValue:quote,enumStatus:a.fieldType==='选项'?(a.enumValues.includes(value)?'in':'out'):'not_enum',reasonCode:'none',evidence:[ev(quote,origin)],calculation:calc},reason);
 };
 const missing=(id:string,reason:string,code='source_missing')=>set(id,{status:'missing',value:'',reasonCode:code,enumStatus:'unknown',calculation:{operator:'none',operands:[],formula:''}},reason);
 const samePack=(quote:string)=>{
  fill('mixed_pack','false',quote,'当前完整规格仅列同一型号/规格的倍数装，没有异规格组件线索；不因未写“无赠品”机械拒绝。');
  set('pack_components',{status:'not_applicable',value:'',reasonCode:'not_applicable',evidence:[ev(quote)],calculation:{operator:'none',operands:[],formula:''}},'已确认本次规格为同质倍数装，异规格组合明细不适用。');
 };
 // Context repair occasionally still misread explicit product nouns.
 if(p.id.startsWith('b395e3bb')){
  fill('tissue_compatibility','抽取式纸巾','抽纸盒','商品自称“抽纸盒”已直接表明兼容抽取式纸巾，不要求再重复出现“适用”两字。');
  fill('style','轻奢/简约','轻奢透明置物架家用收纳盒简约','明示外观风格词，保留复合候选；枚举外不等于未知，不将置物架当风格。');
 }
 if(p.id.startsWith('ca53d325')){
  fill('tissue_compatibility','抽取式纸巾','抽纸盒','商品标题明确抽纸盒，原复核以未另写适用而清空过度保守。');
  fill('style','创意/简约','收纳创意多功能纸巾盒客厅简约','标题明确风格词，按原文并列保留候选，不强行选择单一风格。');
 }
 if(p.id.startsWith('bb42c7a8')){
  fill('tissue_compatibility','抽取式纸巾/餐巾纸','抽纸盒桌面餐巾纸','两种兼容对象可并存，保留复合候选，不任意遗漏抽纸。');
  fill('placement_method','桌面放置','抽纸盒桌面','“桌面”在商品名称中直接描述放置方式；与只有酒店/客厅场景词不同。');
 }
 if(p.id.startsWith('bb6803c2'))
  fill('style','创意','创意可爱','原文明确创意风格，可由现有“创意”枚举承接；可爱作为原文描述保留，不必新增整个营销短语。');
 if(p.id.startsWith('dcb096e0'))
  fill('scent','花香','百花香','百花香可规范到现有花香枚举，原文保留具体香型；不把细分词与已有上位枚举的差异直接算缺口。');
 if(p.id.startsWith('fca0c9f8'))
  fill('tissue_compatibility','抽取式纸巾/洗脸巾','抽纸盒 洗脸巾收纳盒','明示兼容抽纸及洗脸巾，并非互斥；“厕纸盒”歧义不否定明确兼容对象，不据此增加卷纸兼容性。');
 if(p.id.startsWith('eb843a1b')){
  missing('shape','“黑心形”可能是图案或款式，不能确认盒体外部投影形状；第一版不读图片，保留原值待补证。','unit_scope_unclear');
  fill('tissue_compatibility','方巾纸/餐巾纸','立式方巾抽透明纸盒餐巾收纳盒','方巾与餐巾兼容可以并存，保留原文多值候选。');
 }
 if(p.id.startsWith('f25d1db8'))
  fill('main_material','布艺','棉布纸巾盒','棉布属于布艺材质，现有枚举可承接；原值保留“棉布”，不把已有上位枚举可覆盖的值误算成枚举缺口。');
 if(['bdd7bef2','bb42c7a8','caeed119'].some(x=>p.id.startsWith(x)))
  missing('common.model','现有代码为平台ID、规格占位或身份未明的商家编码，没有可核实的制造商型号；原因是型号证据缺失，不应统计为同品核对失败。');
 if(p.id.startsWith('ea52c8a9'))
  missing('independent_packaging','“独立便携装”与10片/包不能确定是否每片各自密封，缺少包装层级信息。','unit_scope_unclear');
 if(p.id.startsWith('d6444762'))
  missing('main_material','标题“皮革”“木制”可以分别对应覆面与基体，并非互斥冲突；主体结构关系未说明，保留两项原词但不擅自选主材质。','unit_scope_unclear');
 if(p.id.startsWith('d9ed7bfe')){
  for(const id of ['fragrance','layer_count','single_piece_width','single_piece_length'])
   missing(id,'京东关联SKU标题为湿巾，但其上游类目及参数组为抽纸（3层、无印花、软包式）。该参数组对象疑似错配，本轮不采信；同品核对不等于字段质量可靠。','source_conflict');
  missing('independent_packaging','80片/包不能证明每片是否独立密封，原标题未明确单片独立包装。');
  fill('total_pieces_sales_unit','480','80片*6包','明确单规格倍数装，80片/包×6包=480片；无混规格或赠品线索，不凭空制造计算障碍。','',{operator:'multiply',operands:[80,6],formula:'80片/包 × 6包 = 480片'});
  samePack('80片*6包');
 }
 if(p.id.startsWith('c187dc23'))
  fill('substrate_material','原生木浆','"cateAttrValList":["原生木浆"],"cateAttrName":"原料成分"','同品湿巾原料字段明确纤维原料为原生木浆，没有液体配方或其他商品对象的证据；不能仅因木浆常见于纸品而排除湿巾基材。','jd:');
 if(p.id.startsWith('d4de9622'))
  fill('primary_use','皮肤清洁','纯水爽肤湿巾','“爽肤湿巾”明确作用于皮肤，可规范为皮肤清洁；不据此推断手口可用或婴儿适用。');
 if(p.id.startsWith('fd79e119'))
  fill('primary_use','皮肤清洁','水润净肤湿巾','“净肤”明确皮肤清洁用途，不必重复出现卡片完整标准词。');
 if(p.id.startsWith('dfb3c105'))
  missing('surface_embossing','京东只说无印花，没有非压花证据，不能填写同时否定压花和印花的组合值。','rule_ambiguous');
 if(p.id.startsWith('f530b5ed')){
  fill('surface_embossing','压花加印花','压花软抽面巾纸','标题压花与同品属性印花是不同表面工艺，可并存；不是互斥值，使用现有组合枚举。');
  const v=values.find((v:any)=>v.attributeId==='surface_embossing');
  v.evidence.push(ev('"cateAttrValList":["印花"],"cateAttrName":"是否印花"','jd:'));
  samePack('3层100抽压花软抽面巾纸');
 }
 // Deterministic contract normalization, with an explicit audit entry for every change.
 for(const v of values){
  const a=card.attributes.find((a:any)=>a.id===v.attributeId),b=card.bindings.find((b:any)=>b.attributeId===v.attributeId);
  if(v.status==='filled'){
   if(a.fieldType==='是否'&&['是','否'].includes(v.value))
    set(v.attributeId,{value:v.value==='是'?'true':'false'},v.explanation+'；规范布尔序列化。');
   const expected=a.fieldType==='选项'?(a.enumValues.includes(v.value)?'in':'out'):'not_enum';
   if(v.enumStatus!==expected||v.reasonCode!=='none')set(v.attributeId,{enumStatus:expected,reasonCode:'none'},v.explanation+'；已填写不携带缺失原因，按字段类型规范枚举状态。');
  }else if(v.status==='applicability_unknown'&&b.requiredness!=='conditional')
   set(v.attributeId,{status:'missing',reasonCode:'source_missing'},v.explanation+'；该属性非条件字段，按值缺证记录。');
 }
 const final={...model.final,values,category},errors=checkTrial(final,card,model.evidence);
 if(errors.length)throw Error(p.id+': '+errors.join(';'));
 const completionPath=join(dir,'completion-review',p.id+'.json');
 const completion=await exists(completionPath)?(await read(completionPath)).value:null;
 if(completion)for(const f of completion.findings){
  const reason=f.attributeId==='sheets_per_pack'
   ?'采纳规则冲突提醒：旧合成反例将明写“抽”仍称无法区分张/包，反例不当。本次按完整纸面巾单规格标题解释为100抽/包，作为试填裁定口径；反例须在下次卡片发布中修正。'
   :f.attributeId==='packs_per_bundle'
   ?'不采纳默认不适用：未写提结构不等于没有提结构；仍未知并保守计入分母。'
   :f.attributeId==='mixed_pack'
   ?'完整销售规格仅一组100抽3层×24包可支持同质倍数装，不能要求每条都明写无赠品；发现混装迹象时再停止。'
   :f.attributeId==='sheet_size'
   ?'本次采纳同品SKU参数“纸张尺寸 长132mm/宽180mm”作为单张尺寸，未出现包装/折叠范围线索；记录该字段展开口径需运营抽检，不将型号或包装尺寸换算进来。'
   :'未发现实际字段冲突，不采纳仅凭“可能平台默认”清空。接口返回的是该SKU的非空明示参数，不是类目空模板；同品关联成立后可作为补充证据。total_packs为标题直接24包，整箱销售另由saleUnit箱与24包/箱支持。';
  decisions.push({productId:p.id,kind:'补齐DS复核意见处置',attributeId:f.attributeId,before:f,after:values.find((v:any)=>v.attributeId===f.attributeId),reason});
 }
 records.push({product:p,category,eligible:true,values,initial:model.initial.values,evidence:model.evidence,review:completion??model.review,cardIssues:final.cardIssues,enrichment:await read(join(dir,'enrichment',p.id+'.json')),programErrors:errors,modelFinalHash:hash(model.final)});
}
await save(join(dir,'codex-adjudications.json'),{reviewedAt:new Date().toISOString(),method:'Codex检查程序错误、所有已填字段的证据与异常；DS负责并发初填、补证提议、复核和定点修复。未经运营准确率验收。',decisions});
await save(join(dir,'final.json'),{version:'trial-text-r1-final',cardHashes:Object.fromEntries(Object.entries(cards).map(([id,c])=>[id,hash(c)])),records});
console.log(JSON.stringify({products:records.length,eligible:records.filter(x=>x.eligible).length,decisions:decisions.length}));
