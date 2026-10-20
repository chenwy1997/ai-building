import {join,resolve} from 'node:path';
import {read,save} from '../runtime/store.ts';
const run=resolve(process.argv[2]!),dir=join(run,'trial');
const final=await read(join(dir,'final.json')),base=await read(join(run,'report-data.json')),cats=await read(join(run,'selected-categories.json'));
const screens=await read(join(dir,'screen-final.json')),allProducts=await read(join(dir,'products.json'));
const decisions=await read(join(dir,'codex-adjudications.json')),ledgerBefore=await read(join(dir,'ledger-before.json'));
const beforeCost=ledgerBefore.entries.reduce((s:number,e:any)=>s+(e.charged??0),0);
const status:any={filled:'已填写',missing:'缺证',conflict:'来源冲突',not_applicable:'不适用',applicability_unknown:'条件待确认'};
const reason:any={none:'',source_missing:'资料缺失',source_conflict:'来源冲突或参数疑似错配',unit_scope_unclear:'单位或对象口径不明',identity_unconfirmed:'同品未确认',condition_unknown:'适用条件待确认',rule_ambiguous:'规则口径待完善',not_applicable:'不适用'};
const req:any={always:'必填',conditional:'条件必填',optional:'可选'};
const cs:any={matched:'归属符合',wrong:'错挂',uncertain:'归属待确认'};
const en:any={in:'枚举内',out:'枚举外候选',not_enum:'非枚举字段',unknown:'未确认'};
const trial:any={sheets:[],metrics:[],reasons:[],attrStats:[],products:[],screens:[],decisions:[],issues:[],summary:{}};
const dimensions=new Map(),bindings=new Map(),attrs=new Map();
for(const c of cats){
 const card=(await read(join(run,'categories',c.id,'result.json'))).card;
 dimensions.set(c.id,card.dimensions.flatMap((d:any)=>d.attributeIds));
 for(const a of card.attributes)attrs.set(c.id+':'+a.id,a);
 for(const b of card.bindings)bindings.set(c.id+':'+b.attributeId,b);
}
const flat:any[]=[];
for(const c of [...cats].sort((a:any,b:any)=>['软包抽纸','湿纸巾','纸巾盒'].indexOf(a.name)-['软包抽纸','湿纸巾','纸巾盒'].indexOf(b.name))){
 const rows:any[]=[];
 for(const r of final.records.filter((r:any)=>r.product.categoryId===c.id)){
  const p=r.product;
  for(const aid of dimensions.get(c.id)){
   const a:any=attrs.get(c.id+':'+aid),b:any=bindings.get(c.id+':'+aid),v=r.values.find((v:any)=>v.attributeId===aid);
   const initial=r.initial?.find((v:any)=>v.attributeId===aid);
   const included=r.eligible&&v.status!=='not_applicable'?1:0,required=included&&b.requiredness!=='optional'?1:0,filled=included&&v.status==='filled'?1:0;
   const jdUsed=filled&&v.evidence.some((e:any)=>e.id.startsWith('jd:'));
   const textSource=filled?(jdUsed?(v.evidence.some((e:any)=>!e.id.startsWith('jd:'))?'三横+上游京东':'上游京东'):'三横标题/规格/详情'):'';
   const quotes=[...new Set((v?.evidence??[]).map((e:any)=>e.quote))].join('\n');
   const locators=[...new Set((v?.evidence??[]).map((e:any)=>e.id))].join('\n');
   const jdNote=jdUsed?(!initial||initial.status!=='filled'?'京东参与补出':initial.value!==v.value?'复核后改值（含京东）':'京东佐证'):'';
   const numValue=filled&&a.fieldType==='数值'?Number(v.value):filled&&a.fieldType==='是否'?(v.value==='true'?'是':'否'):v?.value??'';
   const row=[rows.length+1,c.id,c.path,aid,a.name,p.id,p.title,typeof p.saleSpec==='string'?p.saleSpec:JSON.stringify(p.saleSpec),req[b.requiredness],a.fieldType,a.unit,
    r.eligible?status[v.status]:'归属排除',numValue,v?.rawValue??'',r.eligible?en[v.enumStatus]:'',a.enumValues.join('；'),
    textSource,quotes,v?.calculation.operator!=='none'?v?.calculation.formula??'':'',r.eligible?reason[v.reasonCode]:'归属排除',v?.explanation??r.category.reason,
    cs[r.category.status],r.category.targetPath??'',r.category.targetId??'',r.category.targetStatus??'待确认',
    initial?.status==='filled'?initial.value:'',jdNote,p.id=== 'caeed119-5503-4a25-b9df-49099e307b72'?'补充：非京东OEM':productsOriginal(p.id)?'原始随机样本':'补充：随机候选筛选',
    included,required,filled,filled&&required?1:0,'待运营审核','',locators];
   rows.push(row);flat.push({c,a,b,r,v,included,required,filled,jdUsed,jdNote});
  }
  const e=r.enrichment;
  trial.products.push([trial.products.length+1,c.id,c.path,p.id,p.title,typeof p.saleSpec==='string'?p.saleSpec:JSON.stringify(p.saleSpec),cs[r.category.status],r.category.reason,r.category.targetPath??'',r.category.targetId??'',r.category.targetStatus??'',r.eligible?'是':'否',
   e?.mode??'',e?.candidates?.map((x:any)=>x.skuId).join('；')??'',e?.status??'未补证（归属排除）',e?.candidates?.map((x:any)=>x.identity?.reason??'').join('\n')??'',e?.candidates?.map((x:any)=>`https://item.jd.com/${x.skuId}.html`).join('\n')??'',r.review?'DeepSeek已实际复核':'归属排除，未试填',p.id.startsWith('caeed')?'京东检索0候选；DS网页检索3个品牌泛页，未找到可核实同品；未用于填写。':'']);
 }
 trial.sheets.push({name:c.name,rows,categoryId:c.id});
 const entries=flat.filter(x=>x.c.id===c.id),rs=final.records.filter((r:any)=>r.product.categoryId===c.id),n=(f:any)=>entries.reduce((s:number,x:any)=>s+Number(f(x)),0);
 trial.metrics.push([c.name,rs.length,rs.filter((r:any)=>r.eligible).length,rs.filter((r:any)=>!r.eligible).length,n((x:any)=>x.included),n((x:any)=>x.filled),null,n((x:any)=>x.required),n((x:any)=>x.required&&x.filled),null,n((x:any)=>x.r.eligible&&x.v.status==='not_applicable'),n((x:any)=>x.filled&&x.v.enumStatus==='out'),n((x:any)=>x.jdNote==='京东参与补出')]);
}
function productsOriginal(id:string){return allProducts.slice(0,30).some((p:any)=>p.id===id);}
for(const [code,label] of Object.entries(reason).filter(([k])=>!['none','not_applicable'].includes(k))){
 const count=flat.filter(x=>x.included&&!x.filled&&x.v.reasonCode===code).length;
 trial.reasons.push([label,count,null,flat.filter(x=>x.required&&!x.filled&&x.v.reasonCode===code).length,null]);
}
for(const c of trial.sheets)for(const aid of dimensions.get(c.categoryId)){
 const es=flat.filter(x=>x.c.id===c.categoryId&&x.a.id===aid),a=es[0].a,b=es[0].b;
 const gap=es.filter(x=>x.included&&!x.filled),rc=new Map();
 for(const x of gap)rc.set(reason[x.v.reasonCode],(rc.get(reason[x.v.reasonCode])??0)+1);
 const outside=[...new Set(es.filter(x=>x.filled&&x.v.enumStatus==='out').map(x=>x.v.value))].join('；');
 trial.attrStats.push([trial.attrStats.length+1,c.categoryId,es[0].c.path,aid,a.name,req[b.requiredness],es.filter(x=>x.r.eligible).length,es.filter(x=>x.included).length,es.filter(x=>x.filled).length,null,gap.length,[...rc].map(([k,v])=>`${k}：${v}`).join('；'),a.enumValues.join('；'),outside,outside?'候选值待审核；不自动扩枚举':'',es.filter(x=>x.jdNote==='京东参与补出').length]);
}
for(const p of allProducts){
 const d=screens.find((x:any)=>x.productId===p.id),included=final.records.find((r:any)=>r.product.id===p.id);
 trial.screens.push([trial.screens.length+1,p.categoryId,p.id,p.title,typeof p.saleSpec==='string'?p.saleSpec:JSON.stringify(p.saleSpec),productsOriginal(p.id)?'原始随机30件':'补抽纸巾盒60候选',included?'纳入明细':'仅筛选候选',included?cs[included.category.status]:cs[d.status],included?included.category.reason:d.reason,
  included?included.category.targetId??'':d.targetId,included?'已作试填归属复核':'DS筛选意见，非最终迁移决定']);
}
for(const d of decisions.decisions){
 const r=final.records.find((r:any)=>r.product.id===d.productId);
 trial.decisions.push([trial.decisions.length+1,d.productId,r?.product.title??'',d.kind,d.attributeId,JSON.stringify(d.before),JSON.stringify(d.after),d.reason]);
}
// Consolidated, actionable card issues. These are proposed changes, not silently published standards.
trial.issues=[
 ['R01','软包抽纸','sheets_per_pack','旧合成反例错误：24包100抽3层被称无法区分抽/张','按完整纸面巾标题的单规格语境读取100抽/包；没有混装/总量/冲突迹象时可用。','修订旧反例；标题仅写总抽数时仍不可均摊。','f51aaac2'],
 ['R02','软包抽纸、湿纸巾','mixed_pack / 总包数 / 总片数','未逐字写无赠品即拒算，模型过度保守','明确单规格×包装数量可计算；出现赠品、混装、规格冲突即暂停相关计算。','统一前提表述，避免模型无限补证。','a2e5d580；d9ed7bfe'],
 ['R03','纸巾盒','tissue_compatibility','现有选项未定义多对象并存，模型误判冲突或只保留一个','本次保留抽纸/餐巾纸/洗脸巾等有证据的复合候选。','明确选项单选/多选；兼容关系允许多值，不等于所有纸巾通用。','bb6803c2；fca0c9f8'],
 ['R04','纸巾盒','style / placement_method','对商品名称语义过度保守，明确风格/桌面词仍留空','采用直接风格词和桌面放置词；酒店/客厅等仅场景词不能推导安装。','补正反例，风格复合候选单独审核。','b395e3bb；bb42c7a8'],
 ['R05','软包抽纸','surface_embossing','印花与压花被误判同义或互斥；无印花被误扩为两者均无','两工艺可并存；单一否定只否定对应工艺。','建议拆成是否压花、是否印花，或允许部分已知状态；不靠扩枚举掩盖结构问题。','dfb3c105；f530b5ed'],
 ['R06','湿纸巾','layer_count / fragrance / 单片尺寸','京东同品标题正确，类目/参数组却像干抽纸','对VW1040的疑似错配参数组暂不采信；原三横80片×6包仍可填写。','同品核对与字段质量检查分两步；不要把上游当绝对权威。','d9ed7bfe'],
 ['R07','湿纸巾','fragrance','上游仅有有香型，不能确定具体香味','有香型作为枚举外候选，不能填无香或猜具体香味。','增加有香但香味未注明层级，或拆有无香与具体香味。','c187dc23'],
 ['R08','纸巾盒','length_mm / width_mm / height_mm','18.5×12.5×10cm未说明方向，三维都留空','保留原始尺寸，不能擅自把三个数分配长宽高。','可增加原始尺寸文本/方向确认状态；尺寸对象仍须区分盒体与包装。','fca0c9f8'],
 ['R09','纸巾盒','main_material','木制+皮革可能是覆面与基体而非冲突','原词保留，主体结构关系不明先不选主材。','增加材料部位/覆面信息；棉布可归布艺，不算枚举缺口。','d6444762；f25d1db8'],
 ['R10','三类','来源交接','同品核对状态未传入后续复核导致误删证据','已通过verifiedIdentity传递准入SKU及证据ID，受影响结果已定点重验。','已固化execution-notes与流程输入；仍保留旧失败记录。','trial/execution-notes.ts'],
 ['R11','三类','必填与缺项','只有已知事实算已填写；条件未知不能默认不适用','条件未知保守计入总体和条件必填分母；已证实不适用排除。','填写率仅测资料覆盖和模板适配，非准确率或生产达标率。','全样本'],
 ['R12','软包抽纸','sheet_size','SKU字段纸张尺寸未逐字注明展开','本次按明确纸张长宽字段采纳，未用包装尺寸；来源及原词全保留。','需运营抽检展开/折叠口径，必要时补来源对象字段。','aac92398；f51aaac2；f530b5ed'],
];
trial.summary={products:final.records.length,eligible:final.records.filter((r:any)=>r.eligible).length,rows:flat.length,
 total:flat.filter(x=>x.included).length,filled:flat.filter(x=>x.filled).length,required:flat.filter(x=>x.required).length,requiredFilled:flat.filter(x=>x.required&&x.filled).length,
 notApplicable:flat.filter(x=>x.r.eligible&&x.v.status==='not_applicable').length,enumOutside:flat.filter(x=>x.filled&&x.v.enumStatus==='out').length,
 jdNew:flat.filter(x=>x.jdNote==='京东参与补出').length,jdSupported:flat.filter(x=>x.jdUsed).length,
 cost:base.summary.costUpperEstimate,beforeCost,trialCost:base.summary.costUpperEstimate-beforeCost,reviewed:final.records.filter((r:any)=>r.eligible&&r.review).length};
// Accounting uses ledger entry actual schema, not guessed alternate property names.
const before=(await read(join(dir,'ledger-before.json'))).entries;
const cur=(await read(join(run,'ledger.json'))).entries;
const priorIds=new Set(before.map((e:any)=>e.id));
trial.summary.trialCost=cur.filter((e:any)=>!priorIds.has(e.id)).reduce((s:number,e:any)=>s+(e.charged??0),0);
await save(join(dir,'report.json'),trial);
console.log(JSON.stringify(trial.summary));
