import fs from 'node:fs/promises';
import path from 'node:path';
import {Workbook,SpreadsheetFile} from '@oai/artifact-tool';
const run=path.resolve(process.argv[2]),data=JSON.parse(await fs.readFile(path.join(run,'report-data.json'),'utf8'));
const wb=Workbook.create(),font='Arial',out=path.join(run,'清洁纸品V2属性建模_明细审核与成本.xlsx');
const col=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
const literal=v=>typeof v==='string'&&/^[=+@]/.test(v)?"'"+v:v;
const definitions=[
 ['建模总览',['末级类目','类目ID','抽取样本','归属符合样本','初稿属性数','修订属性数','修订阶段数','DS末轮意见数（见裁定）','待确认事项','Codex状态'],data.overview,[18,40,13,17,15,15,13,22,15,35]],
 ['完整属性卡',['序号','类目ID','完整类目路径','末级类目','属性ID','属性名','公共/特性','建模维度','字段类型','单位','必填策略','触发条件','SKU/SPU','取值口径','属性定义','描述对象','用途','采用/必填理由','枚举值','枚举边界及扩充','排除含义','运营审核状态','运营意见'],data.cards,[8,40,48,16,29,23,18,20,13,12,16,55,13,35,80,55,23,70,55,70,55,19,55]],
 ['规则与反例',['末级类目','类目ID','属性ID','属性名','直接填写规则','计算算子','计算公式','输入及口径','前提条件','缺失处理','冲突处理','合成正反例'],data.rules,[18,40,29,23,85,15,48,55,70,55,55,100]],
 ['来源依据',['末级类目','属性ID','属性名','关系','支持主张','来源类别','平台','来源定位','获取形式','原文引用','内容哈希','获取时间'],data.sources,[18,29,23,12,70,24,30,90,28,100,68,28]],
 ['商品参考样本',['挂载末级类目','类目ID','商品源ID','原始标题','销售规格','详情已返回','在售状态冲突','DS归属判断','归属理由','ES获取时间'],data.samples,[18,40,40,100,70,15,25,20,95,28]],
 ['评审与修改',['末级类目','阶段','评审项','属性ID','问题/修改内容','严重度','修改建议','DS结论'],data.findings,[18,18,20,29,100,15,100,18]],
 ['Codex裁定',['末级类目','状态','抽查属性ID','裁定说明','遗留事项','属性卡哈希','审核时间'],data.decisions,[18,25,65,110,100,68,28]],
 ['调用成本',['请求ID','调用类型','业务阶段','状态','响应模型','输入Token','缓存命中Token','输出Token','思考Token','费用估算上界(元)','预留上界(元)','耗时(秒)','开始时间','完成时间'],data.calls,[70,18,22,20,35,17,19,17,17,22,22,17,28,28]],
];
if(data.localReference){
 definitions.splice(3,0,['本地模板采纳',['序号','类目ID','完整类目路径','末级类目','参考模板','参考属性','原表必填','原表类型','原表枚举/示例','最终处理','目标属性ID','处理理由','落地方式','来源Sheet','来源行','本地来源定位','DS初步处理','DS初步理由'],data.localReference,[8,40,48,18,16,22,14,14,80,18,60,100,100,22,12,100,18,100]]);
 definitions.push(['共用规则',['规则ID','统一业务规则','程序检查及语义审核分工','规则版本'],data.sharedRules,[14,100,100,30]]);
}
for(const [name,headers,rows,widths] of definitions){
 const sh=wb.worksheets.add(name);sh.showGridLines=false;
 const end=rows.length+5,last=col(headers.length-1);
 sh.getRange(`A1:${last}${Math.max(7,end)}`).format.font={name:font,size:10,color:'#243247'};
 sh.getRange('A2').values=[[name==='建模总览'?`清洁纸品V2 ${data.summary.categories}类属性建模`:name]];
 sh.getRange('A2').format.font={name:font,size:15,bold:true,color:'#17365D'};
 sh.getRange(`A5:${last}5`).values=[headers];
 if(rows.length)sh.getRange(`A6:${last}${end}`).values=rows.map(row=>row.map(literal));
 widths.forEach((width,i)=>sh.getRange(`${col(i)}1:${col(i)}${Math.max(end,7)}`).format.columnWidth=width);
 sh.getRange(`A5:${last}5`).format={fill:'#243E59',font:{name:font,size:10,bold:true,color:'#FFFFFF'},rowHeight:32,wrapText:true,horizontalAlignment:'center',verticalAlignment:'center'};
 if(rows.length){
  sh.tables.add(`A5:${last}${end}`,true,'T_'+definitions.findIndex(x=>x[0]===name)).showFilterButton=true;
  sh.getRange(`A6:${last}${end}`).format.wrapText=true;
  sh.getRange(`A6:${last}${end}`).format.verticalAlignment='top';
  sh.getRange(`A6:${last}${end}`).format.rowHeight=34;
  // Estimate fitted height from the longest wrapped field without truncating long evidence.
  for(let i=0;i<rows.length;i++){
   const lines=Math.max(...rows[i].map((v,j)=>String(v??'').split('\n').reduce((n,s)=>n+Math.max(1,Math.ceil([...s].reduce((n,c)=>n+(c.charCodeAt(0)>255?2:1),0)/Math.max(6,widths[j]-2))),0)));
   sh.getRange(`A${i+6}:${last}${i+6}`).format.rowHeight=Math.min(400,Math.max(32,lines*13+8));
  }
  sh.freezePanes.freezeRows(5);if(name==='完整属性卡')sh.freezePanes.freezeColumns(1);
 }
 if(name==='完整属性卡'&&rows.length){
  sh.getRange(`V6:V${end}`).dataValidation={rule:{type:'list',values:['待运营审核','通过','需修改']}};
  sh.getRange(`V6:W${end}`).format.fill='#FFF2CC';
 }
}
const overview=wb.worksheets.getItem('建模总览'),n=data.overview.length,cr=data.calls.length;
overview.getRange('A3').values=[['属性建模结果；商品参考样本用于设计，未开展批量属性值填写或运营准确率验收。']];
overview.getRange(`A${n+8}:B${n+14}`).values=[
 ['覆盖目标末级数',data.summary.targetCategories],['本次属性绑定数',data.summary.attributes],
 ['累计预算上限(元)',data.summary.budget],['已返回调用费用估算上界(元)',null],
 ['结果未知/在途预留(元)',data.summary.uncertainReservations],['可用预算(元)',null],
 ['成本说明','按实际Token与官方高峰单价估算；非供应商账单金额。'],
];
overview.getRange(`B${n+11}`).formulas=[[`=SUM('调用成本'!J6:J${cr+5})`]];
overview.getRange(`B${n+13}`).formulas=[[`=B${n+10}-B${n+11}-B${n+12}`]];
overview.getRange(`A${n+8}:A${n+14}`).format.columnWidth=40;
overview.getRange(`B${n+10}:B${n+13}`).setNumberFormat('0.0000');
overview.getRange(`B${n+14}`).format.wrapText=true;overview.getRange(`A${n+14}:J${n+14}`).format.rowHeight=42;
const notes=[
 ['本轮边界',`已完成${data.summary.categories}/${data.summary.targetCategories}类建模；其余${data.summary.targetCategories-data.summary.categories}类待扩展。`],
 ['样本口径',`每类从ES商品源随机抽10件在售商品。仅标题/规格及来源资料辅助建模；${data.summary.matchedSamples}件符合、${data.summary.wrongSamples}件错挂、${data.summary.uncertainSamples}件待确认。小样本比例不能外推为全类错挂率。`],
 ['纸巾盒限制','随机10件仅2件符合，仍需补正样本验证；不表示类目下无商品。'],
 ['来源说明',data.summary.referenceReview?'已将本地《震坤行类目属性案例模板.xlsx》的M45112清洁纸品12个字段纳入三类DS复核及Codex裁定，合计36项采纳判断。每项保留原必填、类型、枚举、Sheet与行号。本轮未新增网页检索，未读取三横旧21类答案。':'震坤行来源为用户提供的本地《震坤行类目属性案例模板.xlsx》，非网站抓取。首轮三类模型调用漏接该文件；现已登记并核对1295分类模板第4184—4195行、M45112清洁纸品12个字段，待下一版本引用。首轮属性仍基于ES资料、网页、DS提议及Codex裁定；未输入三横旧属性答案。网页登录页与本地文件无关。'],
 ['审核说明','每类DS完整语义审核一次，后续定点修正。DS末轮意见已在Codex裁定/评审与修改页逐项处置；模型通过不等于准确率。'],
 ['输入Token',data.summary.inputTokens],['其中缓存命中Token',data.summary.cachedInputTokens],
 ['输入缓存命中率',null],
 ['下一步',data.summary.referenceReview?'本地参考复核及共用规则固化已完成，属性卡待运营审核。下一步补纸巾盒正样本、用新增组合规则检查真实商品，再扩其余18类；沿用累计预算。':'将本地震坤行M45112作为上位参考做差异复核，逐项判断适用性；同步固化共用规则、补纸巾盒正样本，再铺满21类。沿用累计预算，不把本次登记冒记为已进行模型审核。'],
];
overview.getRange(`A${n+17}:B${n+25}`).values=notes;
overview.getRange(`A${n+17}:B${n+25}`).format.wrapText=true;
overview.getRange(`B${n+24}`).formulas=[[`=IFERROR(B${n+23}/B${n+22},0)`]];
overview.getRange(`B${n+24}`).setNumberFormat('0.0%');
for(let i=0;i<notes.length;i++)overview.getRange(`A${n+17+i}:B${n+17+i}`).format.rowHeight=typeof notes[i][1]==='string'?Math.max(36,Math.ceil(notes[i][1].length/18)*16):26;
if(data.summary.referenceReview){
 overview.getRange(`A${n+28}:B${n+33}`).values=[
  ['本地模板判断总数',data.summary.referenceDecisions],['采纳',data.summary.adopted],['调整采纳',data.summary.adjusted],['不采纳为类目属性',data.summary.notAdopted],
  ['本轮开始前累计费用(元)',data.summary.priorCostUpperEstimate],['本轮新增费用估算上界(元)',null]];
 overview.getRange(`B${n+33}`).formulas=[[`=B${n+11}-B${n+32}`]];
 overview.getRange(`B${n+32}:B${n+33}`).setNumberFormat('0.000000');
 overview.getRange(`A${n+28}:B${n+33}`).format.rowHeight=28;
}
const cost=wb.worksheets.getItem('调用成本');if(cr){cost.getRange(`J6:K${cr+5}`).setNumberFormat('0.000000');cost.getRange(`L6:L${cr+5}`).setNumberFormat('0.0');}
await fs.mkdir(path.join(run,'report-qa'),{recursive:true});
wb.recalculate();
const scan=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#SPILL!',options:{useRegex:true,maxResults:50},summary:'formula errors'});
await fs.writeFile(path.join(run,'report-qa','formula-errors.json'),scan.ndjson);
const summary=await wb.inspect({kind:'table',range:`建模总览!A${n+8}:B${n+14}`,include:'values,formulas',tableMaxRows:8,tableMaxCols:2});
await fs.writeFile(path.join(run,'report-qa','summary.json'),summary.ndjson);
for(const [name] of definitions){
 const preview=await wb.render({sheetName:name,range:name==='建模总览'?`A1:J${n+15}`:'A1:F9',scale:1,format:'png'});
 await fs.writeFile(path.join(run,'report-qa',name+'.png'),new Uint8Array(await preview.arrayBuffer()));
}
const notesPreview=await wb.render({sheetName:'建模总览',range:`A${n+17}:B${n+25}`,scale:1,format:'png'});
await fs.writeFile(path.join(run,'report-qa','总览口径说明.png'),new Uint8Array(await notesPreview.arrayBuffer()));
if(data.localReference){
 for(const [name,range,label] of [['本地模板采纳','J5:M8','采纳理由'],['建模总览',`A${n+28}:B${n+33}`,'参考复核统计']]){
  const preview=await wb.render({sheetName:name,range,scale:1,format:'png'});
  await fs.writeFile(path.join(run,'report-qa',label+'.png'),new Uint8Array(await preview.arrayBuffer()));
 }
}
await (await SpreadsheetFile.exportXlsx(wb)).save(out);
console.log(JSON.stringify({output:out,sheets:definitions.length,attributes:data.cards.length,summary:summary.ndjson}));
