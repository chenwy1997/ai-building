import fs from 'node:fs/promises';
import path from 'node:path';
import {Workbook,SpreadsheetFile} from '@oai/artifact-tool';

const root=process.cwd(),dir=path.join(root,'outputs/product-governance/three-category-20261019');
const previewOnly=process.argv.includes('--preview'),finalRenderOnly=process.argv.includes('--final-render');
const read=async f=>JSON.parse(await fs.readFile(path.join(dir,f),'utf8'));
const [d,s,manifest,review,brands]=await Promise.all([previewOnly?'analysis/report-preview.json':'analysis/final.json','design/standard.json','inputs/manifest.json','design/adjudication.json','inputs/brand-reference.json'].map(read));
if(!previewOnly&&d.status!=='codex-adjudicated-await-operations-audit')throw new Error('最终裁定未完成，不能交付');
const wb=Workbook.create(),names=['评估总览','完整属性卡','软包抽纸','湿纸巾','纸巾盒','缺项分析','错挂与待确认','字段证据与裁定','属性卡评审','模型与取证'];
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

// 三张商品表保留全部150件，原类不适用的商品也可筛选查看。
for(const cat of s.categories){const sh=sheets[cat.name],ps=d.rows.filter(p=>p.categoryId===cat.id),binds=s.bindings.filter(b=>b.categoryId===cat.id);
 const attrs=binds.map(b=>s.definitions.find(x=>x.id===b.attributeId));
 const headers=['样本键','商品源ID','三横标题','销售规格','归属状态','计入填充率','已填属性数','适用属性数','必填已填数','必填属性数','必填全部齐全',...attrs.map(x=>x.name+(x.unit?`（${x.unit}）`:'')),'原一级类目','原二级类目','原三级类目','原末级类目','原末级ID','上游京东SKU','建议目标类目','目标完整路径','目标类目ID','归属裁定依据','京东同品核对','主图已视觉核验'];
 const rows=ps.map(p=>{const eligible=p.category.status==='matched',fs=Object.values(p.fields),required=fs.filter(f=>f.required);const cp=p.categoryPath.split('>');return [p.key,p.id,p.title,p.saleSpec,categoryStatus[p.category.status],eligible?'是':'否',eligible?fs.filter(f=>f.status==='filled').length:0,eligible?fs.length:0,eligible?required.filter(f=>f.status==='filled').length:0,eligible?required.length:0,eligible&&required.every(f=>f.status==='filled')?'是':'否',...attrs.map(x=>detailValue(p.fields[x.id])),...cp,p.categoryId,String(p.upstreamSku??''),p.category.targetName??'',p.category.targetPath??'',p.category.targetId??'',p.category.reason,p.jdSameProduct?`${p.jdSameProduct.status}｜${p.jdSameProduct.reason}`:'未查询',p.imageVerified?'是':'否'];});
 const widths=[10,39,64,35,16,13,12,12,12,12,14,...attrs.map(x=>x.id==='common.pack'?44:x.type==='文本'?32:22),18,18,18,18,39,20,18,52,39,65,65,16];
 base(sh,55,headers.length,cat.name+'｜50件ES在售随机样本');table(sh,'Products_'+cat.name,headers,rows,widths,{freeze:2,minHeight:64,maxHeight:180});sh.getRange('G6:J55').setNumberFormat('0');sh.getRange('B6:B55').setNumberFormat('@');applyStatus(sh,`L6:${col(10+attrs.length)}55`);
 sh.getRange('E6:E55').conditionalFormats.add('containsText',{text:'错挂',format:{fill:colors.red,font:{color:'#993333'}}});sh.getRange('E6:E55').conditionalFormats.add('containsText',{text:'待确认',format:{fill:colors.amber}});
}

// 完整属性卡：定义与类目绑定分离，33个绑定均可单行审核。
{
 const sh=sheets['完整属性卡'];const rows=s.bindings.map(b=>{const a=s.definitions.find(x=>x.id===b.attributeId),c=s.categories.find(x=>x.id===b.categoryId),source=d.publication.definitionSources.find(x=>x.attributeId===a.id)?.source;return [c.name,c.id,c.path,a.id,a.name,a.kind,a.type,b.required?'是':'否',b.level,a.unit||'无',a.selection||'不适用',a.enum?.join('；')||(a.dictionary?`引用品牌参考字典（${brands.items.length}项）；新品牌保留候选`:'不适用'),a.definition,b.applicability,a.rule,a.formula??'不计算；仅按明确证据提取/归一',b.rationale,a.operator??'类型校验+证据校验+语义评审',source,'类目逻辑；识别/展示/筛选价值；单位与层级；证据可追溯',`版本${a.version}；运营待审核`];});
 const h=['末级类目','类目ID','完整类目路径','属性ID','属性名','属性归属','字段类型','是否必填','值承载层级','标准单位','单选/多选','枚举/引用范围','属性定义','适用条件','填写规则与口径','计算公式','必填/选填理由','规则算子','定义来源','合理性评判维度','发布状态'];
 const w=[18,39,52,22,22,20,12,12,14,16,14,70,52,35,100,42,60,42,60,54,25];base(sh,38,h.length,'三类完整属性卡｜25个公共/特性定义、33个类目绑定');table(sh,'AttributeCards',h,rows,w,{freeze:1,minHeight:64,maxHeight:280});
 sh.getRange('H6:H38').dataValidation={rule:{type:'list',values:['是','否']}};sh.getRange('G6:G38').dataValidation={rule:{type:'list',values:['文本','数值','是否','选项','日期']}};
}

// 逐字段保留两个模型原始建议、最终值、引用及缺项原因。
{
 const sh=sheets['字段证据与裁定'];const h=['样本键','商品源ID','原类目','归属状态','计入分母','属性ID','属性名','必填','最终状态','最终值/候选','单位','缺项主因','最终裁定依据','最终来源','证据ID','原始引文/视觉观察','来源定位','DeepSeek原始值','DeepSeek引文','DeepSeek结构/引文检查','Kimi原始值','Kimi引文','Kimi结构/引文检查','原始值存在差异','京东复核DeepSeek建议','京东复核Kimi建议','裁定者'];
 const rows=d.fieldRecords.map(f=>[f.key,f.productId,f.category,categoryStatus[f.categoryStatus],f.inRate?'是':'否',f.attributeId,f.name,f.required?'是':'否',status[f.status]??f.status,val(f.value),f.unit||'',f.missingReason,f.reason,sourceName(f),f.evidenceId??'',f.quote??'',f.sourceRef??'',val(f.deepseekValue),f.deepseekQuote,f.deepseekCheck,val(f.kimiValue),f.kimiQuote,f.kimiCheck,f.modelValueDifferent?'是':'否',val(f.jdDeepseekValue),val(f.jdKimiValue),'Codex']);
 const w=[10,39,18,17,12,22,22,10,14,35,14,24,85,25,16,75,75,35,65,46,35,65,46,18,35,35,12];base(sh,rows.length+5,h.length,'逐字段来源、模型意见与Codex裁定');table(sh,'FieldAudit',h,rows,w,{freeze:1,minHeight:54,maxHeight:230});applyStatus(sh,`I6:I${rows.length+5}`);
}

{
 const sh=sheets['错挂与待确认'];const ps=d.rows.filter(p=>p.category.status!=='matched');const h=['样本键','商品源ID','原末级','原类目ID','三横标题','销售规格','裁定状态','V2承接结论','目标末级','目标完整路径','目标类目ID','裁定依据','DeepSeek归属意见','Kimi归属意见','下一步','计入属性填充率'];
 const rows=ps.map(p=>[p.key,p.id,p.categoryName,p.categoryId,p.title,p.saleSpec,categoryStatus[p.category.status],p.category.status==='wrong'&&p.category.targetId?'V2已有目标':'需补信息/组合归类规则',p.category.targetName??'',p.category.targetPath??'',p.category.targetId??'',p.category.reason,JSON.stringify(p.models.deepseek.category),JSON.stringify(p.models.kimi.category),p.category.status==='wrong'?'运营确认目标后迁移；用目标类目卡重填':'核对实际售卖主体/包装；组合SKU先明确主类或拆分口径','否']);
 base(sh,ps.length+5,h.length,'错挂迁移建议与归属待确认清单');table(sh,'CategoryDecisions',h,rows,[10,39,18,39,70,35,18,25,18,55,39,88,80,80,65,15],{freeze:1,minHeight:80,maxHeight:220});
}

{
 const sh=sheets['缺项分析'];base(sh,60,10,'缺项原因与属性缺口｜只统计归属已确认商品');
 const h=['缺项主因','缺项数','占全部缺项','占适用属性槽位','其中必填缺项','占必填缺项'];const rs=d.missingCounts.map(x=>[x.reason,x.count,null,null,x.required,null]);table(sh,'MissingReasons',h,rs,[32,15,20,24,20,20],{start:5,freeze:0,minHeight:32});
 for(let i=0;i<rs.length;i++){let n=6+i;sh.getRange(`C${n}:D${n}`).formulas=[[`=B${n}/SUM($B$6:$B$${5+rs.length})`,`=B${n}/'评估总览'!F9`]];sh.getRange(`F${n}`).formulas=[[`=E${n}/SUM($E$6:$E$${5+rs.length})`]];}
 sh.getRange(`C6:D${5+rs.length}`).setNumberFormat('0.0%');sh.getRange(`F6:F${5+rs.length}`).setNumberFormat('0.0%');
 const start=14,headers=['类目','属性','必填','适用槽位','已填','缺项','枚举候选','填充率','缺项原因分布','优先补证方向'];
 const rows=d.perAttribute.map(a=>[a.category,a.attribute,a.required?'是':'否',a.slots,a.filled,a.missing,a.candidates,null,Object.entries(a.reasons).map(([k,v])=>`${k}：${v}`).join('；'),a.required?'优先补齐同SKU核心参数及冲突证据':'保留有价值选填字段；后续随详情补证']);
 table(sh,'MissingByAttribute',headers,rows,[24,25,12,15,15,15,15,18,65,54],{start,freeze:2,minHeight:42,maxHeight:110});for(let i=0;i<rows.length;i++)sh.getRange(`H${start+1+i}`).formulas=[[`=E${start+1+i}/D${start+1+i}`]];sh.getRange(`H${start+1}:H${start+rows.length}`).setNumberFormat('0.0%');sh.getRange('A11').values=[['主因互斥计数；“枚举候选”已保留原值，未计入正式填充。']];sh.getRange('A11').format.wrapText=false;
}

{
 const sh=sheets['属性卡评审'];const rows=review.decisions.map(r=>[r.id,r.model,r.attributeId,r.severity,r.basis,r.problem,r.recommendedChange,r.action,r.reason,r.adjudicator]);const h=['意见ID','评审模型','属性ID','优先级','评判依据','模型指出的问题','模型建议','裁定动作','Codex裁定理由','裁定者'];base(sh,rows.length+5,h.length,'属性定义的独立提案、交叉评审与最终取舍');table(sh,'CardReviews',h,rows,[20,15,25,14,20,90,80,25,100,15],{freeze:1,minHeight:76,maxHeight:230});
}

{
 const sh=sheets['模型与取证'];const h=['阶段','模型','配置模型别名','响应模型名','实际精确版本已知','原始调用状态','有效恢复方式','开始时间（UTC）','结束时间（UTC）','输入token','输出token','已记录费用估算USD','调用错误摘要','留存记录'];
 const rows=d.modelRecords.map(r=>{const n=d.normalizedRecords.find(n=>n.sourceRecord===r.file);return [r.stage,r.model,r.alias,r.responseModel??'未返回',r.actualVersionKnown?'是':'否',r.status,n?.syntaxRecovery?'仅删除JSON多余结束括号；值/键/引文未改':r.status==='failed'?'原失败保留；见独立重试或恢复记录':'无',r.startedAt,r.completedAt,r.usage?.prompt_tokens??'未返回',r.usage?.completion_tokens??'未返回',r.estimatedUsd??'未知',r.error,r.file];});
 base(sh,rows.length+5,h.length,'模型调用与取证记录｜保留失败和语法恢复，不把它们改成原调用成功');table(sh,'ModelRuns',h,rows,[28,15,32,25,18,18,58,29,29,16,16,25,65,75],{freeze:1,minHeight:48,maxHeight:140});sh.getRange(`L6:L${rows.length+5}`).setNumberFormat('0.000000');
}

// 主页所有计数来自商品明细，填充率按适用属性槽位计算。
{
 const sh=sheets['评估总览'];base(sh,43,13,'清洁纸品三类｜150件在售商品试填评估');sh.tabColor=colors.navy;
 const h=['末级类目','随机样本','计入商品','确认错挂','归属待确认','属性槽位','已填属性','总体填充率','必填槽位','必填已填','必填填充率','必填全齐商品','必填全齐比例'];
 sh.getRange('A5:M9').values=[h,...s.categories.map(c=>[c.name,...Array(12).fill(null)]),['样本合计',...Array(12).fill(null)]];
 const widths=[20,13,13,13,15,14,14,18,14,14,18,19,19];widths.forEach((w,i)=>sh.getRange(`${col(i)}5:${col(i)}43`).format.columnWidth=w);
 sh.getRange('A5:M5').format={fill:colors.navy,font:{name:'Arial',bold:true,color:'#FFFFFF'},wrapText:true,rowHeight:36,horizontalAlignment:'center'};
 for(let i=0;i<s.categories.length;i++){const c=s.categories[i],r=i+6,qn=`'${c.name}'`;sh.getRange(`B${r}:M${r}`).formulas=[[`=COUNTA(${qn}!A6:A55)`,`=COUNTIF(${qn}!F6:F55,"是")`,`=COUNTIF(${qn}!E6:E55,"确认错挂")`,`=COUNTIF(${qn}!E6:E55,"归属待确认")`,`=SUM(${qn}!H6:H55)`,`=SUM(${qn}!G6:G55)`,`=G${r}/F${r}`,`=SUM(${qn}!J6:J55)`,`=SUM(${qn}!I6:I55)`,`=J${r}/I${r}`,`=COUNTIF(${qn}!K6:K55,"是")`,`=L${r}/C${r}`]];}
 for(let i=1;i<13;i++)sh.getRange(`${col(i)}9`).formulas=[[i===7?'=G9/F9':i===10?'=J9/I9':i===12?'=L9/C9':`=SUM(${col(i)}6:${col(i)}8)`]];
 sh.getRange('B6:M9').setNumberFormat('#,##0');for(const c of ['H','K','M'])sh.getRange(`${c}6:${c}9`).setNumberFormat('0.0%');sh.getRange('A6:M9').format.rowHeight=30;sh.getRange('A9:M9').format.fill='#E8EEF5';sh.getRange('A9:M9').format.font={bold:true};
 sh.getRange('A12:D16').values=[['抽样总体（查询时点）','在售商品数','抽样数','样本占该类'],...manifest.categories.map(c=>[c.name,c.population.value,c.sampleSize,null]),['合计',null,null,null]];
 sh.getRange('A12:D12').format={fill:colors.navy,font:{bold:true,color:'#FFFFFF'},rowHeight:34,wrapText:true};for(let i=13;i<=15;i++)sh.getRange(`D${i}`).formulas=[[`=C${i}/B${i}`]];sh.getRange('B16:C16').formulas=[['=SUM(B13:B15)','=SUM(C13:C15)']];sh.getRange('D16').formulas=[['=C16/B16']];sh.getRange('B13:C16').setNumberFormat('#,##0');sh.getRange('D13:D16').setNumberFormat('0.0%');
 const notes=[
 ['口径','2026-10-19 00:11（北京时间）ES商品源；SPU/SKU启用且均在售，非标准商品库。'],
 ['总体填充率','归属已确认商品的已核实属性值数 ÷ 适用属性槽位；必填率只看必填槽位。'],
 ['错挂/待确认',`${d.counts.wrong}件确认错挂，均有V2现存目标；${d.counts.uncertain}件待核主体/组合口径，均排除分母。`],
 ['模型流程','DeepSeek初填150件 → Kimi盲审150件 → Codex逐件证据裁定；42件京东补证再独立双审。'],
 ['图片取证',`150张主图已下载、${d.evidenceStats.imageOcrWithText}张OCR有文本、${d.evidenceStats.imageVisualReviewed}件实际视觉核验；详情接口未返回详情正文/详情图。`],
 ['京东补证',`${d.evidenceStats.jdSuccessful}件有同SKU返回；${d.evidenceStats.jdSameProductConfirmed}件同品核对通过，2件规格冲突未采用；S07/S24为终审追加。`],
 ['来源贡献',Object.entries(d.evidenceStats.sourceCounts).map(([k,v])=>`${k} ${v}项`).join('；')],
 ['枚举候选',`${d.counts.enumCandidates}个值保留待扩充；纳入候选的槽位不计正式填充。卷纸大小未明归信息不足。`],
 ['枚举影响',`枚举候选仅占全部缺项${(100*d.counts.enumCandidates/(d.counts.slots-d.counts.filled)).toFixed(1)}%；全部审核通过最多增加${(100*d.counts.enumCandidates/d.counts.slots).toFixed(1)}个百分点。`],
 ['缺项重点','纸巾盒：盒体尺寸、材质；湿巾：主要用途。选填项保留价值，不能为填充率改必填。'],
 ['准确率','本轮是可追溯试填结果，尚无运营随机抽检准确率；模型同意率不等于准确率。'],
 ['适用范围','每类各50件为等额试点；合计是样本指标，不能外推三类商品总体或整个标准类目树。'],
 ['版本/线上','标准 clean-paper-three-v1；运营待审核。未执行商品迁移、属性回写或线上同步。'],
 ['属性卡','3类33个绑定、25个公共/特性定义；SKU层承载；未验证SPU关系，因此不做跨SKU继承。'],
 ['费用记录',`DeepSeek已记录用量的小计约$${d.modelStats.deepseekRecordedCostSubtotalUsd.toFixed(4)}，另${d.modelStats.deepseekUnknownUsageCalls}次失败用量未返回；Kimi订阅逐次费用未知。`],
 ['后续建议','运营从三个商品sheet随机抽检；优先核实错挂目标、缺核心参数、图片冲突，再决定扩到21类。'],
 ];
 const start=19;for(let i=0;i<notes.length;i++){let r=start+i;sh.getRange(`A${r}`).values=[[notes[i][0]]];sh.getRange(`B${r}`).values=[[notes[i][1]]];sh.getRange(`A${r}`).format.font={bold:true,color:colors.muted};sh.getRange(`B${r}`).format.wrapText=false;sh.getRange(`A${r}:M${r}`).format.rowHeight=26;}
 sh.getRange('A36').values=[['关键例子：W09每包16片；S05茶花香保留候选；B23尺寸缺单位，不能补猜mm；B32迁至盒装抽纸。']];sh.getRange('A36').format.wrapText=false;
 sh.getRange('A38').values=[['阅读顺序：评估总览 → 三类商品明细 → 缺项分析 → 字段证据与裁定；属性定义见完整属性卡。']];sh.getRange('A38').format.wrapText=false;
}

wb.recalculate();
const overview=await wb.inspect({kind:'region',sheetId:'评估总览',range:'A5:M16',maxChars:4000,tableMaxRows:12,tableMaxCols:13});
await fs.mkdir(path.join(dir,'report-qa'),{recursive:true});await fs.writeFile(path.join(dir,'report-qa/overview-inspect.ndjson'),overview.ndjson);
const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:30},maxChars:3000});await fs.writeFile(path.join(dir,'report-qa/formula-errors.ndjson'),errors.ndjson);
for(const name of (finalRenderOnly?['评估总览','模型与取证']:names)){const range=name==='评估总览'?'A2:M38':name==='完整属性卡'?'A2:J9':name==='缺项分析'?'A2:F10':name==='字段证据与裁定'?'A2:J9':name==='属性卡评审'?'A2:F8':name==='模型与取证'?'A2:F9':name==='错挂与待确认'?'A2:H8':'A2:K9';const png=await wb.render({sheetName:name,range,scale:1.4,format:'png'});await fs.writeFile(path.join(dir,'report-qa',name+'.png'),new Uint8Array(await png.arrayBuffer()));}
if(!finalRenderOnly)for(const [name,range,label] of [['完整属性卡','L5:P8','属性卡规则'],['软包抽纸','L5:U10','抽纸属性值'],['湿纸巾','L5:W10','湿巾属性值'],['纸巾盒','L5:V10','纸巾盒属性值'],['字段证据与裁定','M5:Q9','字段引证']]){const png=await wb.render({sheetName:name,range,scale:1.2,format:'png'});await fs.writeFile(path.join(dir,'report-qa',label+'.png'),new Uint8Array(await png.arrayBuffer()));}
if(!previewOnly){const output=path.join(dir,'清洁纸品3类属性卡与150件商品试填评估_20261019.xlsx');const xlsx=await SpreadsheetFile.exportXlsx(wb);await xlsx.save(output);console.log(JSON.stringify({output,sheets:names,counts:d.counts,formulaErrorScan:errors.ndjson}));}else console.log(JSON.stringify({previewOnly:true,counts:d.counts,formulaErrorScan:errors.ndjson}));
