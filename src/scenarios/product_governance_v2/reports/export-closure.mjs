import fs from 'node:fs/promises';
import path from 'node:path';
import {Workbook,SpreadsheetFile} from '@oai/artifact-tool';
const rev=path.resolve(process.argv[2]),d=JSON.parse(await fs.readFile(path.join(rev,'report-data.json'),'utf8'));
const trial=await fs.readFile(path.join(rev,'trial-report.json'),'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
const wb=Workbook.create(),qa=path.join(rev,'report-qa');
const col=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
const safe=x=>typeof x==='string'&&/^[=+@]/.test(x)?"'"+x:x;
const specs=[
 ['治理总览',['末级类目','类目ID','完整类目路径','属性数','必填数','条件必填数','参考样本数','符合数','错挂数','待确认数','DeepSeek审核','当前状态','限制及待确认事项'],d.overview,[20,40,48,12,12,14,14,12,12,14,38,28,90],14],
 ['完整属性卡',['序号','类目ID','完整类目路径','末级类目','属性ID','属性名','公共/特性','建模维度','字段类型','单位','必填策略','触发条件','SKU/SPU','取值口径','属性定义','描述对象','用途','采用及必填理由','枚举值','枚举边界及扩充','排除含义','运营审核状态','运营意见'],d.cards,[8,40,48,18,35,28,18,22,13,28,14,75,12,75,85,50,24,85,70,90,60,20,60],5],
 ['规则与反例',['末级类目','类目ID','属性ID','属性名','直接填写规则','计算算子','计算公式','输入及口径','前提条件','缺失处理','冲突处理','合成正反例'],d.rules,[20,40,35,28,90,14,55,80,85,80,80,100],5],
 ['本地模板采纳',['序号','类目ID','完整类目路径','末级类目','参考模板','参考属性','原表必填','原表类型','原表枚举/示例','最终处理','目标属性ID','处理理由','落地说明','来源Sheet','来源行','本地来源定位'],d.references,[8,40,48,20,16,24,14,14,70,18,75,110,70,24,14,100],5],
 ['商品参考样本',['末级类目','类目ID','商品源ID','原始标题','销售规格','归属判断','判断理由','ES获取时间UTC'],d.samples,[20,40,40,100,75,15,100,30],5],
 ['来源依据',['末级类目','属性ID','属性名','关系','主张','来源平台','来源类型','来源定位','原文引用','内容哈希'],d.sources,[20,35,28,12,95,30,25,95,100,70],5],
 ['审核与裁定',['末级类目','阶段','属性ID','模型意见或修改','模型建议','Codex处理','处理说明'],d.reviews,[20,25,35,110,100,110,85],5],
 ['规则回归',['末级类目','案例ID','属性ID','合成输入','预期','实际结果','结果','验证范围'],d.regression,[20,12,32,85,35,35,14,60],5],
 ['调用成本',['请求ID','调用类型','状态','输入Token','缓存命中Token','输出Token','已发生费用估算(元)','未确定预留(元)','耗时(秒)','开始时间UTC','结束时间UTC','所属阶段'],d.calls,[70,18,20,18,20,18,24,24,18,30,30,18],5],
 ['口径与下一步',['项目','说明'],d.notes,[26,135],5],
];
if(trial){
 const detailHeaders=['序号','类目ID','完整类目路径','属性ID','属性名','商品源ID','商品标题','销售规格','必填策略','字段类型','单位','试填状态','试填值','原始值/候选','枚举状态','现有枚举','采纳来源','证据原文','计算公式','缺失主因','填写或排除说明','归属状态','建议V2目标路径','建议V2目标ID','目标状态','样本批次','总体分母','必填分母','已填写计数','必填已填计数','运营审核','运营意见','证据定位'];
 const detailWidths=[8,40,48,35,26,40,95,65,14,13,26,18,35,60,20,70,28,100,55,30,100,22,65,40,35,30,15,15,15,18,20,55,90];
 specs.unshift(
  ['试填评估',['末级类目','明细商品数','纳入商品数','归属排除数','可适用项数','已填写项数','总体填充率','必填项数','必填已填数','必填填充率','不适用项数','枚举外已填','京东参与已填','条件未知项数'],trial.metrics,[22,16,16,16,18,18,18,18,18,18,18,18,20,20],5],
  ...trial.sheets.map(x=>[x.name,detailHeaders,x.rows,detailWidths,5]),
  ['缺失原因',['缺失主因','未填项数','占全部未填项','其中必填未填','占必填未填项'],trial.missing,[32,20,24,24,24],5],
  ['商品试填裁定',['末级类目','商品源ID','商品标题','属性ID','原值或复核问题','最终值或处理','理由或建议'],trial.decisions,[22,40,90,35,105,105,105],5],
 );
 d.notes[0][1]='21类完整属性卡、按末级类目分Sheet的逐商品逐属性试填及评估。归属排除商品也列明原因，未纳入填充率。';
 d.notes[1][1]='210件原参考样本加9件历史有效补充纸巾盒商品，共219件明细；按最终归属核对纳入。已有有效属性和京东证据复用，仅按新版卡补新字段及变化字段。';
 d.notes[3][1]='纸巾盒Sheet已合并原10件随机样本与9件历史有效补充样本。历史有效证据复用，值按当前卡核对。';
 d.notes[10][1]='运营抽检本次试填及枚举外候选，优先确认边界并补有效样本；修正属性口径后定点重验，不据本次填充率宣称准确率或直接同步生产。';
}
for(const [name,headers,rows,widths,start]of specs){
 const s=wb.worksheets.add(name),last=col(headers.length-1),end=start+rows.length;s.showGridLines=false;
 s.getRange(`A1:${last}${end+1}`).format.font={name:'Arial',size:11,color:'#243247'};
 s.mergeCells(`A2:${name==='口径与下一步'?'B':'D'}2`);s.getRange('A2').values=[[name==='治理总览'?'清洁纸品21类属性治理':name]];
 s.getRange('A2').format.font={name:'Arial',size:16,bold:true,color:'#123B50'};s.getRange('A2').format.rowHeight=32;
 s.getRange(`A${start}:${last}${start}`).values=[headers];
 if(rows.length)s.getRange(`A${start+1}:${last}${end}`).values=rows.map(r=>r.map(safe));
 for(let i=0;i<widths.length;i++)s.getRange(`${col(i)}1:${col(i)}${end+1}`).format.columnWidth=widths[i];
 s.getRange(`A${start}:${last}${start}`).format={fill:'#06485A',font:{name:'Arial',size:11,bold:true,color:'#FFFFFF'},rowHeight:38,wrapText:true,verticalAlignment:'center'};
 if(rows.length){
  s.tables.add(`A${start}:${last}${end}`,true,'Closure'+specs.indexOf(specs.find(x=>x[0]===name))).showFilterButton=true;
  s.getRange(`A${start+1}:${last}${end}`).format.wrapText=true;
  s.getRange(`A${start+1}:${last}${end}`).format.verticalAlignment='top';
  for(let i=0;i<rows.length;i++){
   const lines=Math.max(...rows[i].map((v,j)=>String(v??'').split('\n').reduce((n,t)=>n+Math.max(1,Math.ceil([...t].reduce((n,c)=>n+(c.charCodeAt(0)>255?2:1),0)/Math.max(6,widths[j]-3))),0)));
   s.getRange(`A${start+1+i}:${last}${start+1+i}`).format.rowHeight=Math.min(405,Math.max(34,lines*15+12));
  }
 }
 s.freezePanes.freezeRows(start);
 if(name==='完整属性卡'){
  s.freezePanes.freezeColumns(1);s.getRange(`V6:V${end}`).dataValidation={rule:{type:'list',values:['待运营审核','通过','需修改']}};
  s.getRange(`V6:W${end}`).format.fill='#FFF2CC';
 }
 if(trial?.sheets.some(x=>x.name===name)&&rows.length){
  s.freezePanes.freezeColumns(1);
  s.getRange(`AE6:AE${end}`).dataValidation={rule:{type:'list',values:['待运营审核','通过','需修改']}};
  s.getRange(`AE6:AF${end}`).format.fill='#FFF2CC';
 }
}
if(trial){
 const t=wb.worksheets.getItem('试填评估'),last=trial.metrics.length+5,total=last+2;
 for(let i=0;i<trial.metrics.length;i++){
  const row=i+6,name=trial.metrics[i][0],end=trial.sheets.find(x=>x.name===name).rows.length+5;
  for(const [target,source]of [['E','AA'],['F','AC'],['H','AB'],['I','AD']])t.getRange(`${target}${row}`).formulas=[[`=SUM('${name}'!${source}6:${source}${end})`]];
  t.getRange(`G${row}`).formulas=[[`=IF(E${row}=0,"n.a.",F${row}/E${row})`]];
  t.getRange(`J${row}`).formulas=[[`=IF(H${row}=0,"n.a.",I${row}/H${row})`]];
 }
 t.getRange(`A${total}`).values=[['总体']];
 for(const c of ['B','C','D','E','F','H','I','K','L','M','N'])t.getRange(`${c}${total}`).formulas=[[`=SUM(${c}6:${c}${last})`]];
 t.getRange(`G${total}`).formulas=[[`=F${total}/E${total}`]];t.getRange(`J${total}`).formulas=[[`=I${total}/H${total}`]];
 t.getRange(`G6:G${total}`).setNumberFormat('0.0%');t.getRange(`J6:J${total}`).setNumberFormat('0.0%');
 t.mergeCells(`A${total+2}:H${total+4}`);t.getRange(`A${total+2}`).values=[[trial.summary.notes]];t.getRange(`A${total+2}:H${total+4}`).format={wrapText:true,verticalAlignment:'top',fill:'#FFF2CC'};
 t.getRange(`A${total+6}:B${total+8}`).values=[['本次补明细新增费用估算(元)',trial.summary.incrementCost],['累计费用估算(元)',trial.summary.cumulativeCost],['直接复用未变属性值数',trial.summary.reusedAttributes]];
 const m=wb.worksheets.getItem('缺失原因'),end=trial.missing.length+5;
 for(let r=6;r<=end;r++){m.getRange(`C${r}`).formulas=[[`=IF(SUM(B6:B${end})=0,"n.a.",B${r}/SUM(B6:B${end}))`]];m.getRange(`E${r}`).formulas=[[`=IF(SUM(D6:D${end})=0,"n.a.",D${r}/SUM(D6:D${end}))`]];}
 m.getRange(`C6:C${end}`).setNumberFormat('0.0%');m.getRange(`E6:E${end}`).setNumberFormat('0.0%');
}
const s=wb.worksheets.getItem('治理总览'),n=d.overview.length,costEnd=d.calls.length+5;
s.mergeCells('A3:H3');s.getRange('A3').values=[[trial?'21类属性卡及文本试填。按末级类目分Sheet，包含三横文字证据与已确认同品的京东补充。':'原3类规则收口后补齐18类。当前为属性建模审核稿，尚未开展新增18类商品批量试填。']];s.getRange('A3:H3').format.rowHeight=30;
s.getRange('A5:B11').values=[['末级类目数',d.summary.categories],['属性绑定数',null],['参考商品样本数',null],['本轮新增费用估算(元)',null],['累计费用估算(元)',null],['累计预算上限(元)',d.summary.budget],['可用预算(元)',null]];
s.getRange('B6').formulas=[[`=SUM(D15:D${n+14})`]];
s.getRange('B7').formulas=[[`=SUM(G15:G${n+14})`]];
s.getRange('B8').formulas=[[`=SUMIFS('调用成本'!G6:G${costEnd},'调用成本'!L6:L${costEnd},"本轮新增")`]];
s.getRange('B9').formulas=[[`=SUM('调用成本'!G6:G${costEnd})`]];
s.getRange('B11').formulas=[[`=B10-B9-SUM('调用成本'!H6:H${costEnd})`]];
s.getRange('D5:E10').values=[['本地模板采纳判断',d.summary.references],['合成回归案例',d.regression.length],['其中通过',d.regression.filter(r=>r[6]==='通过').length],['本轮输入Token',null],['本轮缓存命中Token',null],['本轮输入缓存命中率',null]];
s.getRange('E8').formulas=[[`=SUMIFS('调用成本'!D6:D${costEnd},'调用成本'!L6:L${costEnd},"本轮新增")`]];
s.getRange('E9').formulas=[[`=SUMIFS('调用成本'!E6:E${costEnd},'调用成本'!L6:L${costEnd},"本轮新增")`]];
s.getRange('E10').formulas=[['=E9/E8']];s.getRange('E10').setNumberFormat('0.0%');
s.getRange('B8:B11').setNumberFormat('0.0000');s.getRange('A5:B11').format.rowHeight=27;
s.getRange('D5:D10').format.columnWidth=26;s.getRange('E5:E10').format.columnWidth=24;
s.mergeCells('F5:J10');s.getRange('F5').values=[['需关注：\n枕巾、生活用纸、卷纸配件的10件随机样本均无确认匹配，仍须补有效资料。\n一次性日杂、生活用纸、枕巾、坐垫纸保留边界确认项。\n模型复核、程序校验和合成案例通过均不代表真实商品准确率。']];
s.getRange('F5:J10').format={fill:'#FFF2CC',wrapText:true,verticalAlignment:'top'};
wb.worksheets.getItem('调用成本').getRange(`G6:H${costEnd}`).setNumberFormat('0.000000');
wb.worksheets.getItem('调用成本').getRange(`J6:K${costEnd}`).setNumberFormat('yyyy-mm-dd hh:mm:ss');
wb.worksheets.getItem('商品参考样本').getRange(`H6:H${d.samples.length+5}`).setNumberFormat('yyyy-mm-dd hh:mm:ss');
await fs.mkdir(qa,{recursive:true});wb.recalculate();
const check=await wb.inspect({kind:'table',range:'治理总览!A5:E11',include:'values,formulas',tableMaxRows:8,tableMaxCols:5});
await fs.writeFile(path.join(qa,'summary.json'),check.ndjson);
const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:50},summary:'formula check'});
await fs.writeFile(path.join(qa,'formula-errors.json'),errors.ndjson);
for(const [name] of specs){
 if(process.env.QA_TRIAL_ONLY&&!trial?.sheets.some(x=>x.name===name)&&!['试填评估','缺失原因','商品试填裁定','治理总览','口径与下一步','调用成本'].includes(name))continue;
 if(process.env.QA_CHANGED_ONLY&&!(process.env.QA_CHANGED_SHEETS??'商品参考样本,调用成本').split(',').includes(name))continue;
 const range=trial?.sheets.some(x=>x.name===name)?'L5:O8':name==='试填评估'?`A5:J${trial.metrics.length+7}`:name==='治理总览'?'A1:J11':name==='口径与下一步'?'A1:B9':name==='调用成本'?'D5:L9':process.env.QA_CHANGED_ONLY?'F5:H8':'A1:F8';
 const preview=await wb.render({sheetName:name,range,scale:1,format:'png'});
 await fs.writeFile(path.join(qa,name+'.png'),new Uint8Array(await preview.arrayBuffer()));
}
for(const [name,range,label]of [['完整属性卡','F5:K9','字段建模'],['完整属性卡','R5:W8','枚举与运营审核'],['本地模板采纳','J5:M8','采纳理由']]){
 if(process.env.QA_CHANGED_ONLY)continue;
 const p=await wb.render({sheetName:name,range,scale:1,format:'png'});await fs.writeFile(path.join(qa,label+'.png'),new Uint8Array(await p.arrayBuffer()));
}
if(process.env.QA_CHANGED_ONLY){
 const row=d.references.findIndex(r=>r[3]==='洗脸巾'&&r[14]===4194)+6;
 const p=await wb.render({sheetName:'本地模板采纳',range:`J${row}:M${row}`,scale:1,format:'png'});
 await fs.writeFile(path.join(qa,'洗脸巾套装参考修正.png'),new Uint8Array(await p.arrayBuffer()));
}
const out=path.join(rev,'清洁纸品21类完整属性卡与审核修订版.xlsx');
await(await SpreadsheetFile.exportXlsx(wb)).save(out);
console.log(JSON.stringify({output:out,sheets:specs.length,bindings:d.cards.length,summary:check.ndjson}));
