/** Explicit Codex decisions after inspecting current model findings and sample evidence. */
import {join,resolve} from 'node:path';
import {read,save,exists,hash} from '../runtime/store.ts';
import {normalizeCardContract} from '../domain/normalize-card.ts';
import {checkCard,applyRepair} from '../domain/validate.ts';
import {checkSharedRules} from '../domain/shared-rules.ts';
import {registry} from '../domain/registry.ts';
const root=resolve(process.argv[2]!),rev=join(root,'revisions/closure-r3'),f=await read(join(rev,'frozen.json')),gate=await read(join(rev,'pilot-gate.json'));
const seed=(await read(join(rev,'categories',gate.cards[0].categoryId,'result.json'))).card;
const questions:Record<string,string[]>={
 '一次性日杂':['运营需确认纸杯/纸盘等一次性纸餐具与V2“餐具”（8e1d0430-00e2-4caa-b7d7-8dfa27ad8690）的承接边界；确认前仅作为属性候选，不自动迁移或发布本类。'],
 '生活用纸':['本类与既有具体纸品末级的兜底边界需运营确认；无法细分的真实商品先标待确认，不用本类绕过错挂审核。'],
 '枕巾':['确认本纸品分支的枕巾是否同时承接纺织可重复用品；当前卡按枕面覆盖物本体建模，保留材质和是否可重复使用，不擅改类目树。'],
 '坐垫纸':['套罩式商品须核实是否纸基一次性卫生隔离用品；材质/可重复性未知时商品归属待确认。'],
};
const cards:any[]=[],summary:any[]=[];
for(const c of f.branch.filter((c:any)=>c.isLeaf)){
 const dir=join(rev,'categories',c.id),p=join(dir,'result.json');if(!await exists(p))continue;
 const d=await read(p);if(gate.cards.some((x:any)=>x.categoryId===c.id)){cards.push(d.card);summary.push({category:c,status:d.status,attributes:d.card.attributes.length});continue;}
 if(await exists(join(dir,'missing-rules.json')))d.card.rules.push(...(await read(join(dir,'missing-rules.json'))).value.rules);
 const normalized=normalizeCardContract(d.card,seed.rules),card=normalized.card,changes:any[]=[...normalized.changes];
 const sources=await read(join(dir,'evidence.json'));
 const codexSource={id:'codex-r3-adjudication',kind:'model_knowledge',platform:'Codex',locator:'本类adjudicated.json中的显式裁定',text:'基于已登记商品原文、业务规则及模型意见作出的建模裁定，非外部标准证明',hash:hash('codex-r3-adjudication'),retrievedAt:'2026-10-20',mode:'adjudication'};
 sources.push(codexSource);
 const note=(id:string,reason:string)=>changes.push({kind:'semantic',attributeId:id,reason});
 const binding=(id:string)=>card.bindings.find((b:any)=>b.attributeId===id),rule=(id:string)=>card.rules.find((r:any)=>r.attributeId===id);
 const core=(a:any,reason:string,condition='')=>{const b=binding(a.id);b.requiredness=condition?'conditional':'always';b.condition=condition;b.rationale=reason+'；缺证如实计缺项，不能以缺证降级。';note(a.id,reason);};
 core(card.attributes.find((a:any)=>a.id==='common.brand'),'品牌是展示和搜索识别的公共核心属性');
 binding('common.model').requiredness='optional';binding('common.model').condition='';binding('common.model').rationale='制造商型号有明确值则用于精确识别；并非所有日用纸品具有型号，不以平台SKU冒充。';
 const countPattern=/^(每包(?:片数|张数|数量|抽数)|每包装数量|每包片数（抽\/张）|每包片数\/抽数|销售总(?:包数|卷数|数量)|销售包数|每销售单元数量|销售数量)$/;
 for(const a of card.attributes){const b=binding(a.id);
  if(a.name==='层数'||a.name==='纸张层数'){
   if(!['一次性日杂','生活用纸','枕巾','洗脸巾','坐垫纸','卷纸配件','擦手纸配件'].includes(c.name))core(a,'纸张层数影响纸品规格识别与比较');
   else if(c.name==='枕巾'){b.requiredness='optional';b.condition='';note(a.id,'纺织与纸基枕巾结构不同，层数保留可选，未明示不默认1层');}
  }
  if(countPattern.test(a.name))core(a,'包装数量是采购规格比较的核心口径',/每包|每包装/.test(a.name)?'同SKU包装内计数口径一致时必填；异规格组件分别记录，不能均摊；条件未知保留适用性待确认。':'');
  if(/每卷节数|卷长|单卷长度|单卷克重|单卷重量/.test(a.name)){b.requiredness='optional';b.condition='';b.rationale='补充单卷规格比较；长、节数和重量是不同量，不因另一种规格已填而判本字段不适用。';note(a.id,'取消按来源标注决定适用性的条件；不同物理量可共存');}
  if(/每提卷数|每提包数|每包卷数/.test(a.name)){b.requiredness='conditional';b.condition='实际存在提/袋等对应中间包装层级时必填；存在但缺数为missing；层级未知待确认；明确无该层级才不适用。';note(a.id,'按实际包装层级确定适用性，而非文字是否出现');}
  if(/整箱卷数|每箱卷数|装箱包数/.test(a.name)){b.requiredness='conditional';b.condition='当前SKU销售单元确认为整箱时必填；非整箱不适用；销售单位无法确定时适用性待确认。';note(a.id,'整箱数量不强加给零售非整箱SKU');}
  if(/适配分配器/.test(a.name)){b.requiredness='optional';b.condition='';note(a.id,'兼容型号仅补充检索，不能因来源有型号才触发必填');}
  if(/安装方式/.test(a.name)&&c.name==='坐垫纸'){b.requiredness='conditional';b.condition='实际需要挂架/分配器固定使用的结构适用；无此结构不适用；结构无法判断待确认。';}
  if(a.name==='是否套装'){b.requiredness='optional';b.condition='';}
  if(/套装组合|组合明细/.test(a.name)&&b.requiredness==='conditional')b.condition='对应是否套装/异规格组合=true时必填；明确false则不适用；未知则适用性待确认，不当不适用。';
 }
 if(c.name==='中心抽大卷纸'){
  const a=card.attributes.find((a:any)=>/适配分配器/.test(a.name)),p=card.provenance.find((p:any)=>p.attributeId===a.id);
  p.claims=p.claims.filter((x:any)=>!x.sourceId.startsWith('sample-'));p.claims.push({sourceId:codexSource.id,relation:'提出',claim:'保留明确分配器兼容型号作为可选识别需求；标题T9不自动作为适配证据。',quote:''});note(a.id,'T9没有明确分配器适配关系，不作为该字段支持证据');
 }
 if(c.name==='一次性日杂'){
  card.boundary.includes='本纸品分支的一次性纸制/纸基日用品候选范围；与V2餐具类目交叉的纸餐具归属待运营确认，不自动定类。';
  card.boundary.excludes.push('非纸主体的竹木筷、塑料餐具、纺织内裤不能仅凭一次性进入纸品分支。');
  for(const s of d.sampleDecisions??[])if(s.productId==='c2b9a837-1723-4a24-b995-579d43adc2b8'){s.status='uncertain';s.reason='标题卫生筷不能证明纸基材质，且V2存在餐具，原matched不成立，待材质和归属确认。';}
  const a=card.attributes.find((a:any)=>/品类/.test(a.name));if(a)core(a,'商品具体形态是宽类目识别核心；类目边界未确认不等于可免除核心属性');
  for(const a of card.attributes){const b=binding(a.id);if(/单只容量/.test(a.name))b.condition='杯/碗/盒等盛装类实际适用容量时必填；非盛装物不适用，容量缺证仍记录缺项。';if(a.name==='单件尺寸'){b.requiredness='optional';b.condition='';}}
 }
 if(c.name==='坐垫纸'){card.boundary.excludes.push('非纸基、非一次性或可重复使用的布质/硅胶座圈套不能作为坐垫纸。');rule('seatpaper.type').directRule+=' 套罩式须有纸基一次性证据，材质或重复使用性未知先复核商品归属。';}
 if(c.name==='平板卫生纸'){const a=card.attributes.find((a:any)=>a.name==='纸张形态');core(a,'平切叠片形态是本类核心识别依据，不因缺描述排除缺项统计');}
 if(c.name==='枕巾'){const a=card.attributes.find((a:any)=>a.name==='材质成分及含量');binding(a.id).condition='主体为纺织纤维时适用；缺少含量为missing，非纺织明确不适用，主体材质未知为适用性待确认。';}
 if(c.name==='洗脸巾'){
  let prior=(await read(join(dir,'cards.json'))).value;if(await exists(join(dir,'repair1.json')))prior=applyRepair(prior,(await read(join(dir,'repair1.json'))).value);
  for(const id of ['cat.material','cat.printed'])if(!card.attributes.some((a:any)=>a.id===id)){
   for(const g of ['attributes','bindings','rules','provenance']){const item=prior[g].find((x:any)=>(g==='attributes'?x.id:x.attributeId)===id);if(!item)throw Error('missing restored '+id);card[g].push(structuredClone(item));}
   note(id,'恢复被模型删除但其维度仍引用的必要/合理属性；不能靠删属性消除来源问题');
  }
  const a=card.attributes.find((a:any)=>a.id==='cat.material');a.enumValues=a.enumValues.filter((v:string)=>!/棉柔/.test(v));a.enumPolicy='只有全棉/100%棉等明确成分可填写纯棉；棉柔是营销手感词，不证明非纯棉，也不证明纯棉。明确枚举外基材保留原文候选。';
  rule(a.id).directRule='只按明确原料成分提取基材；100%棉/全棉可填对应纯棉枚举，棉柔不能单独判纯棉或非纯棉。';core(a,'基材影响洗脸巾的采购比较与筛选');
  const sz=card.attributes.find((a:any)=>a.name==='单片尺寸');core(sz,'单片尺寸影响洁面使用规格比较');
 }

 // Category-specific semantic decisions from the full model review.
 if(c.name==='生活用纸'){
  for(const a of card.attributes){const b=binding(a.id);
   if(a.name==='是否商用大盘纸'){b.requiredness='optional';b.condition='';rule(a.id).directRule='只按明确商用大盘纸用途/规格描述填写；不凭克重或米数阈值推断。若已确认属于具体大卷纸末级，则先转归属复核。';}
   if(a.name==='销售总卷数'){b.requiredness='conditional';b.condition='实际为卷状纸且销售计数单位为卷时必填；非卷状不适用；是否卷状未知为适用性待确认。';}
   if(a.name==='中间包装单元数量'){b.requiredness='conditional';b.condition='实际存在同一类型中间包装层级时必填；层级不明待确认，不将箱和提合并计数。';}
   if(a.name==='每包（每提）卷数'){b.requiredness='conditional';b.condition='实际存在包或提中间包装时必填；只在同一层级记录，层级不明待确认。';}
   if(a.name==='是否有芯')b.condition='实际为卷状纸（含盘纸）时必填；非卷状不适用；形态未知待确认。';
  }
 }
 if(c.name==='卷纸配件'){
  card.dimensions.unshift({name:'公共识别',purpose:'品牌及制造商型号识别',attributeIds:['common.brand','common.model']});
  binding('acc.core_id').condition='实际承载有芯卷纸且纸芯内径影响安装时必填；无芯承载不适用；结构未知待确认。';
  binding('acc.max_roll_dia').requiredness='optional';binding('acc.max_roll_dia').condition='';
  rule('acc.pack_qty').onMissing='销售单元件数不明记unknown；明确单件销售填1，不能以单件为由留空。';
  rule('acc.install').onConflict='明确支持多种安装方式时按枚举逐项填写，以中文分号分隔；互相冲突则conflict。';
  card.attributes.find((a:any)=>a.id==='acc.install').enumPolicy='允许同商品明确支持的多值，中文分号分隔逐项检验；未覆盖原词保留枚举外候选；缺证unknown。';
 }
 if(c.name==='大卷擦手纸'){
  const a=card.attributes.find((a:any)=>a.name==='包装形式');a.enumValues=a.enumValues.filter((x:string)=>x!=='其他');note(a.id,'移除与枚举外保留规则矛盾的其他；散装/袋装作为未验证候选，不宣称已有样本覆盖。');
  const t=card.attributes.find((a:any)=>a.name==='擦手纸类型');core(t,'卷体有芯/无芯等结构影响分配器适配；未知计缺项');
 }
 if(c.name==='抽式擦手纸'){
  binding('cat.bundle_count').condition='实际存在提级包装时必填；未知待确认；明确无该层级不适用。';
  const id='cat.sheet_size';card.attributes.push({id,name:'单张展开尺寸',kind:'类目特性属性',definition:'单张擦手纸完全展开的长×宽，统一mm；与折叠尺寸、包装尺寸区分。',describes:'单张纸本体',fieldType:'文本',unit:'',excludedMeanings:['包装尺寸','折叠后尺寸'],enumValues:[],enumPolicy:'尺寸文本自带mm；例如200×210 mm，不能把厘米原值当毫米。'});
  card.bindings.push({attributeId:id,requiredness:'always',condition:'',valueLevel:'SKU',scope:'当前SKU的单张纸本体',uses:['展示','筛选'],rationale:'单张大小影响采购比较；缺少样本值不能成为不建模核心规格的理由。'});
  card.rules.push({attributeId:id,directRule:'提取明确单张展开长宽，cm乘10转换mm；折叠尺寸或包装尺寸不能代入。',operator:'direct',inputs:[],formula:'',preconditions:['确认尺寸对象为单张展开纸'],onMissing:'unknown，保留缺项。',onConflict:'conflict，保留原文来源。',examples:[{input:'synthetic：单张展开20×21cm',expected:'200×210 mm',reason:'明确单张对象与单位。'},{input:'synthetic：外箱40×30×50cm',expected:'unknown',reason:'不是单张纸尺寸。'}]});
  card.provenance.push({attributeId:id,claims:[{sourceId:codexSource.id,relation:'提出',claim:'单张尺寸是纸品采购规格核心，不能仅因样本未给数值省略定义。',quote:''}]});card.dimensions.push({name:'单张规格',purpose:'比较纸张本体尺寸',attributeIds:[id]});note(id,'补回被以缺资料为由遗漏的尺寸规格');
 }
 if(c.name==='餐巾纸'){
  // Non-confirmed sample provenance cannot be labelled supporting evidence.
  for(const p of card.provenance){const removed=p.claims.filter((x:any)=>x.sourceId.startsWith('sample-'));if(removed.length){p.claims=p.claims.filter((x:any)=>!x.sourceId.startsWith('sample-'));p.claims.push({sourceId:codexSource.id,relation:'提出',claim:'本属性作为餐巾纸建模候选保留，原样本用途归属不足以证明成立；不把面巾纸样本当本类已验证证据。',quote:''});note(p.attributeId,'撤下归属不足的商品样本支持关系，原引用保留在DS历史结果。');}}
  const drop='cat.pack_form';for(const g of ['attributes','bindings','rules','provenance'])card[g]=card[g].filter((x:any)=>(g==='attributes'?x.id:x.attributeId)!==drop);for(const dim of card.dimensions)dim.attributeIds=dim.attributeIds.filter((x:string)=>x!==drop);note(drop,'删除与单包容器/外层包装重复且混层的汇总字段，保留两个明确层级字段。');
  binding('cat.sheet_count_per_pack').requiredness='conditional';binding('cat.sheet_count_per_pack').condition='实际以抽取单元计量时必填；以张计量且无抽张对应则仅记录张数字段，不能转换；口径未知待确认。';
  binding('cat.sheet_count_per_pack_zhang').condition='实际以单张计量时必填；以抽计量且无抽张对应则记录抽数字段，不能转换；口径未知待确认。';
  rule('cat.sheet_size').directRule+=' 值本身携带mm，不再另填单位列；正方形但无边长不能猜测数值。';
 }
 // Split mixed count units into an explicit paired option field; never conflate sheet/draw/piece.
 for(const a of [...card.attributes])if(a.fieldType==='数值'){
  const units=[...new Set((a.unit.match(/[片抽张节只双套]/g)??[]) as string[])];if(units.length<2)continue;
  const existing=card.attributes.find((x:any)=>x.id!==a.id&&/计数单位|计量单位/.test(x.name)&&units.every(u=>x.enumValues.includes(u)));
  const id=existing?.id??a.id+'.count_unit';a.unit='见配套属性 '+id;
  if(!existing){
   card.attributes.push({id,name:a.name+'计数单位',kind:'类目特性属性',definition:'与'+a.name+'配套的原文计数单位；不同计量单位不能默认换算。',describes:a.describes+'的计数单位',fieldType:'选项',unit:'',excludedMeanings:['包装层级单位','自动换算抽/张/片'],enumValues:units,enumPolicy:'单选，保留商品明示单位；缺失不默认。'});
   card.bindings.push({...structuredClone(binding(a.id)),attributeId:id,rationale:'计数单位与数值共同构成完整规格，避免不同单位混比。'});
   card.rules.push({attributeId:id,directRule:'从同SKU同包装层级的直接文字提取计数单位，与数值一同记录。',operator:'direct',inputs:[],formula:'',preconditions:['数值与单位来自同一对象和计量层级'],onMissing:'unknown，不能默认单位。',onConflict:'保留来源冲突待核。',examples:[{input:'synthetic：每包100'+units[0],expected:units[0],reason:'明确同对象计数单位。'},{input:'synthetic：仅每包100，单位未知',expected:'unknown',reason:'无单位不猜测。'}]});
   card.provenance.push({attributeId:id,claims:[{sourceId:codexSource.id,relation:'提出',claim:'将原数值字段已声明的多种计数单位分离为可执行字段，避免单位丢失。',quote:''}]});
   const dim=card.dimensions.find((x:any)=>x.attributeIds.includes(a.id));if(!dim)throw Error('quantity dimension missing');dim.attributeIds.push(id);note(id,'将混合计数单位明确建模');
  }
 }
 // Remove duplicate dimension references only when all refer to exactly the same defined attribute.
 const valid=new Set(card.attributes.map((a:any)=>a.id)),seen=new Set<string>();for(const dim of card.dimensions)dim.attributeIds=dim.attributeIds.filter((id:string)=>{if(!valid.has(id))throw Error('unresolved dimension '+id+' '+c.name);if(seen.has(id)){note(id,'去除同一属性重复维度引用，保留首次归属');return false;}seen.add(id);return true;});
 card.unresolved=[...(questions[c.name]??[]),...(d.sampleMatched<3?['本次随机样本仅'+d.sampleMatched+'件匹配；候选枚举覆盖不足，需补充有效实物资料验证，不宣称业务验收通过。']:[])];
 const checked=normalizeCardContract(card,seed.rules);const errors=[...checkCard(checked.card,c.id,sources),...checkSharedRules(checked.card)];
 const dispositions=d.review.findings.map((x:any,index:number)=>{
  const id=normalized.idMap[x.attributeId]??x.attributeId;
  let decision='核对后关闭',reason='核对最终规则、实际程序检查和本地参考逐行决策；模型已解决项不重复修改。';
  if(/invalid id|注册|rules:|1:1|引文|quote|model.knowledge|来源逐行|逐条处置|localReferenceDecisions/.test(x.issue)){decision='按实际结构和来源核对';reason='ID只需符合格式而非预先登记；引用以provenance实际quote和完整12行独立决策为准。必要的格式/公共规则已修复，原响应保留。';}
  if(changes.some((z:any)=>z.attributeId===id)){decision='采纳或调整采纳';reason=changes.filter((z:any)=>z.attributeId===id).map((z:any)=>z.reason).filter(Boolean).join('；');}
  if((c.name==='一次性日杂'&&x.attributeId==='category')||(c.name==='坐垫纸'&&x.attributeId.includes('type'))){decision='保留业务边界待确认';reason=(questions[c.name]??[]).join('；');}
  return {index,attributeId:id,issue:x.issue,recommendation:x.recommendation,decision,reason};
 });
 const historicalAttributes:any[]=[];
 for(const file of ['cards.json','repair1.json','repair2.json'])if(await exists(join(dir,file))){const v=(await read(join(dir,file))).value;historicalAttributes.push(...(v.attributes??v.replacements?.map((x:any)=>x.attribute)??[]));}
 const aliases:Record<string,string>={'category.packageCount':'category.pack_count','category.layerCount':'category.paper_layer_count','cat.pack_form':'cat.unit_pack_form'};
 const referenceDecisions=d.localReferenceDecisions.map((x:any)=>{
  const retired:string[]=[];const targets=x.targetAttributeIds.flatMap((id:string)=>{
   const n=normalized.idMap[id]??id.replace(/[A-Z]/g,(z:string)=>'_'+z.toLowerCase());
   const direct=checked.card.attributes.find((a:any)=>a.id===n||a.id===aliases[id]||a.id===aliases[n]);if(direct)return[direct.id];
   const old=historicalAttributes.find((a:any)=>a.id===id||a.id===n),same=old&&checked.card.attributes.find((a:any)=>a.name===old.name);if(same)return[same.id];
   retired.push(id);return[];
  });
  return {...x,targetAttributeIds:[...new Set(targets)],action:targets.length?x.action:'不采纳',reason:x.reason+(retired.length?'；最终卡已撤下对应候选（'+retired.join('、')+'），本项未落地部分不计作采纳。':'')};
 });
 const staleReferences=referenceDecisions.filter((x:any)=>x.targetAttributeIds.some((id:string)=>!checked.card.attributes.some((a:any)=>a.id===id)));
 const final={...d,card:checked.card,cardHash:hash(checked.card),sources,changes,dispositions,localReferenceDecisions:referenceDecisions,staleReferences,programErrors:errors,operationsQuestions:questions[c.name]??[],modelSampleMatched:d.sampleMatched,sampleMatched:(d.sampleDecisions??[]).filter((s:any)=>s.status==='matched').length,status:errors.length||staleReferences.length?'codex_fix_required':questions[c.name]?.length?'属性候选已整理，边界待运营确认':'属性卡已整理，待运营审核'};
 await save(join(dir,'adjudicated.json'),final);cards.push(final.card);summary.push({category:c,attributes:card.attributes.length,status:final.status,errors,staleReferences});
}
try{registry(cards);}catch(e:any){await save(join(rev,'registry-error.json'),{error:e.message});throw e;}
await save(join(rev,'adjudication-status.json'),summary);console.log(JSON.stringify(summary.map(s=>({category:s.category.name,attributes:s.attributes,status:s.status,errors:s.errors,stale:s.staleReferences}))));
