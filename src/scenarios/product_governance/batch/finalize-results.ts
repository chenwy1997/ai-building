import {join,resolve} from 'node:path';
import {readdir} from 'node:fs/promises';
import {read,save,digest} from '../runtime/storage.ts';
import {isPresent,validateEvidence,validateValue,compareValue} from './validation.ts';
const dir=resolve(import.meta.dir,'../../../../outputs/product-governance/three-category-20261019');
const preview=process.argv.includes('--preview');
const a:any=await read(join(dir,'analysis/assembled.json')),s:any=await read(join(dir,'design/standard.json')),manifest:any=await read(join(dir,'inputs/manifest.json'));
if(a.validationIssues.length||a.counts.sample!==150||a.modelCoverage.deepseek!==150||a.modelCoverage.kimi!==150)throw new Error('逐件覆盖/证据校验尚未通过');
if(a.counts.eligible+a.counts.wrong+a.counts.uncertain!==150)throw new Error('归属计数不闭合');
if(!manifest.allEsStatusChecksPass||manifest.uniqueProducts!==150)throw new Error('随机在售样本校验未通过');
const jdModels:any={deepseek:new Map(),kimi:new Map()};
for(const f of await readdir(join(dir,'normalized-jd'))){const r:any=await read(join(dir,'normalized-jd',f));for(const p of r.content.products)jdModels[r.model].set(p.key,p);}
if(!preview&&(jdModels.deepseek.size!==42||jdModels.kimi.size!==42))throw new Error('京东42件独立复核未全部返回');
const jdFinalReview:any=preview?null:await read(join(dir,'analysis/jd-final-retry-adjudication.json'));
if(!preview&&(jdFinalReview?.count!==14||new Set(jdFinalReview.records.map((r:any)=>r.key)).size!==14))throw new Error('最后14件京东补证的Codex裁定未齐');
const modelRecords:any[]=[];
for(const f of (await readdir(join(dir,'models'))).filter(f=>f.endsWith('.json')&&!/\.(request|raw)\.json$/.test(f)&&!f.startsWith('ledger-'))){
 const r:any=await read(join(dir,'models',f));if(!r.stage)continue;
 modelRecords.push({file:'models/'+f,stage:r.stage,model:r.model.id,alias:r.model.model,responseModel:r.responseModel??null,actualVersionKnown:r.actualVersionKnown,status:r.status,error:r.error??'',startedAt:r.startedAt,completedAt:r.completedAt,usage:r.usage??null,estimatedUsd:r.estimatedUsd??null});
}
modelRecords.sort((x,y)=>x.startedAt.localeCompare(y.startedAt));
const normalized:any[]=[];
for(const folder of ['normalized','normalized-jd'])for(const f of await readdir(join(dir,folder))){const r:any=await read(join(dir,folder,f));normalized.push({file:folder+'/'+f,model:r.model,sourceRecord:r.sourceRecord,originalStatus:r.originalStatus,syntaxRecovery:r.syntaxRecovery});}
const fieldRecords:any[]=[],categoryDecisions:any[]=[],sources=new Map<string,number>();
for(const row of a.rows){
 if(row.models.deepseek.key!==row.key||row.models.kimi.key!==row.key)throw new Error('模型输出串SKU');
 const ds=row.models.deepseek.category,ki=row.models.kimi.category;
 categoryDecisions.push({key:row.key,productId:row.id,deepseek:ds,kimi:ki,final:row.category,decision:'Codex最终裁定',different:ds?.status!==ki?.status||ds?.status!==row.category.status||ki?.status!==row.category.status});
 row.jdModelReviews={deepseek:jdModels.deepseek.get(row.key)??null,kimi:jdModels.kimi.get(row.key)??null};
 for(const [id,f] of Object.entries(row.fields) as [string,any][]){
  const def=s.definitions.find((d:any)=>d.id===id),dsv=row.models.deepseek.values?.[id],kiv=row.models.kimi.values?.[id];
  const sourceGroup=!f.evidenceId?(f.status==='not_applicable'?'不适用':'尚无可用证据'):String(f.evidenceId).startsWith('J')?'京东VOP同品详情':String(f.evidenceId).startsWith('V')?'同SKU主图视觉核验':f.evidenceId==='I'?'主图OCR':'三横标题/规格/品牌';
  if(f.status==='filled'){sources.set(sourceGroup,(sources.get(sourceGroup)??0)+1);if(validateValue(def,f.value).length||validateEvidence(row,f.evidenceId,f.quote).length)throw new Error('正式值检查失败 '+row.key+' '+id);}
  const modelCheck=(tuple:any)=>{if(!tuple||!isPresent(tuple[0]))return '未填';return [...validateValue(def,tuple[0]),...validateEvidence(row,tuple[1],tuple[2])].join('；')||'结构及引文可定位，仍需语义裁定';};
  const dsval=dsv?.[0]??null,kival=kiv?.[0]??null;
  fieldRecords.push({key:row.key,productId:row.id,category:row.categoryName,categoryStatus:row.category.status,inRate:row.category.status==='matched'&&f.status!=='not_applicable',...f,sourceGroup,
   deepseekValue:dsval,deepseekEvidence:dsv?.[1]??'',deepseekQuote:dsv?.[2]??'',deepseekCheck:modelCheck(dsv),deepseekMissing:row.models.deepseek.missing?.[id]??'',
   kimiValue:kival,kimiEvidence:kiv?.[1]??'',kimiQuote:kiv?.[2]??'',kimiCheck:modelCheck(kiv),kimiMissing:row.models.kimi.missing?.[id]??'',
   modelValueDifferent:compareValue(dsval)!==compareValue(kival),jdDeepseekValue:jdModels.deepseek.get(row.key)?.values?.[id]?.[0]??null,jdKimiValue:jdModels.kimi.get(row.key)?.values?.[id]?.[0]??null});
 }
}
const jdRows=a.rows.filter((r:any)=>r.jdSameProduct),goodStatuses=['matched','confirmed','verified_same','same','same_product','同品'];
const extraJd:any=await read(join(dir,'inputs/jd-core-r4-summary.json'));
const jdUsage=fieldRecords.filter(f=>f.inRate&&f.status==='filled'&&String(f.evidenceId).startsWith('J'));
const ocr:any=await read(join(dir,'inputs/image-ocr.json'));
const rawCost=modelRecords.filter(r=>r.model==='deepseek'&&r.estimatedUsd!==null).reduce((n,r)=>n+r.estimatedUsd,0);
const pub={baseStandardHash:digest(s),runtimeStandardUnchanged:true,publicationStatus:'Codex试点裁定；待运营审核',metadataCorrections:[{attributeId:'common.scent',field:'origin',previous:'B69-06/B71-05；统一为文本保留具体香型',corrected:'源自B69-06/B71-05；本轮统一为受控选项，具体未收录香型作为枚举候选。',impact:'仅来源描述滞后；实际type、enum、rule及本轮输出均为选项口径，无取值规则变更。'}],
 sourcesNote:'历史21类属性稿作为参考；本轮两模型独立提案、交叉评审和Codex修订。没有把本轮未直接核对的震坤行字段声称为逐项直接来源。',
 definitionSources:s.definitions.map((d:any)=>({attributeId:d.id,source:d.legacyCode?'既有21类属性稿 '+d.legacyCode+'；本轮Codex修订':d.id==='common.brand'?'第一步公共品牌卡；本轮ES品牌参考字典':d.id==='common.scent'?'既有B69-06/B71-05；本轮多模型建议与Codex统一':d.id==='common.color'?'既有颜色属性；本轮Codex厘清本体、包装与花纹边界':['wet.use','wet.closure'].includes(d.id)?'本轮模型独立建议；Codex定义边界与枚举':'Codex业务建模建议；纳入两模型整卡交叉评审'}))};
await save(join(dir,'design/card-publication.json'),pub);
const final={...a,status:preview?'preview-pending-final-review':'codex-adjudicated-await-operations-audit',finalizedAt:new Date().toISOString(),publication:pub,fieldRecords,categoryDecisions,modelRecords,normalizedRecords:normalized,jdFinalReview,
 evidenceStats:{sourceCounts:Object.fromEntries(sources),imageDownloaded:ocr.products.length,imageOcrWithText:ocr.products.filter((p:any)=>p.ocr?.text?.trim()).length,imageVisualReviewed:a.rows.filter((r:any)=>r.imageVerified).length,
 jdSuccessful:42+extraJd.ok,jdSameProductConfirmed:jdRows.filter((r:any)=>goodStatuses.includes(r.jdSameProduct.status)).length,jdRejectedOrUncertain:jdRows.filter((r:any)=>!goodStatuses.includes(r.jdSameProduct.status)).map((r:any)=>({key:r.key,...r.jdSameProduct})),jdFieldUses:jdUsage.length,jdNewFills:jdUsage.filter(f=>f.initialStatus!=='filled').length},
 modelStats:{externalCalls:modelRecords.length,deepseekCalls:modelRecords.filter(r=>r.model==='deepseek').length,kimiCalls:modelRecords.filter(r=>r.model==='kimi').length,syntaxRecovered:normalized.filter(r=>r.syntaxRecovery).length,rawFailedCalls:modelRecords.filter(r=>r.status==='failed').length,deepseekRecordedCostSubtotalUsd:rawCost,deepseekUnknownUsageCalls:modelRecords.filter(r=>r.model==='deepseek'&&!r.usage).length,kimiCost:null},
 limitations:['每类随机50件，等额分层样本；本报告合计比例描述样本，不能外推整个标准类目树。','本次商品详情未返回正文或详情图片；实际使用主图OCR、Codex视觉核验及44件同SKU京东查询。','42件京东补证经DeepSeek/Kimi独立复核；S07/S24为Codex终审追加2件，单独标明。','模型输出差异包含格式、类型、措辞及实质差异；一致性不当作准确率。','运营尚未随机抽检；无生产迁移或属性回写；品牌引用字典仍待生产主数据对齐。']};
const evidenceDigest=digest({standard:digest(s),products:a.inputHashes,normalized:normalized.map(n=>n.sourceRecord),rows:a.rows.map((r:any)=>({key:r.key,category:r.category,fields:r.fields}))});
if(!preview)await save(join(dir,'analysis/root-signoff.json'),{actor:'Codex /root',at:final.finalizedAt,standardHash:digest(s),evidenceDigest,keys:a.rows.map((r:any)=>r.key),reviewed:'审阅三类逐件证据、完整模型输出差异、分类争议、图片复核及京东补证；通过根覆盖记录保留裁定；语义判断不以模型多数替代证据。',status:final.status,counts:final.counts,operationsAudited:false,productionWritePerformed:false});
await save(join(dir,preview?'analysis/report-preview.json':'analysis/final.json'),final);
console.log(JSON.stringify({counts:final.counts,evidence:final.evidenceStats,models:final.modelStats},null,2));
