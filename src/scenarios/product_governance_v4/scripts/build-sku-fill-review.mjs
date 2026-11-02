import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {parseLayoutArgs,loadReviewLayout,applyReviewLayout,validateSheetTargets} from './review-workbook-layout.mjs';
import {formatSkuEvidence,formatSkuSource,formatSkuExtractionSources,skuPrimaryExtractionSource,skuValueSourceKey,validateSkuSourceSelections} from '../sku-source-display.mjs';
import {shortSku,displaySkuValue,skuReviewEvidence,skuWideView,validateSkuEvidenceExcerpts} from '../sku-review-views.mjs';

const args=process.argv.slice(2),flags={},layoutArgs=[];
for(let i=0;i<args.length;i++){if(['--out','--filename','--modules','--data','--issues','--source-review','--evidence-review'].includes(args[i]))flags[args[i].slice(2)]=args[++i];else layoutArgs.push(args[i]);}
if(!flags.out||!flags.modules)throw Error('--out and --modules required');
const out=path.resolve(flags.out),options=parseLayoutArgs(layoutArgs),layout=await loadReviewLayout(options);
await fs.mkdir(out,{recursive:true});
const file=path.join(out,flags.filename??'SKU_属性试填审阅.xlsx');
if(path.dirname(file)!==out||!file.endsWith('.xlsx'))throw Error('Invalid local filename');
try{
 await fs.access(file);
 const previous=JSON.parse(await fs.readFile(path.join(out,'sku-workbook-verification.json'),'utf8'));
 if(!options.restyle||previous.output!==file||previous.sha256!==createHash('sha256').update(await fs.readFile(file)).digest('hex'))throw Error('Existing or edited workbook; choose a new filename');
}catch(e){if(e.code!=='ENOENT')throw e;else if(await fs.access(file).then(()=>true,()=>false))throw Error('Existing workbook has no verification');}
const resultPath=path.resolve(flags.data??path.join(out,'sku-fill-results.json'));
const bytes=await fs.readFile(resultPath),data=JSON.parse(bytes);
if(data.productionWrites!==0||data.adoption!=='pending_human')throw Error('Only offline suggestions may be exported');
const require=createRequire(path.join(path.resolve(flags.modules),'package.json'));
const {Workbook,SpreadsheetFile}=await import(pathToFileURL(require.resolve('@oai/artifact-tool')).href);
const hash=v=>createHash('sha256').update(v).digest('hex');
const wb=Workbook.create(),specs=[],layouts=[];
const skus=new Map(data.skus.map(s=>[s.skuId,s])),sources=new Map(data.sources.map(s=>[s.sourceId,s]));
for(const sku of data.skus)for(const ref of sku.categoryEvidence??[]){
 const source=sources.get(ref.sourceId);
 if(!source||/image|ocr|visual/i.test(`${source.kind??''} ${source.extractionMethod??''} ${source.field??''}`))throw Error('Current category decisions must use product or web text; recheck image-based routing before export');
}
const sourceReviewBytes=flags['source-review']?await fs.readFile(path.resolve(flags['source-review'])):null;
const sourceSelections=sourceReviewBytes?validateSkuSourceSelections(data,JSON.parse(sourceReviewBytes),hash(bytes)):new Map();
const evidenceReviewBytes=flags['evidence-review']?await fs.readFile(path.resolve(flags['evidence-review'])):null;
const reviewedExcerpts=evidenceReviewBytes?validateSkuEvidenceExcerpts(data,JSON.parse(evidenceReviewBytes),hash(bytes)):new Map();
const selectedSource=r=>sourceSelections.get(skuValueSourceKey(r));
const sourceLabel=r=>formatSkuExtractionSources(r,sources,selectedSource(r));
const basisNote=r=>[skuPrimaryExtractionSource(r,sources,selectedSource(r)).referenceOnly?'图片识别结果，仅供参考，首版不作为填值或改类依据。':'',selectedSource(r)?.basisType==='品类知识推断'?`品类推断：${selectedSource(r).reason}`:'',r.normalization?.method==='category_inference'?`品类判断：${r.normalization.reason}；假设：${(r.normalization.assumptions??[]).join('；')}`:'',r.notes??''].filter(Boolean).join('\n');
const val=displaySkuValue;
const evidenceViews=new Map(data.rows.map(r=>[skuValueSourceKey(r),skuReviewEvidence(r,sources,selectedSource(r),reviewedExcerpts)]));
const literal=v=>typeof v==='string'&&/^[=+@]/.test(v)?"'"+v:v;
const col=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
function sheet(name,title,notes,headers,rows,widths,groups,editable=[]){
 const s=wb.worksheets.add(name);s.tabColor='#294F70';s.getRange('A2').values=[[title]];
 notes.forEach((v,i)=>s.getRange('A'+(i+3)).values=[[v]]);
 if(rows.some(r=>r.length!==headers.length)||widths.length!==headers.length)throw Error('Invalid worksheet matrix');
 for(const row of rows)for(const v of row)if(typeof v==='string'&&v.length>32767)throw Error('Excel cell too long');
 s.getRangeByIndexes(5,0,1,headers.length).values=[headers];
 s.getRangeByIndexes(6,0,rows.length,headers.length).values=rows.map(r=>r.map(literal));
 widths.forEach((w,i)=>s.getRangeByIndexes(0,i,rows.length+6,1).format.columnWidthPx=w);
 const t=s.tables.add(`A6:${col(headers.length-1)}${rows.length+6}`,true,'SkuReview'+specs.length);t.style='TableStyleLight9';
 specs.push({name,sheet:s,headers,rows,widths,groups,editable});return s;
}
const counts=data.summary.statuses,bySku=new Map(data.skus.map(s=>[s.skuId,data.rows.filter(r=>r.skuId===s.skuId)]));
const issues=new Map();let issueBytes=null;
if(flags.issues){
 issueBytes=await fs.readFile(path.resolve(flags.issues));const input=JSON.parse(issueBytes);
 if(input.resultSha256!==hash(bytes))throw Error('Issue annotations belong to another result');
 const expected=new Set(data.rows.filter(r=>r.status==='identity_review').map(r=>r.skuId));
 for(const issue of input.rows){
  const sku=skus.get(issue.skuId),notes=[...new Set((bySku.get(issue.skuId)??[]).filter(r=>r.status==='identity_review').map(r=>r.notes??''))];
  if(!sku||sku.categoryId!==issue.categoryId||issues.has(issue.skuId)||!expected.has(issue.skuId))throw Error('Invalid issue SKU/category');
  if(!['疑似错挂','类目待核','品牌冲突','销售对象不一致'].includes(issue.label)||JSON.stringify(notes)!==JSON.stringify(issue.sourceNotes))throw Error('Invalid or stale issue annotation');
  issues.set(issue.skuId,issue);
 }
 if(issues.size!==expected.size)throw Error('Issue annotations must cover every identity-review SKU');
}
const scopeName=[...new Set(data.skus.map(s=>s.path?.split('>')[0]).filter(Boolean))].join('、')||'商品';
const routingLabels={suggest:'建议改类（待审）',unresolved:'疑似错挂',keep:'保留原类'};
const routed=data.skus.some(s=>s.categoryDecision&&s.categoryDecision!=='not_evaluated');
const originalCategoryCount=new Set(data.skus.map(s=>s.originalCategoryId??s.categoryId)).size;
const categoryLabels=new Map(data.skus.map(s=>{
 const identityPending=(bySku.get(s.skuId)??[]).some(r=>r.status==='identity_review');
 return [s.skuId,routingLabels[s.categoryDecision]??issues.get(s.skuId)?.label??(identityPending?'类目/身份待核':'')];
}));
const summaryRows=data.skus.flatMap(s=>{
 const rr=bySku.get(s.skuId),categoryLabel=categoryLabels.get(s.skuId);
 const categoryReason=s.categoryReason??'';
 const alternatives=(s.categoryAlternatives??[]).map(a=>`${a.path??a.category}：${a.reason??''}`).join('\n');
 return rr.map((r,i)=>{
  const proof=evidenceViews.get(skuValueSourceKey(r));
  return [shortSku(s.skuId),s.title,r.attribute,r.status==='proposed'?val(r.value):'',r.unit??'',sourceLabel(r),proof.text,'','',categoryLabel,s.originalCategory??s.category,s.suggestedCategory??'',i===0?categoryReason:'',i===0?s.saleSpec:'',basisNote(r),s.category,s.skuId,s.spuProductId,s.originalPath??s.path,s.suggestedPath??'',s.originalCategoryId??s.categoryId,s.suggestedCategoryId??'',r.attributeKey,i===0?alternatives:''];
 });
});
const overview=sheet('商品总览',scopeName+'：商品逐项属性试填',[
 `${data.summary.skus} 件商品，${summaryRows.length} 项。SKU显示短编号，完整编号在后方；未提取留空。`,
 'G列核关键原文，网址附在同格末尾；H/I列填意见。类目理由只列商品首行；完整依据见“值与证据”后方追溯列。图片值仅参考。'
],['商品SKU','商品名称','属性','提取值','单位','提取来源','提取依据','审阅结论','修正值','类目核查','原末级类目','建议类目','类目判断依据','规格原文','待核说明','属性所属类目','商品SKU完整','商品SPU','原类目路径','建议类目路径','原类目ID','建议类目ID','属性key','其他候选类目'],summaryRows,
 [90,240,90,110,50,95,420,100,110,130,115,120,330,260,360,120,300,300,370,370,300,300,230,460],
 [{start:0,end:1,title:'商品'},{start:2,end:5,title:'属性与提取值'},{start:6,end:6,title:'核对依据'},{start:7,end:8,title:'人工审阅'},{start:9,end:12,title:'类目判断'},{start:13,end:15,title:'补充说明'},{start:16,end:23,title:'完整标识与追溯'}],[7,8]);
overview.getRangeByIndexes(6,7,summaryRows.length,1).dataValidation={rule:{type:'list',values:['同意','修改','不同意','待核']}};
const issueRange=overview.getRangeByIndexes(6,9,summaryRows.length,1);
for(const label of ['疑似错挂','建议改类（待审）'])issueRange.conditionalFormats.add('cellIs',{operator:'equal',formula:`"${label}"`,format:{fill:'#FCE4D6',font:{color:'#9C0006',bold:true}}});
for(const label of ['类目待定位','类目待核','类目/身份待核','品牌冲突','销售对象不一致'])issueRange.conditionalFormats.add('cellIs',{operator:'equal',formula:`"${label}"`,format:{fill:'#FFF2CC',font:{color:'#7F6000',bold:true}}});
const wide=skuWideView(data,sources,sourceSelections);
const wideAttributeColumns=wide.slots.length*3;
const wideHeaders=['商品SKU','商品名称','原末级类目','建议类目','类目核查',...wide.slots.flatMap(s=>s.headers),'规格原文','商品SKU完整'];
const wideRows=data.skus.map((s,i)=>[shortSku(s.skuId),s.title,s.originalCategory??s.category,s.suggestedCategory??'',categoryLabels.get(s.skuId),...wide.rows[i],s.saleSpec,s.skuId]);
const wideSheet=sheet('SKU横表',scopeName+'：每件商品一行',[
 `${data.skus.length} 件商品，最多 ${wide.slots.length} 组属性。每组列出属性名、填入值和单位；有属性无值时保留名称、值留空。`,
 '按每件商品所属类目的属性顺序展示。详细依据及审阅意见见“商品总览”；浅灰斜体值仅为图片参考。'
],wideHeaders,wideRows,[90,240,115,120,130,...wide.slots.flatMap(()=>[95,135,50]),260,300],
 [{start:0,end:4,title:'商品与类目'},...wide.slots.map((s,i)=>({start:5+i*3,end:7+i*3,title:s.title})),{start:5+wideAttributeColumns,end:6+wideAttributeColumns,title:'规格与完整编号'}]);
const detailSeen=new Set();
const detailRows=data.rows.map(r=>{
 const s=skus.get(r.skuId),quotes=r.evidence.map(e=>formatSkuEvidence(e,sources.get(e.sourceId))).join('；');
 const first=!detailSeen.has(s.skuId);detailSeen.add(s.skuId);
 const proof=evidenceViews.get(skuValueSourceKey(r));
 const observed=[...(r.observations??[]).map(o=>val(o.value)),...(r.status==='out_of_domain'?[val(r.value)]:[])];
 const categoryEvidence=first?(s.categoryEvidence??[]).map(e=>formatSkuEvidence(e,sources.get(e.sourceId))).join('\n'):'';
 const trace=[quotes?`全部原文证据：\n${quotes}`:'',r.evidence.map(e=>formatSkuSource(e,sources.get(e.sourceId))).join('；'),selectedSource(r)?.reason?`主要来源说明：${selectedSource(r).reason}`:'',categoryEvidence?`类目判断原文：\n${categoryEvidence}`:'',first&&s.categoryReviewNotes?.length?`类目待核说明：${s.categoryReviewNotes.join('；')}`:''].filter(Boolean).join('\n');
 return [shortSku(s.skuId),s.title,r.attribute,r.status==='proposed'?val(r.value):'',r.unit??'',sourceLabel(r),proof.text,'','',basisNote(r),[...new Set(observed)].join('；'),first?s.saleSpec:'',s.category,s.skuId,s.path,trace,`${r.definition}\n${r.rule}`,r.attributeKey,s.productInstanceId];
});
const detail=sheet('值与证据',scopeName+'：逐项值与原文证据',[
 `建议值 ${counts.proposed??0} 项；含义待确认 ${counts.needs_evidence??0} 项；商品信息待确认 ${counts.identity_review??0} 项。`,
 '黄色列填写人工意见。建议值为空不等于否/零；原始候选只供核实，不进入本轮建议值。'
],['商品SKU','商品名称','属性','建议值','单位','提取来源','原文证据','审阅结论','修正值','待核说明','原始候选','规格原文','属性所属类目','商品SKU完整','属性类目路径','来源与字段','定义与规则','属性key','商品实例版本'],detailRows,
 [90,240,90,110,50,95,420,100,110,360,160,260,120,300,370,480,500,230,300],
 [{start:0,end:1,title:'商品'},{start:2,end:5,title:'属性与建议值'},{start:6,end:6,title:'核对依据'},{start:7,end:8,title:'人工审阅'},{start:9,end:12,title:'待核候选与规格'},{start:13,end:18,title:'完整证据与合同'}],[7,8]);
detail.getRangeByIndexes(6,7,detailRows.length,1).dataValidation={rule:{type:'list',values:['同意','修改','不同意','待核']}};
const scopeRows=data.summary.categories.map(c=>[c.category,routed?'试填属性类目':'冻结样本',c.skus,c.summaryRead,c.rows,c.statuses.proposed??0,c.statuses.needs_evidence??0,(c.statuses.identity_review??0)+(c.statuses.conflict??0),c.statuses.missing??0,'管理详情未全读；已读用户补图另列来源',routed?'按本轮属性所属类目统计；包含待人工确认的改类建议，原抽样范围未变。':'按真实目录ID冻结，品牌分散样本；非随机准确率评估',c.categoryId]);
for(const c of data.sampling?.categories??[])if(c.gap>0)scopeRows.push([c.name,'样本不足',c.selected,'','','','','','',`计划 ${c.requested} 件，实取 ${c.selected} 件`,`当前同范围可用 ${c.available} 件，缺 ${c.gap} 件；不重复取样或跨类补足。`,c.categoryId]);
scopeRows.push(['全部','指标说明',data.summary.skus,data.skus.filter(s=>s.summaryStatus==='ok').length,data.rows.length,counts.proposed??0,counts.needs_evidence??0,(counts.identity_review??0)+(counts.conflict??0),counts.missing??0,'人工核实准确率：尚不可计算','没有独立人工金标准。程序、模型审校通过不是100%准确。','']);
scopeRows.push(['全部','资料限制','','','','','','','','上游补证先核同SKU与规格','数字上游SKU不能自动作为京东身份；图片地址不能作为识别出的事实。','']);
scopeRows.push(['全部','提取来源','','','','','','','','商品文本 / 京东VOP / 网络提取 / 图片参考','仅列真正支持值的主要来源，文字足够时优先文字；标题只用于匹配品牌型号时不能取代网络值来源。完整证据另存。图片值仅参考，不作首版填值或改类依据；内部处理状态不作为运营列展示。','']);
if(routed){
 const byDecision={};for(const s of data.skus)byDecision[s.categoryDecision]=(byDecision[s.categoryDecision]??0)+1;
 scopeRows.push(['类目核查','离线建议',data.summary.skus,'','','','','','',`建议改类 ${byDecision.suggest??0} 件；保留 ${byDecision.keep??0} 件；疑似错挂 ${byDecision.unresolved??0} 件`,`属性按当前活动合同试填，新类目建议不自动切换已有属性；${byDecision.not_evaluated??0}件未触发本次改类检查。未修改线上类目。`,'']);
}
for(const s of data.supplemental?.rows??[])for(const c of s.comparisons??[]){
 scopeRows.push(['京东补证',c.topic,'','','','','','','',s.includedInFrozenSelection?'在冻结样本内；仍须核身份':'独立补证；不计入冻结样本',`本地：${c.local}\n京东：${c.upstream}\n核对：${c.finding}`,`${s.skuId} / 京东${s.jdSkuId}`]);
}
scopeRows.push(['供应链','后续对接','','','','','','','','本地保留数值和单位','后台单选/多选/单行/多行文本另做ID及类型投影。本轮无线上写入。','https://sc.sanheng.com/manage/category-attribute']);
sheet('范围与补证','范围、资料与京东补证',[
 `原抽样 ${originalCategoryCount} 个类目、${data.skus.length} 件；本轮按 ${data.summary.categories.length} 个类目试填。摘要返回 ${data.skus.filter(s=>s.summaryStatus==='ok').length} 件。`,
 `独立补证 ${data.supplemental?.rows?.filter(s=>!s.includedInFrozenSelection).length??0} 件，不计入冻结样本。无人工准确率结论。`
],['类目/范围','记录事项','SKU数','摘要返回','属性项数','建议项数','含义待确认','身份或冲突','资料没写','当前结论','说明','标识/地址'],scopeRows,
 [130,140,70,80,80,80,85,90,80,340,600,380],
 [{start:0,end:1,title:'范围'},{start:2,end:8,title:'离线统计'},{start:9,end:11,title:'资料边界与补证'}]);
validateSheetTargets(layout,options,specs.map(s=>s.name));
for(const spec of specs){
 const s=spec.sheet;layouts.push(await applyReviewLayout(wb,s,spec.widths,layout,options));
 for(const g of spec.groups){const range=s.getRangeByIndexes(4,g.start,1,g.end-g.start+1);if(g.end>g.start)range.merge();s.getRangeByIndexes(4,g.start,1,1).values=[[g.title]];range.format={fill:'#DCE6F1',font:{name:layout.fontFamily,size:10,bold:true,color:'#294F70'},horizontalAlignment:'center',verticalAlignment:'center',rowHeightPx:25,wrapText:false};}
 for(const i of spec.editable)s.getRangeByIndexes(6,i,spec.rows.length,1).format.fill=layout.editableFill;
 s.getRangeByIndexes(6,0,spec.rows.length,spec.headers.length).format.wrapText=false;
 for(const heading of ['提取值','建议值','修正值']){const i=spec.headers.indexOf(heading);if(i>=0)s.getRangeByIndexes(6,i,spec.rows.length,1).format.horizontalAlignment='left';}
}
wideSheet.getRangeByIndexes(6,5,wideRows.length,wideAttributeColumns).format.horizontalAlignment='left';
for(const cell of wide.imageCells){const range=wideSheet.getRangeByIndexes(cell.row+6,cell.column+5,1,1);range.format.fill='#F1F3F5';range.format.font.color='#6B7280';range.format.font.italic=true;}
wb.recalculate();
const inspected=await wb.inspect({kind:'table',range:'商品总览!A6:K22',include:'values,formulas',tableMaxRows:17,tableMaxCols:11,maxChars:4500});
await fs.writeFile(path.join(out,'sku-workbook-inspection.ndjson'),inspected.ndjson);
const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:100},summary:'Export error scan'});
await fs.writeFile(path.join(out,'sku-workbook-errors.ndjson'),errors.ndjson);
// Render through the complete merged headers; cropping a merge can misplace its label.
const previewRanges=specs.map(s=>[s.name,`A1:${col(s.headers.length-1)}${Math.min(s.rows.length+6,22)}`]);
const firstSuspected=summaryRows.findIndex(r=>['疑似错挂','建议改类（待审）'].includes(r[9]));
if(firstSuspected>=0)previewRanges.push(['商品总览',`A${firstSuspected+7}:X${Math.min(summaryRows.length+6,firstSuspected+18)}`]);
for(const [name,range] of previewRanges){
 const blob=await wb.render({sheetName:name,range,scale:1,format:'png'});await fs.writeFile(path.join(out,name+(range.startsWith('A1:')?'':'-错挂示例')+'.png'),new Uint8Array(await blob.arrayBuffer()));
}
await (await SpreadsheetFile.exportXlsx(wb)).save(file);
if(hash(await fs.readFile(resultPath))!==hash(bytes))throw Error('Result changed during export');
const verification={output:file,sha256:hash(await fs.readFile(file)),sourcePath:resultPath,sourceSha256:hash(bytes),sourceReviewSha256:sourceReviewBytes?hash(sourceReviewBytes):null,evidenceReviewSha256:evidenceReviewBytes?hash(evidenceReviewBytes):null,reviewedExcerptCount:reviewedExcerpts.size,issuesSha256:issueBytes?hash(issueBytes):null,summary:data.summary,layouts,sheets:specs.map(s=>({name:s.name,rows:s.rows.length,headers:s.headers})),wideSlots:wide.slots,wideImageCells:wide.imageCells,shortSkuCollisions:data.skus.length-new Set(data.skus.map(s=>shortSku(s.skuId))).size,productionWrites:0,humanReviewCellsBlank:true};
await fs.writeFile(path.join(out,'sku-workbook-verification.json'),JSON.stringify(verification,null,2)+'\n');
console.log(JSON.stringify({output:file,skus:data.summary.skus,rows:data.rows.length,suggested:counts.proposed??0,productionWrites:0}));
