import {join} from 'node:path';
import {digest,read,save} from '../runtime/storage.ts';
import {ROOT,RUN} from './settings.ts';
import {loadContext,selectedOpinion} from './review-inputs.ts';
import {MODELS} from './review-schema.ts';
const f:any=await read(join(RUN,'analysis/final.json'));
const ready:any=await read(join(RUN,'analysis/readiness.json'));
if(ready.status!=='ready'||ready.productsHash!==f.inputHashes?.products)throw new Error('Final run is not ready.');
const s:any=await read(join(RUN,'design/standard.json'));
const oldReport:any=await read(join(ROOT,'outputs/product-governance/clean-paper-21-revision-20261019/report-data.json'));
const t=(x:any)=>x===null||x===undefined?'':typeof x==='object'?JSON.stringify(x):x;
const status=(x:string)=>(({matched:'归属正确',wrong:'错挂',uncertain:'归属待确认',filled:'已填',needs_evidence:'缺证据',conflict:'证据冲突',enum_candidate:'枚举外候选',not_applicable:'不适用'} as Record<string,string>)[x]??x);
const categoryIssue=(x:string)=>(({wrong_existing_category:'错挂：V2已有目标',target_unresolved:'错挂：目标尚待确认',needs_product_evidence:'需补商品证据',category_strategy_pending:'类目承接策略待定',confirmed_category_gap:'已核实V2缺类目',unverified_category_gap:'缺类目判断待核'} as Record<string,string>)[x]??x);
const cohortLabel=(x:string)=>(({historical:'历史400件成员重验',new13:'其余13类新增ES抽样'} as Record<string,string>)[x]??x);
const tables:any[]=[];
const add=(name:string,title:string,headers:string[],widths:number[],rows:any[][],extra:any={})=>tables.push({name,title,headers,widths,rows,...extra});
const m=f.metrics;
if(!m||!Array.isArray(f.rows)||f.rows.length!==f.sampling.actual)throw new Error('Final review/metric count mismatch.');
const context=await loadContext({runDir:RUN});
if(ready.codexReviewed!==context.products.length||f.rows.length!==context.products.length||f.rows.some((r:any)=>r.adjudicator!=='Codex')
 ||context.productsHash!==f.inputHashes?.products||context.standardHash!==f.standardHash||ready.standardHash!==f.standardHash)
 throw new Error('All sampled products must have final Codex adjudication for the current frozen inputs.');
const modelNames:Record<string,string>={deepseek:'DeepSeek',kimi:'Kimi',glm:'GLM',qwen:'Qwen'};
const categoryOrder=new Map<string,number>(s.categories.map((c:any,i:number)=>[c.id,i]));
const sortedAttributeCoverage=[...f.perAttribute].sort((a:any,b:any)=>(categoryOrder.get(a.categoryId)??Number.MAX_SAFE_INTEGER)-(categoryOrder.get(b.categoryId)??Number.MAX_SAFE_INTEGER));
const modelStates=new Map<string,{actual:string[];missing:string[];actualText:string;missingText:string;crossReviewStatus:string}>();
const modelVersions=new Map<string,{family:string;provider:string;adapter:string;requested:string;response:string;count:number;known:boolean}>();
const recordCache=new Map<string,any>();
const finalRowsByKey=new Map<string,any>(f.rows.map((r:any)=>[r.key,r]));
const actualCoverage=Object.fromEntries(MODELS.map(model=>[model,{productsWithResponse:0,expected:context.products.length,missingKeys:[] as string[]}]));
for(const product of context.products){
 const finalRow=finalRowsByKey.get(product.key);
 if(!finalRow)throw new Error(`Product missing from final adjudication: ${product.key}`);
 const actual:string[]=[],missing:string[]=[];
 for(const family of MODELS){
  const attempt=selectedOpinion(context,product.key,family);
  if(digest(finalRow.models?.[family]??null)!==digest(attempt?.opinion??null))
   throw new Error(`Model opinion changed after final assembly: ${product.key}/${family}`);
  if(!attempt){missing.push(family);actualCoverage[family]!.missingKeys.push(product.key);continue;}
  // An absent opinion is disclosed; a present opinion still needs its real call record.
  if(!attempt.sourceRecord)throw new Error(`Missing source record for existing opinion: ${product.key}/${family}`);
  if(!recordCache.has(attempt.sourceRecord))recordCache.set(attempt.sourceRecord,await read(join(RUN,attempt.sourceRecord)));
  const record=recordCache.get(attempt.sourceRecord),config=record.model??{},identity:any=attempt.modelIdentity??{};
  const item={family,provider:config.provider??identity.provider??'原始记录未注明',adapter:config.adapter??identity.adapter??'原始记录未注明',requested:config.model??identity.requestedModel??'原始记录未注明',response:record.responseModel??identity.responseModel??'响应未公开具体版本',count:0,known:record.actualVersionKnown===true};
  const key=JSON.stringify([item.family,item.provider,item.adapter,item.requested,item.response,item.known]);
  const group=modelVersions.get(key)??item;group.count++;modelVersions.set(key,group);
  actual.push(family);actualCoverage[family]!.productsWithResponse++;
 }
 modelStates.set(product.key,{actual,missing,actualText:actual.map(x=>modelNames[x]).join('、')||'未取得意见',missingText:missing.map(x=>modelNames[x]).join('、')||'无',crossReviewStatus:missing.length?`缺部分交叉意见（${actual.length}/${MODELS.length}）；Codex已逐件裁定`:'计划模型意见齐全；Codex已逐件裁定'});
}
const modelState=(key:string)=>{const state=modelStates.get(key);if(!state)throw new Error(`Missing product model state: ${key}`);return state;};
const modelField=(r:any,family:string)=>modelState(r.key).actual.includes(family)
 ?[t(r[`${family}Value`]),status(r[`${family}Status`]??'原意见未提供该字段')]
 :['','未取得意见'];
const incompleteCrossReviews=[...modelStates.values()].filter(x=>x.missing.length>0).length;
const missingOpinionSlots=[...modelStates.values()].reduce((n,x)=>n+x.missing.length,0);
add('评估总览','清洁纸品21类商品验证：现有模型意见与Codex逐件裁定',
 ['指标','数量或比例','分子','分母','统计口径'],[30,24,16,16,110],[
 ['计划样本数',f.sampling.planned,'','','历史400件+其余13类计划各50件'],
 ['实际样本数',m.sample,'','','历史400件保留成员重验；新增按ES在售条件抽取，库存不足不补其他类目'],
 ['归属正确商品',m.eligible,m.eligible,m.sample,'只有归属已确认且目标等于原类目的商品进入原类目属性填充率'],
 ['错挂商品',m.wrong,m.wrong,m.sample,'排除原类目属性分子与分母；查看错挂与待确认页的V2目标'],
 ['归属待确认商品',m.uncertain,m.uncertain,m.sample,'排除填充率；补充信息与业务边界问题单独保留'],
 ['总体属性填充率',m.overallFields.rate,m.overallFields.filled,m.overallFields.slots,'有证据且符合新版规则的已填字段/适用或适用性待确认的字段；明确不适用排除'],
 ['必填属性填充率',m.independentRequiredFields.rate,m.independentRequiredFields.filled,m.independentRequiredFields.slots,'独立必填字段口径；计量组中互为替代的路径不重复列为独立必填字段'],
 ['必填计量组完成率',m.orGroups.rate,m.orGroups.complete,m.orGroups.slots,'至少一条适用路径的全部字段有效完成；单列展示，不能以组数冒充字段数'],
 ['必填完整商品数',m.completeRequiredProducts,m.completeRequiredProducts,m.eligible,'独立必填字段和适用必填组均完成；缺项商品可交付已核实字段但不算完整'],
 ['全部条件已明确商品数',m.allConditionsResolvedProducts,'','','条件未知不会自动当作不适用'],
 ['结论适用范围','21类分层定额样本','','',f.sampling.scopeNote],
 ['运营随机抽检','待运营审核','','','实际取得的模型意见及Codex裁定不等于人工测得准确率'],
 ['生产同步','本轮未执行','','','本文件是验证交付，迁移目标是建议，不表示已修改线上数据'],
 ['标准版本',s.releaseId,'','',f.standardHash],
 ...MODELS.map(model=>[`${modelNames[model]}实际意见覆盖`,actualCoverage[model]!.productsWithResponse,actualCoverage[model]!.productsWithResponse,context.products.length,`按已取得且可追溯的独立商品意见计数；未取得${actualCoverage[model]!.missingKeys.length}件，不补造意见`]),
 ['计划模型意见齐全商品数',context.products.length-incompleteCrossReviews,context.products.length-incompleteCrossReviews,context.products.length,'该商品已取得全部计划模型意见；意见一致不代表事实准确'],
 ['缺部分交叉意见商品数',incompleteCrossReviews,incompleteCrossReviews,context.products.length,'逐件查看商品总览的未取得意见模型和交叉审核状态；保留后续补审清单'],
 ['未取得模型意见项数',missingOpinionSlots,missingOpinionSlots,context.products.length*MODELS.length,'一件商品缺一个模型计一项，与缺交叉意见商品数不同'],
 ['Codex逐件裁定商品数',f.rows.length,f.rows.length,context.products.length,'全部样本已逐件核对当前实际取得的模型意见和证据，未取得意见仍明确保留'],
 ['本轮交付口径','现有模型裁定版','','','使用当前真实可用意见完成裁定；未取得的交叉意见不记作已审核'],
 ],{preview:'A2:E12',formats:{'B11:B13':'0.00%'}});
add('类目覆盖与填充率','21类覆盖与分项填充率｜同类连续排列',
 ['末级类目','类目ID','完整类目路径','样本数','归属正确','错挂','待确认','已填字段','计率字段','总体填充率','已填必填字段','必填字段','必填填充率','完成必填组','必填组','必填组完成率','必填完整商品数','属性卡有效商品验证'],
 [22,39,55,12,12,12,12,14,14,17,17,14,17,16,14,18,20,55],
 f.byCategory.map((c:any)=>[c.name,c.id,c.path,c.sample,c.eligible,c.wrong,c.uncertain,c.overallFields.filled,c.overallFields.slots,c.overallFields.rate,c.independentRequiredFields.filled,c.independentRequiredFields.slots,c.independentRequiredFields.rate,c.orGroups.complete,c.orGroups.slots,c.orGroups.rate,c.completeRequiredProducts,c.eligible>0?`有${c.eligible}件确认同类商品进入属性验证`:'已完成样本归属复核，但本批无确认同类商品，属性卡未获正样本验证']),
 {preview:'A2:J11',formats:{'J6:J26':'0.00%','M6:M26':'0.00%','P6:P26':'0.00%'}});
const cards=structuredClone(oldReport.tables.find((x:any)=>x.name==='21类完整属性卡'));
cards.title='21类完整属性卡｜本次商品验证冻结版本；同一末级类目连续';
tables.push(cards);
add('商品总览','逐件归属与交付概览｜历史重验和新增抽样分别标识',
 ['末级类目','类目ID','完整类目路径','样本键','商品源ID','历史样本键','抽样来源','实际参与模型','未取得意见模型','交叉审核状态','商品标题','销售规格','归属状态','V2目标确认','V2目标类目','V2目标ID','归属判断依据','属性填写摘要','Codex审核备注'],
 [22,39,55,14,39,14,26,35,28,62,100,55,20,20,24,39,100,120,100],
 f.rows.map((r:any)=>{const ms=modelState(r.key);return[r.categoryName??s.categories.find((c:any)=>c.id===r.categoryId)?.name,r.categoryId,r.categoryPath,r.key,r.id??r.productId,r.oldKey,cohortLabel(r.cohort),ms.actualText,ms.missingText,ms.crossReviewStatus,r.title,r.saleSpec,status(r.category.status),r.category.targetConfirmed?'已确认':'待确认',r.category.targetName,r.category.targetId,r.category.reason,Object.entries(r.fields??{}).filter(([_,v]:any)=>['filled','enum_candidate'].includes(v.status)).map(([id,v]:any)=>`${s.definitions.find((a:any)=>a.id===id)?.name??id}：${t(v.value)}${v.unit??''}${v.per?'/'+v.per:''}${v.status==='enum_candidate'?'（枚举外）':''}`).join('\n'),t(r.reviewNotes)];}),{preview:'A2:J9'});
add('属性填写明细','逐字段结果与实际取得的模型原意见｜未取得意见单独标明',
 ['末级类目','类目ID','完整类目路径','属性ID','属性名','样本键','商品源ID','归属状态','是否计入填充率','必填方式','适用状态','必填状态','最终值','单位','分母单位','填写状态','证据来源','证据地址','证据ID','证据原文','裁定或缺失原因','计算过程','重量范围','DeepSeek值','DeepSeek状态','Kimi值','Kimi状态','GLM值','GLM状态','Qwen值','Qwen状态','审核记录'],
 [22,39,55,31,26,14,39,18,18,25,18,18,40,12,14,20,28,70,35,100,100,80,22,40,20,40,20,40,20,40,20,65],
 f.fieldRecords.map((r:any)=>[r.category,r.categoryId,r.categoryPath,r.attributeId,r.name,r.key,r.productId,status(r.categoryStatus),r.inRate?'是':'否',r.requirednessMode,r.applicabilityState,r.requirednessState,t(r.value),r.unit,r.per,status(r.status),r.source,r.sourceRef,r.evidenceId,r.quote,r.reason,t(r.calculation),r.weightScope,...MODELS.flatMap(model=>modelField(r,model)),r.reviewSource]),{preview:'A2:H9',compactRows:true});
add('属性覆盖分析','按类目与字段分析缺项｜组成员与独立必填分开',
 ['末级类目','类目ID','完整类目路径','属性ID','属性名','必填方式','已填','计率字段数','填充率','缺失','已填独立必填','独立必填数','缺失原因'],
 [22,39,55,31,26,26,14,18,17,14,20,18,100],
 sortedAttributeCoverage.map((r:any)=>[r.category,r.categoryId,r.categoryPath,r.attributeId,r.name,r.requirednessMode,r.filled,r.slots,r.rate,r.missing,r.independentRequiredFilled,r.independentRequiredSlots,t(r.missingReasons)]),{preview:'A2:I10',formats:{[`I6:I${sortedAttributeCoverage.length+5}`]:'0.00%'}});
const missingRows=Array.isArray(f.missingReasons)?f.missingReasons:(f.missingReasons?.overall??f.missingReasons?.rows??[]);
add('缺失原因分析','缺失原因数量及占比｜占缺失字段与占全部计率字段分别显示',
 ['原因代码','缺失原因','缺失字段数','占全部缺失字段','占全部计率字段','说明'],[30,50,20,23,24,100],
 missingRows.map((r:any)=>[r.code??r.reasonCode,r.reason??r.label,r.count,r.shareOfMissingSlots,r.shareOfAllSlots,t(r.note??r.description)]),{preview:'A2:F12',formats:{[`D6:E${Math.max(6,missingRows.length+5)}`]:'0.00%'}});
add('必填缺失原因','独立必填字段缺失原因｜不混用总体字段分母',
 ['原因代码','缺失原因','缺失必填字段数','占缺失必填字段','占全部独立必填字段'],[30,55,24,26,28],
 f.independentRequiredMissingReasons.map((r:any)=>[r.code??r.reasonCode,r.reason??r.label,r.count,r.shareOfMissingSlots,r.shareOfAllSlots]),
 {preview:'A2:E12',formats:{[`D6:E${Math.max(6,f.independentRequiredMissingReasons.length+5)}`]:'0.00%'}});
const tree:any=await read(join(ROOT,'scratch-category-baseline-20261010/mapped-tree.json'));
const leaves=new Map(tree.nodes.filter((x:any)=>x.isLeaf).map((x:any)=>[x.id,x]));
const migrations=f.rows.filter((r:any)=>r.category.status!=='matched');
add('错挂与待确认','错挂排除计率｜V2已有目标、缺类目与需补信息分别说明',
 ['原末级类目','原类目ID','原完整路径','样本键','商品源ID','商品标题','销售规格','归属状态','问题类型','目标确认','V2目标类目','V2目标类目ID','V2目标完整路径','判断依据','待办与备注'],
 [22,39,55,14,39,100,55,22,28,18,26,39,65,110,100],
 migrations.map((r:any)=>{const c=r.category,target:any=leaves.get(c.targetId);return[r.categoryName,r.categoryId,r.categoryPath,r.key,r.id??r.productId,r.title,r.saleSpec,status(c.status),categoryIssue(r.categoryIssueType),c.targetConfirmed?'已确认':'待确认',target?.name??c.targetName,c.targetId,target?.path,c.reason,t(c.resolution??c.missingInformation??r.reviewNotes)];}),{preview:'A2:H9'});
const rules=oldReport.tables.find((x:any)=>x.name==='边界与执行规则');
tables.push(structuredClone(rules));
const refs=oldReport.tables.find((x:any)=>x.name==='震坤行原表对照');tables.push(structuredClone(refs));
add('模型审核追溯','实际模型调用通道、版本与未取得意见',
 ['模型家族','调用通道','适配器','请求模型','响应模型标识','采用意见商品数','未取得意见商品数','记录状态','版本说明'],[20,30,26,34,40,24,25,24,90],
 [
  ...[...modelVersions.values()].map(x=>[modelNames[x.family],x.provider,x.adapter,x.requested,x.response,x.count,0,'已取得实际意见',x.known?'已核实具体版本':'按实际请求及响应标识记录；服务端未公开的具体版本不作推断']),
  ...MODELS.filter(model=>actualCoverage[model]!.missingKeys.length>0).map(model=>[modelNames[model],'未取得意见','','','',0,actualCoverage[model]!.missingKeys.length,'缺交叉意见','没有可采用的独立意见，不补造调用通道或模型版本']),
 ],{preview:'A2:I12'});
add('抽样与审核追溯','来源与验证边界｜不把样本比例当作全量商品比例',
 ['记录类型','对象','内容'],[28,45,145],[
 ['抽样计划','全21类',t(f.sampling)],
 ['模型覆盖','实际取得的独立意见',MODELS.map(model=>`${modelNames[model]}：已取得${actualCoverage[model]!.productsWithResponse}/${context.products.length}件；未取得${actualCoverage[model]!.missingKeys.length}件`).join('\n')+'\n逐件缺失模型见商品总览；实际调用通道和版本见模型审核追溯。'],
 ['交叉意见缺失','逐件披露',`${incompleteCrossReviews}件商品缺部分交叉意见，共${missingOpinionSlots}个商品-模型意见项；逐件实际模型、缺失模型和审核状态见商品总览`],
 ['本轮交付策略',f.deliveryPolicy?.id??'计划模型意见齐全',f.deliveryPolicy?.authorization??'逐件保留实际模型意见及Codex裁定来源'],
 ['冻结输入','文件摘要',t(f.inputHashes)],
 ['标准摘要',s.releaseId,f.standardHash],
 ...(f.sampling.shortfalls??[]).map((x:any)=>['抽样短缺',s.categories.find((c:any)=>c.id===x.categoryId)?.name??x.categoryId,t(x)]),
 ['历史样本时间','原8类400件','沿用原抽样商品及原证据重验，不等于对这些商品在本次时点重新验证在售状态'],
 ['新增样本在售口径','ES商品源','标准类目bucket source:system；未删除；SPU/SKU启用；SPU/SKU均ON_SALE；排除标准商品实体'],
 ['详情状态局限','新增616件','详情接口未返回skuSaleStatus；在售筛选依据为ES明确状态，不用缺失详情字段臆断'],
 ['震坤行使用方式','属性建模参考','沿用冻结版的逐字段参考审计；不是这些商品的参数来源'],
 ['人工验收','运营随机抽样','本轮暂无运营准确率；待抽检后再决定是否可扩围或准备线上同步'],
 ],{preview:'A2:C10'});
// Keep ratios transparent and recomputable from their displayed counts.
const overview=tables[0];overview.formulas={};
for(const row of [11,12,13])overview.formulas[`B${row}`]=`=IF(D${row}=0,"无计率样本",C${row}/D${row})`;
const categoryRates=tables.find(x=>x.name==='类目覆盖与填充率');categoryRates.formulas={};
for(let i=0;i<categoryRates.rows.length;i++){
 const row=i+6;
 categoryRates.formulas[`J${row}`]=`=IF(I${row}=0,"无计率样本",H${row}/I${row})`;
 categoryRates.formulas[`M${row}`]=`=IF(L${row}=0,"无计率样本",K${row}/L${row})`;
 categoryRates.formulas[`P${row}`]=`=IF(O${row}=0,"无适用计量组",N${row}/O${row})`;
}
const attributeRates=tables.find(x=>x.name==='属性覆盖分析');attributeRates.formulas={};
for(let i=0;i<attributeRates.rows.length;i++){
 const row=i+6;
 attributeRates.formulas[`I${row}`]=`=IF(H${row}=0,"无计率样本",G${row}/H${row})`;
}
for(const [name,overviewRow] of [['缺失原因分析',11],['必填缺失原因',12]] as const){
 const reasonTable=tables.find(x=>x.name===name);reasonTable.formulas={};
 const missingTotal=`SUM($C$6:$C$${Math.max(6,reasonTable.rows.length+5)})`,allTotal=`'评估总览'!$D$${overviewRow}`;
 for(let i=0;i<reasonTable.rows.length;i++){
  const row=i+6;
  reasonTable.formulas[`D${row}`]=`=IF(${missingTotal}=0,"无计率样本",C${row}/${missingTotal})`;
  reasonTable.formulas[`E${row}`]=`=IF(${allTotal}=0,"无计率样本",C${row}/${allTotal})`;
 }
}
await save(join(RUN,'report-data.json'),{standardHash:f.standardHash,createdAt:new Date().toISOString(),deliveryGate:{status:'ready',expectedActualProducts:context.products.length,codexReviewed:f.rows.length,productsHash:context.productsHash,standardHash:context.standardHash,finalCreatedAt:f.createdAt},modelCoverage:actualCoverage,incompleteCrossReviews,missingOpinionSlots,tables});
console.log(JSON.stringify({tables:tables.map(x=>({name:x.name,rows:x.rows.length})),products:f.rows.length}));
