import {join,resolve} from 'node:path';
import {read,save,exists,hash,now} from '../runtime/store.ts';
import {checkCard} from '../domain/validate.ts';
import {registry} from '../domain/registry.ts';
const root=resolve(process.argv[2]!),rev=join(root,'revisions/closure-r3'),dir=join(rev,'naming-r1');
const cards=await read(join(dir,'base-cards.json')),records=await read(join(dir,'base-records.json'));
const decisions:any[]=[],migration:any={},alias:any[]=[],changes:any[]=[],mechanical:any[]=[];
const common=(await read(join(dir,'common-name-candidates.json'))).value;
const commonName=common.candidates.find((x:any)=>x.name==='型号/货号');
if(!commonName)throw Error('selected name must be an actual DeepSeek proposal');
// These suggestions add verbiage without resolving an actual ambiguity.
const retain=new Set(['cat.sheet_length','cat.sheet_size','seatpaper.mounting','seatpaper.material','seatpaper.layer_count','seatpaper.unfold_length','seatpaper.unfold_width','cat.roll.sales_unit','cat.roll.purpose_scene','cat.pack_form','acc.install']);
const renameText=(x:any,from:string,to:string):any=>typeof x==='string'?x.split(from).join(to):Array.isArray(x)?x.map(v=>renameText(v,from,to)):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,renameText(v,from,to)])):x;
const commonSource={id:'ds-naming-common-r1',kind:'reference_dataset',platform:'DeepSeek命名候选及Codex语义审查',locator:join(dir,'common-name-candidates.json'),text:JSON.stringify(common),hash:hash(common),retrievedAt:now(),mode:'model_proposal_not_external_fact'};
for(const d of cards){
 const base=structuredClone(d.card),originalNames=new Map<string,string>(base.attributes.map((a:any)=>[a.id,a.name]));
 const proposals=(await read(join(dir,'final-proposals',d.category.id+'.json'))).value.decisions;
 // Missing common decisions in a category response are covered by the explicit
 // common-model stage; never infer a new semantic definition from a missing row.
 for(const a of base.attributes){
  const p=proposals.find((p:any)=>p.attributeId===a.id);
  if(!p&&!a.id.startsWith('common.'))throw Error('unreviewed attribute '+d.category.name+' '+a.id);
  decisions.push({categoryId:d.category.id,category:d.category.name,attributeId:a.id,originalName:a.name,modelDecision:p??{action:'common_stage'},reviewed:true});
  if(a.id==='common.model'){
   d.card.attributes.find((x:any)=>x.id===a.id).name=commonName.name;
   d.sources.push(commonSource);
   d.card.provenance.find((x:any)=>x.attributeId===a.id).claims.push({sourceId:commonSource.id,relation:'修订',claim:'采用DeepSeek候选“型号/货号”；制造商范围保留定义，不收窄为只接纳型号。',quote:commonName.name});
  }else if(p?.action==='rename'&&p.proposedName!==a.name&&!retain.has(a.id)){
   d.card.attributes.find((x:any)=>x.id===a.id).name=p.proposedName;
  }
 }
 const finalPatch=join(dir,'patches-final',d.category.id+'.json'),firstPatch=join(dir,'patches',d.category.id+'.json');
 let patch:any=null,patchFile='';
 if(await exists(finalPatch)){patchFile=finalPatch;patch=(await read(finalPatch)).value;}
 else if(await exists(firstPatch)){patchFile=firstPatch;patch=(await read(firstPatch)).value;}
 if(patch){
  const source={id:'ds-naming-patch-'+d.category.id,kind:'reference_dataset',platform:'DeepSeek定点修订',locator:patchFile,text:JSON.stringify(patch),hash:hash(patch),retrievedAt:now(),mode:'model_proposal_not_external_fact'};
  d.sources.push(source);
  const removals=new Set(patch.removeIds);
  for(const r of patch.replacements){
   if(d.category.name==='生活用纸'&&r.attribute.id==='paper.package_level'&&!r.previousIds.length){
    r.previousIds=['paper.package_count','paper.rolls_per_pack'];
    mechanical.push({category:d.category.name,attributeId:r.attribute.id,reason:'新增包装层级依赖两个旧计数字段，补登记其来源映射；不改变模型名称或值。'});
   }
   if(r.attribute.id!==r.binding.attributeId||r.attribute.id!==r.rule.attributeId)throw Error('patch ID mismatch');
   if(!r.previousIds.length||r.previousIds.some((id:string)=>!originalNames.has(id)))throw Error('unknown previous ID '+d.category.name+' '+r.attribute.id+' '+JSON.stringify(r.previousIds));
   for(const [group,key]of [['attributes','attribute'],['bindings','binding'],['rules','rule']] as const){
    d.card[group]=d.card[group].filter((x:any)=>(group==='attributes'?x.id:x.attributeId)!==r.attribute.id);
    d.card[group].push(structuredClone(r[key]));
   }
   d.card.provenance=d.card.provenance.filter((p:any)=>p.attributeId!==r.attribute.id);
   d.card.provenance.push({attributeId:r.attribute.id,claims:[
    ...r.previousIds.flatMap((id:string)=>base.provenance.find((p:any)=>p.attributeId===id)?.claims??[]),
    {sourceId:source.id,relation:'修订',claim:r.reason,quote:r.attribute.name}
   ]});
  }
  for(const group of ['attributes','bindings','rules','provenance'])d.card[group]=d.card[group].filter((x:any)=>!removals.has(group==='attributes'?x.id:x.attributeId));
  const used=new Set<string>();
  for(const dim of d.card.dimensions)dim.attributeIds=dim.attributeIds.flatMap((id:string)=>{
   const linked=patch.replacements.filter((r:any)=>r.previousIds.includes(id)).map((r:any)=>r.attribute.id);
   return [...(!removals.has(id)?[id]:[]),...linked].filter((x:string)=>!used.has(x)&&!!used.add(x));
  });
  for(const m of patch.migrations)migration[m.productId]={removeIds:patch.removeIds,values:structuredClone(m.values)};
 }
 const a=(id:string)=>d.card.attributes.find((a:any)=>a.id===id),b=(id:string)=>d.card.bindings.find((a:any)=>a.attributeId===id),r=(id:string)=>d.card.rules.find((a:any)=>a.attributeId===id);
 if(d.category.name==='厨房纸巾'){
  const names=(await read(join(dir,'kitchen-count-names.json'))).value.names;
  for(const n of names)if(a(n.attributeId))a(n.attributeId).name=n.name;
  // Select an existing DS candidate whose label does not imply 抽=张. IDs and
  // category definitions remain separate; this is not a cross-category merge.
  const washCategory=cards.find((c:any)=>c.category.name==='洗脸巾');
  const wash=(await read(join(dir,'patches-final',washCategory.category.id+'.json'))).value;
  const perRoll='cat.kitchen_paper.per_roll_section_count',perPack='cat.kitchen_paper.per_pack_sheet_count',total='cat.kitchen_paper.sales_total_quantity';
  a(perPack).name=wash.replacements.find((x:any)=>x.attribute.id==='cat.count_per_pack').attribute.name;
  a(perPack+'.count_unit').name=wash.replacements.find((x:any)=>x.attribute.id==='cat.count_per_pack.count_unit').attribute.name;
  for(const [id,scope]of [[perRoll,'同质卷状形态'],[perPack,'同质抽取式形态']] as const){
   a(id).unit='见配套属性 '+id+'.count_unit';
   b(id).condition=`当前SKU为${scope}时适用；存在对应形态但缺数值记missing，形态冲突记待确认，明确为另一形态才不适用。`;
   b(id+'.count_unit').condition=b(id).condition;
  }
  a(perPack).definition='抽取式厨房纸巾单个独立包装内的数量，数值与计数单位配套；原文为抽或张时分别记录，不默认等价。';
  a(perPack).describes='抽取式厨房纸巾单包内的计数';
  b(total).condition='当前SKU具有可明确界定的同质销售计数对象时适用；销售总量缺失为missing，混装或范围冲突待确认，不以有无证据决定适用性。';
  b(total+'.unit').condition=b(total).condition;
  a(total).definition='整个销售单元内按原文明确对象计数的总数，单位由配套字段记录（如卷、包、粒）；不把外包装箱数冒充内容物数量，不默认粒等于卷。';
  const original='cat.kitchen_paper.absorbency_original_text';
  a(original).excludedMeanings=['不含倍率数字的泛化功能词','克重','厚度'];
  b(original).condition='';
  a(original).definition='商品关于吸收倍率的原文标称。明确含数字倍率时保留完整片段，含义不明时不猜吸油或吸水；不含倍率的“吸油吸水”等泛化卖点不填。';
  r(original).preconditions=['原文存在明确数字倍率的连续片段'];
  for(const record of records.filter((x:any)=>x.product.categoryId===d.category.id)){
   const m=migration[record.product.id],v=(id:string)=>m.values.find((v:any)=>v.attributeId===id);
   if(record.product.id.startsWith('a00ee8c6'))for(const id of [perRoll,perRoll+'.count_unit']){
    Object.assign(v(id),{status:'missing',value:'',explanation:'原文2卷×4提证明卷状商品；缺少单卷节数及单位应记缺证，不是不适用。'});
   }
   if(record.product.id.startsWith('a0e7a638'))for(const id of [perRoll,perRoll+'.count_unit']){
    Object.assign(v(id),{status:'applicability_unknown',value:'',explanation:'资料存在抽式/卷状形态冲突，卷状属性适用性待确认；标题明示单包60抽另行保留。'});
   }
   if(record.product.id.startsWith('aa821ce1')){
    const old=record.values.find((v:any)=>v.attributeId==='cat.kitchen_paper.sales_total');
    for(const [id,value]of [[total,'6'],[total+'.unit','粒']] as const){
     Object.assign(v(id),{status:'filled',value,evidence:old.evidence,explanation:'原文85节×6粒装明确销售总数6粒，沿用此前核实的计数；不把粒改成卷，也不因交易单位箱而抹掉直接值。'});
    }
   }
   if(v(original)?.status==='filled'&&!/\d+\s*倍/.test(v(original).value)){
    Object.assign(v(original),{status:'missing',value:'',explanation:'只有吸油/吸水功能词，未标称倍率；不填入吸收倍率原文字段。'});
   }
  }
  mechanical.push({category:d.category.name,reason:'修正DS把缺证当不适用、把泛化功能词当倍率、单位硬写抽/节及抹掉6粒直接值的问题；数量名称采用DeepSeek已给出的每包数量/每包计数单位，类目定义不合并。'});
 }
 if(d.category.name==='盒装抽纸'){
  a('cat.pkg.pack_form').enumPolicy=a('cat.pkg.pack_form').enumPolicy.replace('由cat.pkg.packs_per_case表达','外层内含包数分别由cat.pkg.packs_per_tier与cat.pkg.packs_per_box表达；包装存在性按各字段绑定判断');
  for(const [id,tier]of [['cat.pkg.packs_per_tier','提'],['cat.pkg.packs_per_box','箱']] as const){
   b(id).condition=`当前SKU存在${tier}级包装时适用，存在但数量缺失记missing；存在性不明记applicability_unknown，明确无该层级才not_applicable。`;
  }
  for(const record of records.filter((x:any)=>x.product.categoryId===d.category.id)){
   const m=migration[record.product.id];
   for(const v of m.values)if(v.status==='missing'&&/存在性不明|无提级|无箱级/.test(v.explanation))v.status='applicability_unknown';
   if(record.product.id.startsWith('fecf15ba')){
    const prior=(await read(join(dir,'patches',d.category.id+'.json'))).value.migrations.find((m:any)=>m.productId===record.product.id).values.find((v:any)=>v.attributeId.endsWith('.tie'));
    const v=m.values.find((v:any)=>v.attributeId==='cat.pkg.packs_per_tier');
    Object.assign(v,prior,{attributeId:v.attributeId,explanation:'原文3盒×8提为每提3盒，盒为本商品独立销售包。采纳DS第一轮有证据的迁移，不因旧版漏填继续留空。'});
   }
  }
  mechanical.push({category:d.category.name,reason:'采用DS拆分的提/箱两个字段；修正包装存在性不明状态，恢复标题3盒×8提支持的每提3包。'});
 }
 // All generic name references in authored semantics follow the chosen label.
 // Historical model/source quotations remain byte-for-byte unchanged.
 for(const x of d.card.attributes){
  const old=originalNames.get(x.id);
  if(old&&old!==x.name){
   d.card.rules=d.card.rules.map((rule:any)=>renameText(rule,old,x.name));
   d.card.bindings=d.card.bindings.map((binding:any)=>renameText(binding,old,x.name));
   alias.push({categoryId:d.category.id,attributeId:x.id,oldName:old,name:x.name});
  }
 }
 changes.push({categoryId:d.category.id,name:d.category.name,originalCount:base.attributes.length,newCount:d.card.attributes.length});
 d.namingRevision={version:'naming-r1',sourceHash:hash(base),model:'DeepSeek official deepseek-flash',reviewer:'Codex',status:'待运营审核',aliases:alias.filter(x=>x.categoryId===d.category.id)};
}
// Further evidence-level adjudications are performed before publication.
await save(join(dir,'candidate-cards.json'),cards);
await save(join(dir,'candidate-migration.json'),migration);
await save(join(dir,'naming-audit.json'),{decisions,aliases:alias,changes,mechanical,commonNameChoice:{...commonName,reason:'从DeepSeek候选中采纳业务常见写法，避免收窄含义及过长堆词。'}});
console.log(JSON.stringify({reviewed:decisions.length,renamed:alias.length,cards:cards.length,bindings:cards.reduce((n:number,d:any)=>n+d.card.attributes.length,0),migratedProducts:Object.keys(migration).length}));
