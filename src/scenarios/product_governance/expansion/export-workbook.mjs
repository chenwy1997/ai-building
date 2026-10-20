import fs from 'node:fs/promises';
import path from 'node:path';
import {Workbook,SpreadsheetFile} from '@oai/artifact-tool';
const root=process.cwd(),dir=path.join(root,'outputs/product-governance/clean-paper-five-20261019');
const read=async f=>JSON.parse(await fs.readFile(path.join(dir,f),'utf8'));
const previewOnly=process.argv.includes('--preview');
const cardsOnly=process.argv.includes('--cards-only');
const [d,s,manifest,review,brands]=await Promise.all([previewOnly?'analysis/assembled.json':'analysis/final.json','design/standard.json','inputs/manifest.json','design/adjudication.json','inputs/brand-reference.json'].map(read));
if(!previewOnly&&d.status!=='codex-adjudicated-await-operations-audit')throw new Error('最终裁定未完成');
const ruleCatalog=JSON.parse(await fs.readFile(path.join(root,'src/scenarios/product_governance/expansion/rule-catalog.json'),'utf8'));
const sampled=d.byCategory,wb=Workbook.create(),names=['评估总览','21类完整属性卡','相邻类目边界','共用规则',...sampled.map(c=>c.name),'缺项分析','错挂与待确认','字段证据与裁定','属性卡评审','模型与取证'];
// Group only the display copy; the frozen standard and model inputs stay intact.
const cardBindings=s.categories.flatMap(c=>s.bindings.filter(b=>b.categoryId===c.id));
if(cardBindings.length!==s.bindings.length)throw new Error('属性绑定存在未知类目，不能遗漏导出');
const sheets=Object.fromEntries(names.map(n=>[n,wb.worksheets.add(n)]));
const colors={navy:'#243D5C',blue:'#32669A',line:'#D7E0E9',muted:'#5A6C7F',amber:'#FFF0CF',red:'#FBE6E6',gray:'#EEF1F4'};
const col=n=>{let t='';for(n++;n;n=Math.floor((n-1)/26))t=String.fromCharCode(65+(n-1)%26)+t;return t;};
const val=v=>v===null||v===undefined?'':Array.isArray(v)?v.join('；'):typeof v==='boolean'?(v?'是':'否'):typeof v==='object'?JSON.stringify(v):v;
const safe=v=>typeof v==='string'&&v.startsWith('=')?"'"+v:v;
const categoryStatus={matched:'归属确认',wrong:'确认错挂',uncertain:'归属待确认'};
const status={filled:'已核实',enum_candidate:'枚举候选',needs_evidence:'待补证',conflict:'来源冲突',not_applicable:'不适用'};
const sourceName=f=>!f.evidenceId?(f.status==='not_applicable'?'不适用':'尚无可用证据'):String(f.evidenceId).startsWith('J')?'京东VOP同品详情':String(f.evidenceId).startsWith('V')?'同SKU主图视觉核验':f.evidenceId==='I'?'主图OCR':'三横标题/规格/品牌';
const rowHeight=(cells,widths,min=34,max=230)=>Math.min(max,Math.max(min,...cells.map((x,i)=>{const text=String(val(x));const len=[...text].reduce((n,c)=>n+(c.charCodeAt(0)>255?2:1),0);return (Math.ceil(len/Math.max(7,(widths[i]??22)-2))+text.split('\n').length-1)*14+8;})));
function base(sh,lastRow,lastCol,title){
 sh.showGridLines=false;const area=sh.getRange(`A1:${col(lastCol-1)}${lastRow}`);area.format.font={name:'Arial',size:10,color:'#243444'};area.format.rowHeight=24;area.format.verticalAlignment='center';
 sh.getRange('A2').values=[[title]];sh.getRange('A2').format.font={name:'Arial',size:14,bold:true,color:colors.navy};sh.getRange('A2').format.rowHeight=30;
 sh.getRange(`A3:${col(lastCol-1)}3`).format.borders={bottom:{style:'thin',color:colors.line}};
}
function table(sh,name,headers,rows,widths,{start=5,freeze=2,minHeight=32,maxHeight=230}={}){
 const end=start+rows.length;sh.getRange(`A${start}:${col(headers.length-1)}${end}`).values=[headers,...rows].map(r=>r.map(safe));
 sh.tables.add(`A${start}:${col(headers.length-1)}${end}`,true,name);
 const head=sh.getRange(`A${start}:${col(headers.length-1)}${start}`);head.format.fill=colors.navy;head.format.font={bold:true,color:'#FFFFFF',name:'Arial',size:10};head.format.rowHeight=34;head.format.wrapText=true;head.format.horizontalAlignment='center';head.format.borders={insideVertical:{style:'thin',color:'#FFFFFF'}};
 const body=sh.getRange(`A${start+1}:${col(headers.length-1)}${end}`);body.format.wrapText=true;body.format.verticalAlignment='center';body.format.fill='#FFFFFF';body.format.borders={insideVertical:{style:'thin',color:'#E1E6EA'}};
 widths.forEach((w,i)=>sh.getRange(`${col(i)}${start}:${col(i)}${end}`).format.columnWidth=w);
 rows.forEach((r,i)=>{const range=sh.getRange(`A${start+i+1}:${col(headers.length-1)}${start+i+1}`);range.format.rowHeight=rowHeight(r,widths,minHeight,maxHeight);if(i%2)range.format.fill='#F1F5F9';});
 sh.freezePanes.freezeRows(start);if(freeze)sh.freezePanes.freezeColumns(freeze);
 return end;
}
function applyStatus(sh,range){
 const r=sh.getRange(range);r.conditionalFormats.add('containsText',{text:'候选',format:{fill:colors.amber,font:{color:'#855800'}}});r.conditionalFormats.add('containsText',{text:'待补证',format:{fill:colors.amber,font:{color:'#855800'}}});r.conditionalFormats.add('containsText',{text:'冲突',format:{fill:colors.red,font:{color:'#993333'}}});r.conditionalFormats.add('containsText',{text:'不适用',format:{fill:colors.gray,font:{color:'#697886'}}});
}
function detailValue(f){if(f.status==='filled')return val(f.value);if(f.status==='enum_candidate')return '候选｜'+val(f.value);if(f.status==='not_applicable')return '不适用';return (status[f.status]??f.status)+(f.value!==null?'｜'+val(f.value):'');}

for(const cat of sampled){
 const sh=sheets[cat.name],ps=d.rows.filter(p=>p.categoryId===cat.id),bindings=s.bindings.filter(b=>b.categoryId===cat.id),attrs=bindings.map(b=>s.definitions.find(a=>a.id===b.attributeId));
 const headers=['样本键','商品源ID','三横标题','销售规格','归属状态','计入填充率','已填属性数','适用属性数','必填已填数','必填属性数','必填全齐',...attrs.map(a=>a.name+(a.unit?`（${a.unit}）`:'')),'原一级','原二级','原三级','原末级','原类目ID','京东SKU','目标末级','目标完整路径','目标类目ID','归属裁定依据','京东同品核对','主图视觉核验'];
 const rows=ps.map(p=>{const included=p.category.status==='matched',f=Object.values(p.fields).filter(f=>f.status!=='not_applicable'),req=f.filter(f=>f.required);return [p.key,p.id,p.title,p.saleSpec,categoryStatus[p.category.status],included?'是':'否',included?f.filter(f=>f.status==='filled').length:0,included?f.length:0,included?req.filter(f=>f.status==='filled').length:0,included?req.length:0,included&&req.every(f=>f.status==='filled')&&p.measurementGroups.every(g=>g.status==='not_applicable'||g.complete)?'是':'否',...attrs.map(a=>detailValue(p.fields[a.id])),...p.categoryPath.split('>'),p.categoryId,String(p.upstreamSku??''),p.category.targetName??'',p.category.targetPath??'',p.category.targetId??'',p.category.reason,p.jdSameProduct?`${p.jdSameProduct.status}｜${p.jdSameProduct.reason}`:'未查询',p.imageVerified?'是':'否'];});
 const widths=[10,39,64,35,16,13,12,12,12,12,14,...attrs.map(a=>a.id==='common.pack'?44:a.type==='文本'?32:22),18,18,18,18,39,20,18,52,39,65,65,16];
 base(sh,55,headers.length,cat.name+'｜50件ES在售随机样本');table(sh,'Products_'+cat.name,headers,rows,widths,{freeze:2,minHeight:64,maxHeight:180});sh.getRange('G6:J55').setNumberFormat('0');sh.getRange('B6:B55').setNumberFormat('@');applyStatus(sh,`L6:${col(10+attrs.length)}55`);
 sh.getRange('E6:E55').conditionalFormats.add('containsText',{text:'错挂',format:{fill:colors.red,font:{color:'#993333'}}});sh.getRange('E6:E55').conditionalFormats.add('containsText',{text:'待确认',format:{fill:colors.amber}});
}

{
 const sh=sheets['21类完整属性卡'],h=['末级类目','类目ID','完整类目路径','属性ID','属性名','公共/特性','字段类型','必填','值承载层级','标准单位','单选/多选','枚举/引用字典','属性定义','适用条件','填写规则与口径','计算公式','必填/选填理由','条件必填','规则算子','定义来源/旧字段映射','发布状态'];
 const rows=cardBindings.map(b=>{const a=s.definitions.find(a=>a.id===b.attributeId),c=s.categories.find(c=>c.id===b.categoryId);return [c.name,c.id,c.path,a.id,a.name,a.kind,a.type,b.required?'是':'否',b.level??'SKU',a.unit??'',a.selection??'不适用',a.enum?.join('；')??(a.dictionary?`品牌参考字典${brands.items.length}项，新值保留候选`:'不适用'),a.definition,b.applicability,a.rule,a.formula??'不推算；仅明确证据提取',b.rationale,val(b.requiredWhen??b.applicabilityRule??''),a.operator??a.semantic??'证据与语义复核',a.origin??a.legacyCode??'历史21类属性稿与本轮多模型评审、Codex修订',s.releaseId+'；运营待审核'];});
 base(sh,rows.length+5,h.length,`清洁纸品21类｜${s.definitions.length}个定义、${s.bindings.length}个绑定`);table(sh,'All21Cards',h,rows,[18,39,54,27,24,21,12,10,15,17,13,70,60,42,100,55,60,45,38,75,40],{freeze:1,minHeight:64,maxHeight:260});
 sh.getRange(`G6:G${rows.length+5}`).dataValidation={rule:{type:'list',values:['文本','数值','是否','选项','日期']}};
}
{
 const sh=sheets['相邻类目边界'],h=['末级类目','类目ID','完整路径','本类识别边界','归属证据要求','统一版本'];
 const rows=s.categories.map(c=>[c.name,c.id,c.path,typeof c.boundary==='string'?c.boundary:JSON.stringify(c.boundary),'依销售主体、内包装形态、干湿状态、用途与原图判断；销售单位字样不自动证明包装形态。证据不足保留待确认。',s.releaseId]);
 base(sh,rows.length+5,h.length,'21类相邻边界｜V2类目树与ID保持不变');table(sh,'CategoryBoundaries',h,rows,[20,39,55,125,80,35],{freeze:1,minHeight:80,maxHeight:230});
}
{
 const sh=sheets['共用规则'],h=['规则ID','共用规则','执行检查','异常处理','版本'];
 const rows=ruleCatalog.rules.map(r=>[r.id,r.name,r.checks.join('；'),ruleCatalog.adjudication,ruleCatalog.schema+' / '+ruleCatalog.version]);
 base(sh,rows.length+5,h.length,'共用规则已代码化｜明确错误与待复核语义分别记录');table(sh,'SharedRules',h,rows,[14,27,110,75,48],{freeze:1,minHeight:60,maxHeight:160});
}
{
 const sh=sheets['字段证据与裁定'],h=['样本键','商品源ID','原类目','归属状态','计入分母','属性ID','属性名','必填','最终状态','最终值/候选','单位','缺项主因','最终裁定依据','最终来源','证据ID','原始引文/视觉观察','来源定位','DeepSeek原值','DeepSeek引文','DeepSeek结构检查','Kimi原值','Kimi引文','Kimi结构检查','DeepSeek与Kimi值不同','GLM原值','GLM引文','GLM结构检查','Qwen原值','Qwen引文','Qwen结构检查','规则复核结论','京东DeepSeek建议','京东Kimi建议','计算式与输入口径'];
 const rows=d.fieldRecords.map(f=>[f.key,f.productId,f.category,categoryStatus[f.categoryStatus],f.inRate?'是':'否',f.attributeId,f.name,f.required?'是':'否',status[f.status]??f.status,val(f.value),f.unit??'',f.missingReason,f.reason,sourceName(f),f.evidenceId??'',f.quote??'',f.sourceRef??'',val(f.deepseekValue),f.deepseekQuote,f.deepseekCheck,val(f.kimiValue),f.kimiQuote,f.kimiCheck,f.modelValueDifferent?'是':'否',val(f.glmValue),f.glmQuote,f.glmCheck,val(f.qwenValue),f.qwenQuote,f.qwenCheck,f.ruleReview??'',val(f.jdDeepseekValue),val(f.jdKimiValue),val(f.calculation??'')]);
 base(sh,rows.length+5,h.length,'逐字段证据、四模型意见与Codex最终裁定');table(sh,'FieldAudit',h,rows,[10,39,18,17,12,25,23,10,14,38,16,25,85,26,14,80,80,38,65,46,38,65,46,16,38,65,46,38,65,46,80,38,38,95],{freeze:1,minHeight:54,maxHeight:230});applyStatus(sh,`I6:I${rows.length+5}`);
}
{
 const sh=sheets['错挂与待确认'],ps=d.rows.filter(p=>p.category.status!=='matched'),h=['样本键','商品源ID','原末级','原类目ID','三横标题','销售规格','裁定状态','V2承接结论','目标末级','目标完整路径','目标类目ID','裁定依据','DeepSeek意见','Kimi意见','GLM意见','Qwen意见','下一步','计入填充率'];
 const rows=ps.map(p=>[p.key,p.id,p.categoryName,p.categoryId,p.title,p.saleSpec,categoryStatus[p.category.status],p.category.targetConfirmed?'V2已有明确目标':p.category.issueType??'需补信息/边界确认',p.category.targetName??'',p.category.targetPath??'',p.category.targetId??'',p.category.reason,JSON.stringify(p.models.deepseek?.category),JSON.stringify(p.models.kimi?.category),JSON.stringify(p.models.glm?.category),JSON.stringify(p.models.qwen?.category),p.category.targetConfirmed?'运营确认后迁移，并按目标卡重填':'核实当前售卖主体、包装或干湿状态，保留候选；不贸然新增类目','否']);
 base(sh,rows.length+5,h.length,'全部错挂和待确认商品｜已有目标ID与需补信息分别展示');table(sh,'MountReview',h,rows,[10,39,18,39,70,35,18,30,20,58,39,90,80,80,80,80,65,15],{freeze:1,minHeight:70,maxHeight:230});
}
{
 const sh=sheets['缺项分析'];base(sh,d.perAttribute.length+20,10,'缺项主因与占比｜只统计归属确认、属性适用的槽位');
 const h=['缺项主因','缺项数','占全部缺项','占适用槽位','其中必填缺项','占必填缺项'],rows=d.missingCounts.map(x=>[x.reason,x.count,null,null,x.required,null]);
 table(sh,'MissingReasons',h,rows,[32,15,20,20,20,20],{start:5,freeze:0});
 for(let i=0;i<rows.length;i++){const r=i+6;sh.getRange(`C${r}:D${r}`).formulas=[[`=IFERROR(B${r}/SUM($B$6:$B$${5+rows.length}),0)`,`=IFERROR(B${r}/'评估总览'!F11,0)`]];sh.getRange(`F${r}`).formulas=[[`=IFERROR(E${r}/SUM($E$6:$E$${5+rows.length}),0)`]];}
 sh.getRange(`C6:D${5+rows.length}`).setNumberFormat('0.0%');sh.getRange(`F6:F${5+rows.length}`).setNumberFormat('0.0%');
 const start=Math.max(14,rows.length+8),h2=['类目','属性','必填','适用槽位','已填','缺项','枚举候选','填充率','缺项原因分布','优先补证方向'];
 const r2=d.perAttribute.map(a=>[a.category,a.attribute,a.required?'是':'否',a.slots,a.filled,a.missing,a.candidates,null,Object.entries(a.reasons).map(([k,v])=>`${k}：${v}`).join('；'),a.required?'核心参数优先补证；缺项不造值':'有业务价值的选填属性保留，后续补资料']);
 table(sh,'MissingAttributes',h2,r2,[24,25,12,15,15,15,15,18,68,60],{start,freeze:2,minHeight:42,maxHeight:110});r2.forEach((_,i)=>{const r=start+1+i;sh.getRange(`H${r}`).formulas=[[`=IFERROR(E${r}/D${r},0)`]];});sh.getRange(`H${start+1}:H${start+r2.length}`).setNumberFormat('0.0%');
}
{
 const sh=sheets['属性卡评审'],h=['意见ID','轮次','模型','属性/类目','优先级','模型指出的问题','模型建议','裁定动作','Codex裁定理由','裁定者'];
 const rows=[...review.decisions,...(d.templateIssues?.issues??[])].map(r=>[r.id,r.round??'',r.model,r.attributeId??r.attribute??r.category??'',r.severity??'',r.problem,r.proposedFix??r.recommendedChange??'',r.action,r.reason,'Codex']);
 base(sh,rows.length+5,h.length,'两模型独立评审21类属性稿｜保留被采纳及未采纳的理由');table(sh,'CardDecisions',h,rows,[18,14,15,35,14,95,85,25,100,15],{freeze:1,minHeight:76,maxHeight:230});
}
{
 const sh=sheets['模型与取证'],h=['阶段','模型','配置别名','响应模型名','精确版本已知','原调用状态','恢复方式','开始UTC','结束UTC','输入token','输出token','已记录估算USD','错误摘要','原始记录','推理参数','用量取自'];
 const rows=d.modelRecords.map(r=>{const n=d.normalizedRecords.find(n=>n.sourceRecord===r.file);return [r.stage,r.model,r.alias,r.responseModel,r.actualVersionKnown?'是':'否',r.status,n?.syntaxRecovery?.method??'无',r.startedAt,r.completedAt,r.usage?.prompt_tokens??r.usage?.input_tokens??'未返回',r.usage?.completion_tokens??r.usage?.output_tokens??'未返回',r.estimatedUsd??'未知',r.error,r.file,r.reasoningEffort,r.usageSource];});
 base(sh,rows.length+5,h.length,'真实模型调用记录｜原始失败、修复及费用缺失均保留');table(sh,'ModelCalls',h,rows,[30,15,34,26,17,18,60,29,29,16,16,23,70,80,24,24],{freeze:1,minHeight:48,maxHeight:150});sh.getRange(`L6:L${rows.length+5}`).setNumberFormat('0.000000');
}
{
 const sh=sheets['评估总览'];base(sh,46,13,'清洁纸品21类标准与5类250件商品试填评估');
 const h=['末级类目','随机样本','计入商品','确认错挂','归属待确认','属性槽位','已填属性','总体填充率','必填槽位','必填已填','必填填充率','必填全齐商品','必填全齐比例'];
 sh.getRange('A5:M11').values=[h,...sampled.map(c=>[c.name,...Array(12).fill(null)]),['样本合计',...Array(12).fill(null)]];
 [20,13,13,13,15,14,14,18,14,14,18,19,19].forEach((w,i)=>sh.getRange(`${col(i)}5:${col(i)}46`).format.columnWidth=w);
 sh.getRange('A5:M5').format={fill:colors.navy,font:{name:'Arial',bold:true,color:'#FFFFFF'},wrapText:true,rowHeight:36,horizontalAlignment:'center'};
 sampled.forEach((c,i)=>{const r=6+i,q=`'${c.name}'`;sh.getRange(`B${r}:M${r}`).formulas=[[`=COUNTA(${q}!A6:A55)`,`=COUNTIF(${q}!F6:F55,"是")`,`=COUNTIF(${q}!E6:E55,"确认错挂")`,`=COUNTIF(${q}!E6:E55,"归属待确认")`,`=SUM(${q}!H6:H55)`,`=SUM(${q}!G6:G55)`,`=IFERROR(G${r}/F${r},0)`,`=SUM(${q}!J6:J55)`,`=SUM(${q}!I6:I55)`,`=IFERROR(J${r}/I${r},0)`,`=COUNTIF(${q}!K6:K55,"是")`,`=IFERROR(L${r}/C${r},0)`]];});
 for(let i=1;i<13;i++)sh.getRange(`${col(i)}11`).formulas=[[i===7?'=IFERROR(G11/F11,0)':i===10?'=IFERROR(J11/I11,0)':i===12?'=IFERROR(L11/C11,0)':`=SUM(${col(i)}6:${col(i)}10)`]];
 sh.getRange('B6:M11').setNumberFormat('#,##0');for(const c of ['H','K','M'])sh.getRange(`${c}6:${c}11`).setNumberFormat('0.0%');sh.getRange('A6:M11').format.rowHeight=30;sh.getRange('A11:M11').format.fill='#E8EEF5';sh.getRange('A11:M11').format.font={bold:true};
 sh.getRange('A14:D20').values=[['抽样总体（查询时点）','在售商品数','抽样数','样本占该类'],...manifest.categories.map(c=>[c.name,c.population.value,c.sampleSize,null]),['合计',null,null,null]];sh.getRange('A14:D14').format={fill:colors.navy,font:{bold:true,color:'#FFFFFF'},rowHeight:34,wrapText:true};
 for(let r=15;r<=19;r++)sh.getRange(`D${r}`).formulas=[[`=C${r}/B${r}`]];sh.getRange('B20:D20').formulas=[['=SUM(B15:B19)','=SUM(C15:C19)','=C20/B20']];sh.getRange('B15:C20').setNumberFormat('#,##0');sh.getRange('D15:D20').setNumberFormat('0.0%');
 const notes=[['抽样口径','ES商品源；精确末级ID；SPU/SKU均启用且在售，排除已删除和标准商品库。每类50件，随机种子及原查询保留。'],['标准范围',`21个末级、${s.definitions.length}个定义、${s.bindings.length}个绑定；本轮5类250件；不把前轮150件混入本次比例。`],['计算口径','填充率=已核实值÷适用槽位；必填率只统计业务必填槽位；错挂、待确认排除原类分母，枚举候选不计正式填充。'],['归属结果',`${d.counts.wrong}件错挂，其中${d.rows.filter(p=>p.category.status==='wrong'&&p.category.targetConfirmed).length}件有V2已确认目标；${d.counts.uncertain}件归属待确认。详见归属表。`],['多模型流程',`DeepSeek填写${d.modelCoverage.deepseek}件，Kimi独立盲审${d.modelCoverage.kimi}件，GLM ${d.modelCoverage.glm}件、Qwen ${d.modelCoverage.qwen}件独立补充审核，再由Codex逐件裁定。机器规则与原文定位一起检查。`],['图像取证',`${d.evidenceStats.imageDownloaded}张主图下载、${d.evidenceStats.imageOcrWithText}张OCR有文本、${d.evidenceStats.imageVisualReviewed}件视觉核验。OCR线索不直接视作最终事实。`],['京东补证',`${d.evidenceStats.jdQueried}件查询，${d.evidenceStats.jdSuccessful}件返回，${d.evidenceStats.jdSameProductConfirmed}件同品核对通过，${d.evidenceStats.jdFieldUses}项最终属性采用京东来源。`],['数量规则','数量、计数单位、内包装单位分别记录；抽/张/片/段不默认换算。只在同一销售单元、同规格且口径清楚时计算。'],['冲突处理','新旧包装混售、标题/所选规格/主图数量或香型冲突均保留，不默选一方；是否字段未知不填否。'],['来源与来源边界','复用旧属性稿作为定义依据；本轮没有把未逐项核对的震坤行字段标成直接引用。SKU值逐字段标三横、主图或京东来源。'],['模型调用',`${d.modelStats.calls}次调用；原始失败${d.modelStats.rawFailures}次，语法恢复${d.modelStats.syntaxRecoveries}次。记录已知用量DeepSeek小计$${d.modelStats.deepseekRecordedCostSubtotalUsd.toFixed(4)}；超时未返回的用量、Kimi及OpenCode订阅现金费用未估算。`],['质量结论边界','这是证据可追溯的Codex试填裁定，运营随机抽检尚未进行；模型同意率不等于准确率。'],['统计适用范围','等额样本合计比例仅描述这250件，不能直接外推5类总体、21类或全部标准商品。'],['属性建模待完善','洗脸巾供给形态的单选枚举混合了卷式结构与抽取动作；本轮保留原词候选，单列缺项原因，下一版拆开两个维度。'],['线上状态',`版本${s.releaseId}；待运营审核。未执行错挂迁移、属性回写或线上同步。`],['阅读顺序','先看本页 → 5类商品表 → 缺项分析/错挂与待确认 → 字段证据与裁定；统一标准见21类完整属性卡。']];
 notes.forEach((n,i)=>{const r=23+i;sh.getRange(`A${r}`).values=[[n[0]]];sh.getRange(`B${r}`).values=[[n[1]]];sh.getRange(`A${r}`).format.font={bold:true,color:colors.muted};sh.getRange(`B${r}:M${r}`).merge();sh.getRange(`B${r}:M${r}`).format.wrapText=true;sh.getRange(`A${r}:M${r}`).format.rowHeight=36;});
}
wb.recalculate();await fs.mkdir(path.join(dir,'report-qa'),{recursive:true});
const inspection=await wb.inspect({kind:'region',sheetId:'评估总览',range:'A5:M20',maxChars:7000,tableMaxRows:16,tableMaxCols:13});await fs.writeFile(path.join(dir,'report-qa/overview-inspect.ndjson'),inspection.ndjson);
const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:30},maxChars:3000});await fs.writeFile(path.join(dir,'report-qa/formula-errors.ndjson'),errors.ndjson);
for(const name of names){if(cardsOnly&&name!=='21类完整属性卡')continue;const range=name==='评估总览'?'A2:M39':name==='21类完整属性卡'?'A2:J9':name==='相邻类目边界'?'A2:D8':name==='共用规则'?'A2:D9':name==='缺项分析'?'A2:F11':name==='字段证据与裁定'?'A2:J9':name==='属性卡评审'?'A2:F8':name==='模型与取证'?'A2:F9':name==='错挂与待确认'?'A2:H8':'A2:K9';const png=await wb.render({sheetName:name,range,scale:1.3,format:'png'});await fs.writeFile(path.join(dir,'report-qa',name+'.png'),new Uint8Array(await png.arrayBuffer()));}
for(const [name,range,label] of [['21类完整属性卡','L5:P8','属性规则'],['手帕纸','L5:U10','计数单位'],['字段证据与裁定','M5:Q9','来源引证']]){if(cardsOnly&&name!=='21类完整属性卡')continue;const png=await wb.render({sheetName:name,range,scale:1.2,format:'png'});await fs.writeFile(path.join(dir,'report-qa',label+'.png'),new Uint8Array(await png.arrayBuffer()));}
if(cardsOnly){const png=await wb.render({sheetName:'21类完整属性卡',range:'A297:I309',scale:1.1,format:'png'});await fs.writeFile(path.join(dir,'report-qa','属性卡末尾.png'),new Uint8Array(await png.arrayBuffer()));}
const output=path.join(dir,'清洁纸品21类属性卡与5类250件商品试填评估_20261019.xlsx');if(!previewOnly){const xlsx=await SpreadsheetFile.exportXlsx(wb);await xlsx.save(output);}console.log(JSON.stringify({output,sheets:names,counts:d.counts,formulaErrorScan:errors.ndjson}));

