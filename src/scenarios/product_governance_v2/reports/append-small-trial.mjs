import fs from 'node:fs/promises';
import path from 'node:path';
import {FileBlob,SpreadsheetFile} from '@oai/artifact-tool';
const rev=path.resolve(process.argv[2]),run=path.join(rev,'small-trial-five');
const file=path.join(rev,'清洁纸品21类完整属性卡与审核修订版.xlsx');
const backup=path.join(run,'original-before-five.xlsx');
const source=['pagination','delivery','provisional','enum-revision','naming-revision'].includes(process.argv[3])?file:await fs.access(backup).then(()=>backup).catch(()=>file);
const wb=await SpreadsheetFile.importXlsx(await FileBlob.load(source));
await fs.mkdir(path.join(run,'qa'),{recursive:true});
if(process.argv[3]==='naming-revision'){
 const dir=path.join(rev,'naming-r1'),before=path.join(dir,'before-naming.xlsx');
 try{await fs.access(before);}catch{await fs.copyFile(file,before);}
 const cards=JSON.parse(await fs.readFile(path.join(rev,'final-cards.json'),'utf8'));
 const report=JSON.parse(await fs.readFile(path.join(run,'report.json'),'utf8'));
 const layout=JSON.parse(await fs.readFile(path.join(dir,'workbook-layout.json'),'utf8'));
 const req={always:'必填',conditional:'条件必填',optional:'可选'};
 const main=wb.worksheets.getItem('完整属性卡');
 const priorMain=main.getRange(`A6:W${layout['完整属性卡'].rows}`).values;
 const mainNotes=new Map(priorMain.filter(r=>r[1]&&r[4]).map(r=>[r[1]+'|'+r[4],[r[21],r[22]]]));
 const rows=[];
 for(const d of cards)for(const dim of d.card.dimensions)for(const id of dim.attributeIds){
  const a=d.card.attributes.find(a=>a.id===id),b=d.card.bindings.find(b=>b.attributeId===id);
  const notes=mainNotes.get(d.category.id+'|'+id)??['待运营审核',''];
  rows.push([rows.length+1,d.category.id,d.category.path,d.category.name,id,a.name,a.kind,dim.name,a.fieldType,a.unit,req[b.requiredness],b.condition,b.valueLevel,b.scope,a.definition,a.describes,b.uses.join('、'),b.rationale,a.enumValues.join('；'),a.enumPolicy,a.excludedMeanings.join('；'),...notes]);
 }
 const sized=[];
 function rewrite(sheetName,values,lastCol,operatorCols){
  const s=wb.worksheets.getItem(sheetName),oldEnd=layout[sheetName].rows,end=5+values.length;
  const tables=s.tables.items.map(t=>({name:t.name,style:t.style}));
  for(const t of [...s.tables.items])t.delete();
  for(let row=oldEnd;row<=end;row++)s.getRange(`A${row}:${lastCol}${row}`).copyFrom(s.getRange(`A6:${lastCol}6`),'all');
  s.getRange(`A6:${lastCol}${end}`).values=values;
  // Retain data, labels, layout and controls; resize only rows whose wrapped
  // text needs it. No 180-point minimum and no unbounded tall-card default.
  const widths=layout[sheetName].widths;
  for(let i=0;i<values.length;i++){
   const lines=Math.max(...values[i].map((v,j)=>String(v??'').split('\n').reduce((n,t)=>n+Math.max(1,Math.ceil([...t].reduce((w,c)=>w+(c.charCodeAt(0)>255?1.8:1),0)/Math.max(10,widths[j]-4))),0)));
   const h=Math.max(42,lines*13+9);
   s.getRange(`A${i+6}:${lastCol}${i+6}`).format.rowHeight=h;
   sized.push({sheet:sheetName,row:i+6,height:h});
  }
  const t=s.tables.add(`A5:${lastCol}${end}`,true,tables[0].name);
  if(tables[0].style)t.style=tables[0].style;
  t.showFilterButton=true;
  s.getRange(`${operatorCols[0]}6:${operatorCols[1]}${end}`).format.fill='#FFF2CC';
  s.getRange(`${operatorCols[0]}6:${operatorCols[0]}${end}`).dataValidation={rule:{type:'list',values:['待运营审核','通过','需修改']}};
 }
 rewrite('完整属性卡',rows,'W',['V','W']);
 const order=[0,5,6,7,1,2,3,4,...Array.from({length:17},(_,i)=>i+8)];
 for(const spec of report.sheets){
  const s=wb.worksheets.getItem(spec.name),old=s.getRange(`A6:Y${layout[spec.name].rows}`).values;
  const ops=new Map(old.filter(r=>r[1]&&r[6]).map(r=>[r[1]+'|'+r[6],[r[22],r[23]]]));
  const values=spec.rows.map(r=>{
   const next=order.map(i=>r[i]??null),notes=ops.get(next[1]+'|'+next[6]);
   if(notes){next[22]=notes[0];next[23]=notes[1];}
   return next;
  });
  // Pure name edits do not need to reshape a whole sheet or change row heights.
  if(values.length===old.filter(r=>r[1]&&r[6]).length&&values.every((r,i)=>r[1]===old[i][1]&&r[6]===old[i][6])){
   for(let i=0;i<values.length;i++)for(let j=0;j<values[i].length;j++){
    if((old[i][j]??'')===(values[i][j]??''))continue;
    if(j===22||j===23)continue;
    s.getRange(`${String.fromCharCode(65+j)}${i+6}`).values=[[values[i][j]]];
   }
  }else rewrite(spec.name,values,'Y',['W','X']);
 }
 wb.recalculate();
 await fs.mkdir(path.join(dir,'qa'),{recursive:true});
 for(const [sheetName,range,label]of [
  ['完整属性卡','A5:H9','card-front'],
  ['完整属性卡','N6:T9','card-text'],
  ['厨房纸巾','G5:O12','kitchen-values'],
  ['盒装抽纸','G5:O12','box-values'],
  ['生活用纸','G5:O12','paper-values'],
 ]){
  const img=await wb.render({sheetName,range,scale:1,format:'png'});
  await fs.writeFile(path.join(dir,'qa',label+'.png'),new Uint8Array(await img.arrayBuffer()));
 }
 await fs.writeFile(path.join(dir,'qa/errors.json'),(await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:30}})).ndjson);
 await fs.writeFile(path.join(dir,'qa/row-heights.json'),JSON.stringify(sized));
 await(await SpreadsheetFile.exportXlsx(wb)).save(file);
 console.log(JSON.stringify({output:file,attributeRows:rows.length,productRows:report.sheets.reduce((n,s)=>n+s.rows.length,0),maxCardRowHeight:Math.max(...sized.filter(x=>x.sheet==='完整属性卡').map(x=>x.height))}));
 process.exit(0);
}
if(process.argv[3]==='enum-revision'){
 const report=JSON.parse(await fs.readFile(path.join(run,'report.json'),'utf8'));
 const cards=JSON.parse(await fs.readFile(path.join(rev,'final-cards.json'),'utf8'));
 const audit=JSON.parse(await fs.readFile(path.join(run,'enum-revision.json'),'utf8'));
 const before=path.join(run,'before-enum-revision.xlsx');
 try{await fs.access(before);}catch{await fs.copyFile(file,before);}
 const cardSheet=wb.worksheets.getItem('完整属性卡'),cardEnd=5+cards.reduce((n,d)=>n+d.card.attributes.length,0),old=cardSheet.getRange(`A6:W${cardEnd}`).values,edits=[];
 for(let i=0;i<old.length;i++){
  const row=old[i],change=audit.changes.find(c=>c.categoryId===row[1]&&c.attributeId===row[4]);
  if(!change)continue;
  const d=cards.find(d=>d.category.id===row[1]),a=d.card.attributes.find(a=>a.id===row[4]),b=d.card.bindings.find(b=>b.attributeId===a.id);
  for(const [col,value]of [['N',b.scope],['O',a.definition],['P',a.describes],['S',a.enumValues.join('；')],['T',a.enumPolicy]]){
   const cell=`${col}${i+6}`;if(cardSheet.getRange(cell).values[0][0]!==value){cardSheet.getRange(cell).values=[[value]];edits.push(['完整属性卡',cell]);}
  }
  // Column T is 90 characters wide. Size to wrapped content, without a tall
  // minimum for revised rows; Chinese characters occupy roughly two units.
  const policyLines=a.enumPolicy.split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil([...line].reduce((w,c)=>w+(c.charCodeAt(0)>255?2:1),0)/85)),0);
  cardSheet.getRange(`A${i+6}:W${i+6}`).format.rowHeight=Math.max(42,policyLines*14+8);
 }
 const order=[0,5,6,7,1,2,3,4,...Array.from({length:17},(_,i)=>i+8)];
 for(const spec of report.sheets){
  const s=wb.worksheets.getItem(spec.name),previous=s.getRange(`A6:Y${5+spec.rows.length}`).values;
  for(let i=0;i<spec.rows.length;i++){
   const row=order.map(j=>spec.rows[i][j]??null);
   if(previous[i][1]!==row[1]||previous[i][6]!==row[6])throw Error('row key drift '+spec.name);
   for(const j of [12,13,14,17]){
    if((previous[i][j]??'')===(row[j]??''))continue;
    const cell=`${String.fromCharCode(65+j)}${i+6}`;s.getRange(cell).values=[[row[j]]];edits.push([spec.name,cell]);
   }
  }
 }
 wb.recalculate();
 for(const [name,range,label]of [['完整属性卡','R6:T9','card'],['一次性日杂','M6:R10','trial']]){
  const img=await wb.render({sheetName:name,range,scale:1,format:'png'});
  await fs.writeFile(path.join(run,'qa',`enum-${label}.png`),new Uint8Array(await img.arrayBuffer()));
 }
 await fs.writeFile(path.join(run,'qa/enum-errors.json'),(await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:30}})).ndjson);
 await fs.writeFile(path.join(run,'qa/enum-cell-edits.json'),JSON.stringify(edits));
 await(await SpreadsheetFile.exportXlsx(wb)).save(file);
 console.log(JSON.stringify({output:file,changedCells:edits.length,addedOptions:audit.added}));
 process.exit(0);
}
if(process.argv[3]==='provisional'){
 const report=JSON.parse(await fs.readFile(path.join(run,'report.json'),'utf8'));
 const before=path.join(run,'before-provisional-trial.xlsx');
 try{await fs.access(before);}catch{await fs.copyFile(file,before);}
 const order=[0,5,6,7,1,2,3,4,...Array.from({length:17},(_,i)=>i+8)];
 const headers=wb.worksheets.getItem('湿纸巾').getRange('A5:Y5').values[0];
 headers[19]='归属判断及待确认事项';
 const widths=[9,40,85,60,40,50,34,26,12,20,15,20,36,22,65,90,26,90,45,85,28,32,20,60,100];
 for(const spec of report.sheets.filter(s=>['一次性日杂','生活用纸'].includes(s.name))){
  const s=wb.worksheets.getItem(spec.name),end=5+spec.rows.length;
  for(const t of [...s.tables.items])t.delete();
  s.unmergeCells('A6:H7');
  s.getRange(`A5:Y${Math.max(60,end)}`).clear({applyTo:'all'});
  const rows=spec.rows.map(r=>order.map(i=>r[i]??null));
  s.getRange(`A5:Y${end}`).values=[headers,...rows];
  s.getRange(`A5:Y${end}`).format={font:{name:'Arial',size:11,color:'#243247'},wrapText:true,verticalAlignment:'top'};
  s.getRange('A5:Y5').format={fill:'#06485A',font:{name:'Arial',size:11,bold:true,color:'#FFFFFF'},rowHeight:36,wrapText:true,verticalAlignment:'center'};
  s.getRange('A3').values=[[spec.note]];
  s.getRange('A3:H3').format={wrapText:true,rowHeight:60,verticalAlignment:'center'};
  for(let i=0;i<widths.length;i++)s.getRange(`${String.fromCharCode(65+i)}1:${String.fromCharCode(65+i)}${end}`).format.columnWidth=widths[i];
  for(let i=0;i<rows.length;i++){
   const lines=Math.max(...rows[i].map((v,j)=>String(v??'').split('\n').reduce((n,t)=>n+Math.max(1,Math.ceil([...t].reduce((a,c)=>a+(c.charCodeAt(0)>255?2:1),0)/(widths[j]-3))),0)));
   s.getRange(`A${i+6}:Y${i+6}`).format.rowHeight=Math.min(405,Math.max(42,lines*15+10));
  }
  s.tables.add(`A5:Y${end}`,true,spec.name==='一次性日杂'?'MiscProvisionalTrial':'PaperProvisionalTrial').showFilterButton=true;
  s.getRange(`W6:X${end}`).format.fill='#FFF2CC';
  s.getRange(`W6:W${end}`).dataValidation={rule:{type:'list',values:['待运营审核','通过','需修改']}};
  s.freezePanes.freezeRows(5);s.freezePanes.freezeColumns(2);
 }
 wb.recalculate();
 for(const name of ['一次性日杂','生活用纸']){
  for(const [section,range]of [['front','A2:D8'],['values','G5:R11']]){
   const img=await wb.render({sheetName:name,range,scale:1,format:'png'});
   await fs.writeFile(path.join(run,'qa',`provisional-${name}-${section}.png`),new Uint8Array(await img.arrayBuffer()));
  }
 }
 await fs.writeFile(path.join(run,'qa/provisional-errors.json'),(await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:30}})).ndjson);
 await(await SpreadsheetFile.exportXlsx(wb)).save(file);
 console.log(JSON.stringify({output:file,products:report.products,addedProducts:10,addedAttributeRows:185}));
 process.exit(0);
}
if(process.argv[3]==='delivery'){
 const report=JSON.parse(await fs.readFile(path.join(run,'report.json'),'utf8'));
 const p=JSON.parse(await fs.readFile(path.join(run,'pagination/final-review.json'),'utf8'));
 const before=path.join(run,'pagination/before-final-delivery.xlsx');
 try{await fs.access(before);}catch{await fs.copyFile(file,before);}
 const order=[0,5,6,7,1,2,3,4,...Array.from({length:17},(_,i)=>i+8)];
 const widths=[9,40,85,60,40,50,34,26,12,20,15,20,36,22,65,90,26,90,45,85,28,32,20,60,100];
 for(const spec of report.sheets){
  const s=wb.worksheets.getItem(spec.name),end=5+spec.rows.length;
  const previous=s.getRange(`A5:Y${Math.max(5,end)}`).values;
  const tables=s.tables.items.map(t=>({name:t.name,style:t.style}));
  for(const t of [...s.tables.items])t.delete();
  s.getRange(`A5:Y${Math.max(5,end)}`).values=previous.map(r=>order.map(i=>r[i]??null));
  for(let i=0;i<widths.length;i++)s.getRange(`${String.fromCharCode(65+i)}1:${String.fromCharCode(65+i)}${Math.max(8,end)}`).format.columnWidth=widths[i];
  if(spec.rows.length){
   const t=s.tables.add(`A5:Y${end}`,true,tables[0]?.name??'Trial'+report.sheets.indexOf(spec));
   if(tables[0]?.style)t.style=tables[0].style;
   t.showFilterButton=true;
  }
  s.freezePanes.freezeRows(5);s.freezePanes.freezeColumns(2);
  if(p.notes[spec.name]){
   s.getRange('A3').values=[[p.notes[spec.name]]];
   s.getRange('A3:H3').format.rowHeight=60;
   s.getRange('A6').values=[['归属边界待确认，未纳入有效试填。已查全部在售商品，不代表商品数量为0或全部错挂。']];
   const examples=p.examples.filter(r=>r[0]===spec.name&&r[4]!=='不纳入本兜底类试填');
   s.getRange('A9').values=[['待确认商品举例（未试填属性）']];
   s.getRange('A9').format={font:{name:'Arial',size:12,bold:true,color:'#123B50'},rowHeight:30};
   s.getRange(`A10:H${10+examples.length}`).values=[
    ['序号','商品源ID','商品标题','销售规格','当前结论','核对资料','待确认原因','运营意见'],
    ...examples.map((r,i)=>[i+1,r[1],r[2],r[3],r[4],r[5],r[6],''])
   ];
   s.getRange('A10:H10').format={fill:'#06485A',font:{name:'Arial',size:11,bold:true,color:'#FFFFFF'},rowHeight:36,wrapText:true};
   s.getRange(`A11:H${10+examples.length}`).format={font:{name:'Arial',size:11,color:'#243247'},wrapText:true,rowHeight:145,verticalAlignment:'top'};
   s.getRange(`H11:H${10+examples.length}`).format.fill='#FFF2CC';
   s.tables.add(`A10:H${10+examples.length}`,true,spec.name==='生活用纸'?'PaperPending':'MiscPending').showFilterButton=true;
  }
 }
 wb.recalculate();
 await fs.writeFile(path.join(run,'qa/delivery-errors.json'),(await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:30}})).ndjson);
 for(const spec of report.sheets){
  const img=await wb.render({sheetName:spec.name,range:spec.rows.length?'A5:D7':'A9:G12',scale:1,format:'png'});
  await fs.writeFile(path.join(run,'qa','delivery-'+spec.name+'.png'),new Uint8Array(await img.arrayBuffer()));
 }
 await(await SpreadsheetFile.exportXlsx(wb)).save(file);
 // Sheet removal is completed by the package-level fallback: this runtime's
 // documented help exposes no worksheet removal operation.
 await fs.writeFile(path.join(run,'pagination/delivery-keep-sheets.json'),JSON.stringify(['完整属性卡','商品参考样本',...report.sheets.map(s=>s.name)]));
 console.log(JSON.stringify({output:file,products:report.products,keepSheets:23}));
 process.exit(0);
}
if(process.argv[3]==='pagination'){
 const p=JSON.parse(await fs.readFile(path.join(run,'pagination/final-review.json'),'utf8'));
 const s=wb.worksheets.getItem('5件试填说明');
 const before=path.join(run,'pagination/before-pagination-notes.xlsx');
 try{await fs.access(before);}catch{await fs.copyFile(file,before);}
 for(const [name,note]of Object.entries(p.notes)){
  const leaf=wb.worksheets.getItem(name);
  leaf.getRange('A3').values=[[note]];
  leaf.getRange('A6').values=[['待确认，未纳入试填。已完成本类在售商品逐页检索；不代表商品数量为0或全部错挂。具体候选见“5件试填说明”第41行起。']];
  for(let row=6;row<=26;row++)if(s.getRange(`A${row}`).values[0][0]===name){
   s.getRange(`F${row}:G${row}`).values=[[p.totals.find(x=>x[0]===name)[3],note]];
   s.getRange(`A${row}:G${row}`).format.rowHeight=105;
  }
 }
 s.getRange('B29:B30').values=[[p.incrementCost],[p.cumulativeCost]];
 s.getRange('A34').values=[['两类在售商品逐页检索（2026-10-20）']];
 s.getRange('A35:G37').values=[['末级类目','类目ID','在售总数','去重检索件数','已查页数','每页上限','口径说明'],...p.totals];
 s.getRange('A40').values=[['待确认商品举例（不是属性试填结果）']];
 s.getRange(`A41:G${41+p.examples.length}`).values=[['原挂载类目','商品源ID','商品标题','销售规格','当前结论','核对资料','具体原因'],...p.examples];
 s.getRange(`A34:G${41+p.examples.length}`).format.font={name:'Arial',size:11,color:'#243247'};
 for(const row of [34,40])s.getRange(`A${row}`).format={font:{name:'Arial',size:12,bold:true,color:'#123B50'},rowHeight:32};
 for(const row of [35,41])s.getRange(`A${row}:G${row}`).format={fill:'#06485A',font:{name:'Arial',size:11,bold:true,color:'#FFFFFF'},wrapText:true,rowHeight:36,verticalAlignment:'center'};
 s.getRange('A36:G37').format={wrapText:true,rowHeight:72,verticalAlignment:'top'};
 s.getRange(`A42:G${41+p.examples.length}`).format={wrapText:true,rowHeight:165,verticalAlignment:'top'};
 s.tables.add('A35:G37',true,'PaginationTotals').showFilterButton=true;
 s.tables.add(`A41:G${41+p.examples.length}`,true,'PaginationExamples').showFilterButton=true;
 wb.recalculate();
 for(const [sheetName,range,suffix]of [['5件试填说明','A34:G37','totals'],['5件试填说明','A40:G44','examples'],['一次性日杂','A2:H7','misc'],['生活用纸','A2:H7','paper']]){
  const img=await wb.render({sheetName,range,scale:1,format:'png'});
  await fs.writeFile(path.join(run,'qa','pagination-'+suffix+'.png'),new Uint8Array(await img.arrayBuffer()));
 }
 await fs.writeFile(path.join(run,'qa/pagination-inspect.json'),(await wb.inspect({kind:'table',range:'5件试填说明!A35:G37',include:'values,formulas',tableMaxRows:3,tableMaxCols:7,maxChars:2500})).ndjson);
 await fs.writeFile(path.join(run,'qa/pagination-errors.json'),(await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:30}})).ndjson);
 await(await SpreadsheetFile.exportXlsx(wb)).save(file);
 console.log(JSON.stringify({output:file,pagedProducts:p.totals.reduce((n,r)=>n+r[3],0),productsAdded:0}));
 process.exit(0);
}
if(process.argv[3]==='inspect'){
 console.log((await wb.inspect({kind:'sheet',include:'id,name',maxChars:2000})).ndjson);
 const p=await wb.render({sheetName:'完整属性卡',range:'A5:F8',scale:1,format:'png'});
 await fs.writeFile(path.join(run,'qa/before.png'),new Uint8Array(await p.arrayBuffer()));
 process.exit(0);
}
const d=JSON.parse(await fs.readFile(path.join(run,'report.json'),'utf8'));
const col=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
const safe=v=>typeof v==='string'&&/^[=+@]/.test(v)?"'"+v:v;
const headers=['序号','类目ID','完整类目路径','属性ID','属性名','商品源ID','商品标题','销售规格','字段类型','单位','必填策略','试填状态','试填值','枚举状态','现有枚举','证据原文','来源','填写依据或缺项原因','计算口径','商品归属确认依据','ES在售核验时间UTC','样本来源','运营审核','运营意见','证据定位'];
const widths=[9,40,50,34,26,40,85,60,12,20,15,20,36,22,65,90,26,90,45,85,28,32,20,60,100];
const specs=[['5件试填说明',['末级类目','类目ID','目标件数','本次试填件数','缺口','候选检查数','说明'],d.overview,[22,40,16,18,16,18,100]],
 ...d.sheets.map(s=>[s.name,headers,s.rows,widths])];
for(const [name,hs,rows,ws]of specs){
 const s=wb.worksheets.add(name),last=col(hs.length-1),end=5+rows.length;s.showGridLines=false;
 s.getRange(`A1:${last}${Math.max(end+1,8)}`).format.font={name:'Arial',size:11,color:'#243247'};
 s.mergeCells('A2:D2');s.getRange('A2').values=[[name==='5件试填说明'?'清洁纸品每类5件小样本试填':name+' · 商品属性试填']];
 s.getRange('A2').format={font:{name:'Arial',size:16,bold:true,color:'#123B50'},rowHeight:32};
 s.mergeCells(`A3:${name==='5件试填说明'?'G':'H'}3`);
 s.getRange('A3').values=[[name==='5件试填说明'?d.note:d.sheets.find(x=>x.name===name).note]];
 s.getRange(`A3:${name==='5件试填说明'?'G':'H'}3`).format={wrapText:true,rowHeight:48,verticalAlignment:'center'};
 s.getRange(`A5:${last}5`).values=[hs];
 s.getRange(`A5:${last}5`).format={fill:'#06485A',font:{name:'Arial',size:11,bold:true,color:'#FFFFFF'},rowHeight:36,wrapText:true,verticalAlignment:'center'};
 for(let i=0;i<ws.length;i++)s.getRange(`${col(i)}1:${col(i)}${Math.max(end+1,8)}`).format.columnWidth=ws[i];
 if(rows.length){
  s.getRange(`A6:${last}${end}`).values=rows.map(r=>r.map(safe));
  s.tables.add(`A5:${last}${end}`,true,'SmallTrial'+specs.findIndex(x=>x[0]===name)).showFilterButton=true;
  s.getRange(`A6:${last}${end}`).format={wrapText:true,verticalAlignment:'top'};
  for(let i=0;i<rows.length;i++){
   const lines=Math.max(...rows[i].map((v,j)=>String(v??'').split('\n').reduce((n,t)=>n+Math.max(1,Math.ceil([...t].reduce((a,c)=>a+(c.charCodeAt(0)>255?2:1),0)/(ws[j]-3))),0)));
   s.getRange(`A${6+i}:${last}${6+i}`).format.rowHeight=Math.min(405,Math.max(36,lines*15+10));
  }
  if(name!=='5件试填说明'){
   s.getRange(`W6:W${end}`).dataValidation={rule:{type:'list',values:['待运营审核','通过','需修改']}};
   s.getRange(`W6:X${end}`).format.fill='#FFF2CC';
  }
 }else{s.mergeCells('A6:H7');s.getRange('A6').values=[['本轮未找到可确定归属的有效样本，未填写属性值。详见第3行说明。']];s.getRange('A6:H7').format={wrapText:true,verticalAlignment:'center'};}
 s.freezePanes.freezeRows(5);if(name!=='5件试填说明')s.freezePanes.freezeColumns(1);
}
const summary=wb.worksheets.getItem('5件试填说明');
summary.getRange('A29:B31').values=[['新增试填费用估算（元）',d.incrementCost],['累计费用估算（元）',d.cumulativeCost],['此次试填商品数',d.products]];
summary.getRange('A29:A31').format.columnWidth=30;summary.getRange('B29:B30').setNumberFormat('0.0000');
wb.recalculate();
await fs.writeFile(path.join(run,'qa/inspect.json'),(await wb.inspect({kind:'table',range:'5件试填说明!A5:G26',include:'values,formulas',tableMaxRows:22,tableMaxCols:7,maxChars:4000})).ndjson);
await fs.writeFile(path.join(run,'qa/formula-errors.json'),(await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:30}})).ndjson);
for(const [name,,rows]of specs){
 if(process.env.QA_SHEET&&name!==process.env.QA_SHEET)continue;
 const p=await wb.render({sheetName:name,range:name==='5件试填说明'?'A5:G11':rows.length?'J5:N8':'A2:H7',scale:1,format:'png'});
 await fs.writeFile(path.join(run,'qa',name+'.png'),new Uint8Array(await p.arrayBuffer()));
}
try{await fs.access(backup);}catch{await fs.copyFile(file,backup);}
await(await SpreadsheetFile.exportXlsx(wb)).save(file);
console.log(JSON.stringify({output:file,addedSheets:specs.length,products:d.products}));
