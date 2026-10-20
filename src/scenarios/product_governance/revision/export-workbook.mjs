import fs from 'node:fs/promises';
import path from 'node:path';
import {Workbook,SpreadsheetFile} from '@oai/artifact-tool';
const dir=path.join(process.cwd(),'outputs/product-governance/clean-paper-21-revision-20261019');
const report=JSON.parse(await fs.readFile(path.join(dir,'report-data.json'),'utf8'));
const wb=Workbook.create();
const col=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
const printable=v=>v===null||v===undefined?'':typeof v==='object'?JSON.stringify(v):v;
const safe=v=>typeof v==='string'&&v.startsWith('=')?"'"+v:v;
await fs.mkdir(path.join(dir,'report-qa'),{recursive:true});
for(const [i,t] of report.tables.entries()){
 const sh=wb.worksheets.add(t.name),end=t.rows.length+5,last=col(t.headers.length-1);
 sh.showGridLines=false;
 sh.getRange(`A1:${last}${end}`).format.font={name:'Arial',size:10,color:'#243444'};
 sh.getRange(`A1:${last}${end}`).format.verticalAlignment='center';
 sh.getRange('A2').values=[[t.title]];
 sh.getRange('A2').format.font={name:'Arial',size:14,bold:true,color:'#243D5C'};
 sh.getRange('A2').format.rowHeight=30;
 sh.getRange(`A3:${last}3`).format.borders={bottom:{style:'thin',color:'#D7E0E9'}};
 if(t.subtitle){sh.getRange('A3').values=[[t.subtitle]];sh.getRange('A3').format.font={name:'Arial',size:10,color:'#526477'};sh.getRange('A3').format.rowHeight=24;}
 const rows=t.rows.map(r=>r.map(printable).map(safe));
 sh.getRange(`A5:${last}${end}`).values=[t.headers,...rows];
 sh.tables.add(`A5:${last}${end}`,true,'RevisionTable'+i);
 const h=sh.getRange(`A5:${last}5`);
 h.format={fill:'#243D5C',font:{name:'Arial',size:10,bold:true,color:'#FFFFFF'},rowHeight:34,wrapText:true,horizontalAlignment:'center',verticalAlignment:'center'};
 h.format.borders={insideVertical:{style:'thin',color:'#FFFFFF'}};
 const body=sh.getRange(`A6:${last}${end}`);body.format.wrapText=true;body.format.fill='#FFFFFF';
 t.widths.forEach((w,j)=>sh.getRange(`${col(j)}5:${col(j)}${end}`).format.columnWidth=w);
 rows.forEach((r,j)=>{
  const height=Math.max(40,...r.map((v,k)=>{const text=String(v);return (Math.ceil([...text].reduce((n,c)=>n+(c.charCodeAt(0)>255?2:1),0)/Math.max(8,t.widths[k]-2))+text.split('\n').length-1)*14+10;}));
  const range=sh.getRange(`A${j+6}:${last}${j+6}`);range.format.rowHeight=Math.min(400,height);if(j%2)range.format.fill='#F1F5F9';
 });
 if(t.formulas)for(const [cell,formula]of Object.entries(t.formulas))sh.getRange(cell).formulas=[[formula]];
 if(t.formats)for(const [range,format]of Object.entries(t.formats))sh.getRange(range).setNumberFormat(format);
 if(t.rows.length>15){sh.freezePanes.freezeRows(5);sh.freezePanes.freezeColumns(1);}
 if(t.editable){for(const c of t.editable)sh.getRange(`${c}6:${c}${end}`).format.fill='#FFF0CF';}
}
wb.recalculate();
const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:30},maxChars:4000});
await fs.writeFile(path.join(dir,'report-qa/errors.ndjson'),errors.ndjson);
for(const t of report.tables.filter(t=>!process.argv.includes('--layout-edit')||['修订总览','21类完整属性卡'].includes(t.name))){
 const png=await wb.render({sheetName:t.name,range:t.preview??`A2:${col(Math.min(t.headers.length,5)-1)}${Math.min(9,t.rows.length+5)}`,scale:1.2,format:'png'});
 await fs.writeFile(path.join(dir,'report-qa',t.name+'.png'),new Uint8Array(await png.arrayBuffer()));
}
for(const [sheet,range,label] of [['21类完整属性卡','L5:Q8','属性规则细节'],['四模型裁定','G5:I9','裁定理由'],['修订与迁移','C5:F7','迁移内容']]){if(process.argv.includes('--layout-edit')&&sheet!=='21类完整属性卡')continue;const png=await wb.render({sheetName:sheet,range,scale:1,format:'png'});await fs.writeFile(path.join(dir,'report-qa',label+'.png'),new Uint8Array(await png.arrayBuffer()));}
const inspect=await wb.inspect({kind:'region',sheetId:report.tables[0].name,range:'A5:D14',maxChars:5000});
await fs.writeFile(path.join(dir,'report-qa/overview.ndjson'),inspect.ndjson);
const output=path.join(dir,'清洁纸品21类属性修订与四模型评审_20261019.xlsx');
await (await SpreadsheetFile.exportXlsx(wb)).save(output);
console.log(JSON.stringify({output,sheets:report.tables.map(t=>t.name),rows:report.tables.map(t=>t.rows.length),errors:errors.ndjson}));
