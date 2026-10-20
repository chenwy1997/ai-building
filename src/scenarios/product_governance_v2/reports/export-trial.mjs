import fs from 'node:fs/promises';
import path from 'node:path';
import {Workbook,SpreadsheetFile} from '@oai/artifact-tool';
const run=path.resolve(process.argv[2]),data=JSON.parse(await fs.readFile(path.join(run,'report-data.json'),'utf8')),trial=JSON.parse(await fs.readFile(path.join(run,'trial/report.json'),'utf8'));
// Excel timestamps use Beijing wall time; raw API timestamps remain in the ledger.
for(const row of data.calls)for(const i of [12,13])if(row[i])row[i]=new Date(new Date(row[i]).getTime()+8*3600000);
const wb=Workbook.create(),font='Arial',qa=path.join(run,'trial/report-qa'),out=path.join(run,'清洁纸品V2三类属性卡与商品试填评估.xlsx');
const col=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
const literal=v=>typeof v==='string'&&/^[=+@]/.test(v)?"'"+v:v??'';
const detailHeaders=['序号','类目ID','完整类目路径','属性ID','属性名','商品源ID','三横标题','销售规格','必填策略','字段类型','单位','试填状态','试填值','原始值/候选','枚举覆盖','现有枚举','采纳来源','证据原文','计算公式','缺失主因','填写/缺失说明','归属状态','建议V2目标路径','建议目标ID','目标确认状态','三横初填候选值','京东作用','样本批次','计入总体分母','计入必填分母','已填写计数','必填已填计数','运营审核','运营意见','证据定位ID'];
const detailWidths=[8,40,49,29,23,40,95,55,14,12,14,17,30,55,19,60,22,100,42,30,100,17,55,40,28,30,26,26,18,18,17,18,20,50,90];
const defs=[
 ['试填评估',['末级类目','明细商品数','符合商品数','排除商品数','可适用项数','已填写项数','总体填充率','必填项数','必填已填数','必填填充率','不适用项数','枚举外已填','京东参与补出'],trial.metrics,[18,13,13,13,15,15,15,15,15,15,16,16,18]],
 ...trial.sheets.map(s=>[s.name,detailHeaders,s.rows,detailWidths]),
 ['完整属性卡',['序号','类目ID','完整类目路径','末级类目','属性ID','属性名','公共/特性','建模维度','字段类型','单位','必填策略','触发条件','SKU/SPU','取值口径','属性定义','描述对象','用途','采用/必填理由','枚举值','枚举边界及扩充','排除含义','运营审核状态','运营意见'],data.cards,[8,40,48,16,29,23,18,20,13,12,16,55,13,35,80,55,23,70,55,70,55,19,55]],
 ['缺项与枚举',['序号','类目ID','完整类目路径','属性ID','属性名','必填策略','符合商品数','可适用项数','已填写项数','填充率','缺失项数','缺失原因分布','现有枚举','枚举外候选值','后续处理','京东参与补出'],trial.attrStats,[8,40,48,29,23,15,15,15,15,15,15,75,70,60,65,18]],
 ['归属与同品',['序号','类目ID','完整类目路径','商品源ID','三横标题','销售规格','归属状态','归属判断依据','V2目标路径','V2目标ID','目标确认状态','纳入原类填充率','补证方式','上游京东SKU','同品核对结果','核对依据','京东链接','DS商品复核','补充说明'],trial.products,[8,40,48,40,95,55,20,100,55,40,30,20,28,30,32,100,65,28,85]],
 ['试填口径与问题',['规则编号','适用类目','属性/范围','发现的问题','本次处理','后续卡片或流程改进','商品例子'],trial.issues,[14,25,40,85,100,100,40]],
 ['规则与反例',['末级类目','类目ID','属性ID','属性名','直接填写规则','计算算子','计算公式','输入及口径','前提条件','缺失处理','冲突处理','合成正反例'],data.rules,[18,40,29,23,85,15,48,55,70,55,55,100]],
 ['共用规则',['规则ID','统一业务规则','程序检查及语义审核分工','规则版本'],data.sharedRules,[14,100,100,30]],
 ['本地模板采纳',['序号','类目ID','完整类目路径','末级类目','参考模板','参考属性','原表必填','原表类型','原表枚举/示例','最终处理','目标属性ID','处理理由','落地方式','来源Sheet','来源行','本地来源定位','DS初步处理','DS初步理由'],data.localReference,[8,40,48,18,16,22,14,14,80,18,60,100,100,22,12,100,18,100]],
 ['来源依据',['末级类目','属性ID','属性名','关系','支持主张','来源类别','平台','来源定位','获取形式','原文引用','内容哈希','获取时间'],data.sources,[18,29,23,12,70,24,30,90,28,100,68,28]],
 ['抽样记录',['序号','类目ID','商品源ID','三横标题','销售规格','抽样批次','明细范围','归属判断','判断理由','目标候选ID','审核阶段'],trial.screens,[8,40,40,95,60,28,25,20,95,40,45]],
 ['试填裁定',['序号','商品源ID','商品标题','裁定类型','属性ID','修订前/DS意见','修订后','Codex依据'],trial.decisions,[8,40,95,25,29,110,110,110]],
 ['建模评审与修改',['末级类目','阶段','评审项','属性ID','问题/修改内容','严重度','修改建议','DS结论'],data.findings,[18,18,20,29,100,15,100,18]],
 ['建模Codex裁定',['末级类目','状态','抽查属性ID','裁定说明','遗留事项','属性卡哈希','审核时间'],data.decisions,[18,25,65,110,100,68,28]],
 ['调用成本',['请求ID','调用类型','业务阶段','状态','响应模型','输入Token','缓存命中Token','输出Token','思考Token','费用估算上界(元)','预留上界(元)','耗时(秒)','开始时间(北京时间)','完成时间(北京时间)'],data.calls,[70,18,22,20,35,17,19,17,17,22,22,17,28,28]],
];
const header=(sh,range)=>sh.getRange(range).format={fill:'#243E59',font:{name:font,size:10,bold:true,color:'#FFFFFF'},rowHeight:38,wrapText:true,horizontalAlignment:'center',verticalAlignment:'center'};
for(const [name,headers,rows,widths] of defs){
 const sh=wb.worksheets.add(name),last=col(headers.length-1),end=rows.length+5;sh.showGridLines=false;
 sh.getRange(`A1:${last}${Math.max(end,9)}`).format.font={name:font,size:10,color:'#243247'};
 sh.getRange('A2').values=[[name==='试填评估'?'清洁纸品三类｜属性卡与文本试填':name]];
 sh.getRange('A2').format.font={name:font,size:15,bold:true,color:'#17365D'};
 widths.forEach((w,i)=>sh.getRange(`${col(i)}1:${col(i)}${Math.max(end,9)}`).format.columnWidth=w);
 sh.getRange(`A5:${last}5`).values=[headers];header(sh,`A5:${last}5`);
 if(rows.length){
  sh.getRange(`A6:${last}${end}`).values=rows.map(r=>r.map(literal));
  sh.tables.add(`A5:${last}${end}`,true,`Trial_${defs.findIndex(d=>d[0]===name)}`).showFilterButton=true;
  sh.getRange(`A6:${last}${end}`).format.wrapText=true;
  sh.getRange(`A6:${last}${end}`).format.verticalAlignment='top';
  for(let i=0;i<rows.length;i++){
   const lines=Math.max(...rows[i].map((v,j)=>String(v??'').split('\n').reduce((n,s)=>n+Math.max(1,Math.ceil([...s].reduce((n,c)=>n+(c.charCodeAt(0)>255?2:1),0)/Math.max(6,widths[j]-2))),0)));
   sh.getRange(`A${i+6}:${last}${i+6}`).format.rowHeight=Math.min(409,Math.max(32,lines*13+8));
  }
  if(name!=='试填评估'){sh.freezePanes.freezeRows(5);sh.freezePanes.freezeColumns(1);}
 }
 if(trial.sheets.some(s=>s.name===name)){
  sh.tabColor='#274B68';
  sh.getRange('A3').values=[['一行=一个商品的一个属性；错挂/归属待确认保留明细但排除分母。黄色列供运营填写。']];
  sh.getRange(`AG6:AH${end}`).format.fill='#FFF2CC';
  sh.getRange(`AG6:AG${end}`).dataValidation={rule:{type:'list',values:['待运营审核','通过','需修改']}};
  sh.getRange(`L6:L${end}`).conditionalFormats.add('containsText',{text:'冲突',format:{fill:'#FCE4D6',font:{color:'#9C0006'}}});
  sh.getRange(`O6:O${end}`).conditionalFormats.add('containsText',{text:'枚举外',format:{fill:'#FFF2CC'}});
  sh.getRange(`AC6:AF${end}`).setNumberFormat('0');
 }
 if(name==='完整属性卡'){
  sh.getRange('A3').values=[['55条绑定，按类目连续分组。保留当前发布卡；试填发现的规则矛盾与拟修订项见“试填口径与问题”。']];
  sh.getRange(`V6:W${end}`).format.fill='#FFF2CC';
  sh.getRange(`V6:V${end}`).dataValidation={rule:{type:'list',values:['待运营审核','通过','需修改']}};
 }
 if(name==='建模Codex裁定'||name==='建模评审与修改')sh.getRange('A3').values=[['本地参考复核阶段的历史记录；本次商品验证与补样结果以“试填评估”和“试填裁定”为准。']];
 if(name==='规则与反例')sh.getRange('A3').values=[['当前发布规则快照；本次发现的反例矛盾及试填解释单列在“试填口径与问题”，未覆盖历史记录。']];
 if(name==='缺项与枚举')for(let i=0;i<rows.length;i++){sh.getRange(`J${i+6}`).formulas=[[`=IFERROR(I${i+6}/H${i+6},0)`]];sh.getRange(`J${i+6}`).setNumberFormat('0.0%');}
 if(name==='调用成本'){sh.getRange(`J6:K${end}`).setNumberFormat('0.000000');sh.getRange(`L6:L${end}`).setNumberFormat('0.0');sh.getRange(`M6:N${end}`).setNumberFormat('yyyy-mm-dd hh:mm:ss');}
}
const sh=wb.worksheets.getItem('试填评估');sh.tabColor='#17365D';
sh.getRange('A3').values=[['DeepSeek官方API并发执行，Codex裁定异常；仅评估模板适配，不代表生产填充结果或准确率。']];
for(let i=0;i<trial.sheets.length;i++){
 const s=trial.sheets[i],end=s.rows.length+5,row=i+6;
 sh.getRange(`E${row}:F${row}`).formulas=[[`=SUM('${s.name}'!AC6:AC${end})`,`=SUM('${s.name}'!AE6:AE${end})`]];
 sh.getRange(`G${row}`).formulas=[[`=IFERROR(F${row}/E${row},0)`]];
 sh.getRange(`H${row}:J${row}`).formulas=[[`=SUM('${s.name}'!AD6:AD${end})`,`=SUM('${s.name}'!AF6:AF${end})`,`=IFERROR(I${row}/H${row},0)`]];
}
sh.getRange('A9').values=[['合计']];
for(let c=1;c<13;c++)if(![6,9].includes(c))sh.getRange(`${col(c)}9`).formulas=[[`=SUM(${col(c)}6:${col(c)}8)`]];
sh.getRange('G9').formulas=[['=IFERROR(F9/E9,0)']];sh.getRange('J9').formulas=[['=IFERROR(I9/H9,0)']];
sh.getRange('A6:M9').format.rowHeight=32;sh.getRange('A9:M9').format.font={name:font,size:10,bold:true,color:'#17365D'};
sh.getRange('G6:G9').setNumberFormat('0.0%');sh.getRange('J6:J9').setNumberFormat('0.0%');
sh.getRange('A12').values=[['缺失原因｜按属性项计数']];
sh.getRange('A12').format.font={name:font,size:12,bold:true,color:'#17365D'};
sh.getRange('A14:E14').values=[['缺失主因','缺失项数','占全部缺失','必填缺失数','占必填缺失']];header(sh,'A14:E14');
sh.getRange(`A15:E${14+trial.reasons.length}`).values=trial.reasons;
sh.getRange('A15:A21').format.wrapText=true;sh.getRange('A15:E21').format.rowHeight=45;
for(let i=0;i<trial.reasons.length;i++){
 const row=i+15;
 sh.getRange(`C${row}`).formulas=[[`=IFERROR(B${row}/($E$9-$F$9),0)`]];
 sh.getRange(`E${row}`).formulas=[[`=IFERROR(D${row}/($H$9-$I$9),0)`]];
}
sh.getRange('C15:C21').setNumberFormat('0.0%');sh.getRange('E15:E21').setNumberFormat('0.0%');
sh.getRange('H12').values=[['样本与投入']];
sh.getRange('H12').format.font={name:font,size:12,bold:true,color:'#17365D'};
const stats=[
 ['筛选原始候选数',90],['纸巾盒有效样本',11],['DeepSeek复核商品',trial.summary.reviewed],
 ['试填新增费用(元)',trial.summary.trialCost],['本轮累计费用(元)',null],['累计预算上限(元)',50],['剩余预算(元)',null],
 ['已填含京东证据项',trial.summary.jdSupported],
];
for(let i=0;i<stats.length;i++){sh.getRange(`H${i+14}`).values=[[stats[i][0]]];sh.getRange(`K${i+14}`).values=[[stats[i][1]]];sh.getRange(`H${i+14}:K${i+14}`).format.rowHeight=38;}
sh.getRange('K18').formulas=[[`=SUM('调用成本'!J6:J${data.calls.length+5})`]];
sh.getRange('K20').formulas=[['=K19-K18']];
sh.getRange('K17:K20').setNumberFormat('0.0000');
const notes=[
 '统计口径：仅28件归属符合商品；500个属性槽，排除16个已证实不适用项，484项计入总体分母。',
 '必填口径：固定必填＋条件必填；条件未知保守计入分母，不能默认不适用。枚举外真实值仍算已填写。',
 '抽样口径：原30件随机样本＋补抽60件纸巾盒候选中选取9件；最终39件含10件错挂、1件边界待确认。',
 '有效样本：软包抽纸9件、湿纸巾8件、纸巾盒11件。补充样本经过筛选，不能外推全类错挂率或填充率。',
 '来源边界：不提取任何图片文字。京东只在同品核对后补充；本地震坤行仅用于属性设计，不作商品值证据。',
 '补证结果：27件有京东详情，22件同品准入、5件身份/规格未确认；另1件无京东来源检索未找到可核实同品。',
 '费用为实际Token按官方单价估算，非供应商账单。沿用同一50元预算；未切换其他模型或按量备用通道。',
 '优先改进：修正抽数反例、组合数量前提、兼容纸巾多值、表面工艺拆分；保留完整发布卡与试填裁定的差异。',
 '未执行：图片/OCR、批量线上填写或类目迁移、运营准确率验收；当前仅三类试填，不宣布21类闭环完成。',
];
for(let i=0;i<notes.length;i++){sh.getRange(`A${i+24}`).values=[[notes[i]]];sh.getRange(`A${i+24}:M${i+24}`).format.rowHeight=25;}
await fs.mkdir(qa,{recursive:true});wb.recalculate();
const summary=await wb.inspect({kind:'table',range:'试填评估!A5:M9',include:'values,formulas',tableMaxRows:6,tableMaxCols:13});
await fs.writeFile(path.join(qa,'summary.json'),summary.ndjson);
const scan=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:80},summary:'formula errors'});
await fs.writeFile(path.join(qa,'formula-errors.json'),scan.ndjson);
for(const [name] of defs){
 if(process.argv.includes('--qa-update')&&!['试填评估','软包抽纸','纸巾盒','缺项与枚举','试填裁定','建模Codex裁定','建模评审与修改','规则与反例','调用成本'].includes(name))continue;
 const range=name==='试填评估'?'A1:M32':trial.sheets.some(s=>s.name===name)?'J5:U8':'A1:F8';
 const image=await wb.render({sheetName:name,range,scale:1,format:'png'});
 await fs.writeFile(path.join(qa,name+'.png'),new Uint8Array(await image.arrayBuffer()));
}
for(const [name,range,label] of [['软包抽纸','J5:O12','软抽值'],['湿纸巾','J5:O12','湿巾值'],['纸巾盒','J62:O68','盒样本值'],['调用成本','J5:N9','费用与日期']]){
 const preview=await wb.render({sheetName:name,range,scale:1,format:'png'});
 await fs.writeFile(path.join(qa,label+'.png'),new Uint8Array(await preview.arrayBuffer()));
}
await (await SpreadsheetFile.exportXlsx(wb)).save(out);
console.log(JSON.stringify({output:out,sheets:defs.length,summary:trial.summary}));
