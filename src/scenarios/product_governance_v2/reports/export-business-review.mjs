import fs from 'node:fs/promises';
import path from 'node:path';
import {Workbook,SpreadsheetFile,FileBlob} from '@oai/artifact-tool';
import {addReviewSheet,columnLetter,humanizeReviewUnits,applyAttributeCardLayout} from './review-layout.mjs';
const args=process.argv.slice(2),dir=path.resolve(args[0]);
await fs.mkdir(path.join(dir,'qa'),{recursive:true});
if(args.includes('--inspect-source')){
 const meta=JSON.parse(await fs.readFile(path.join(dir,'reference-inspection.json'),'utf8'));
 for(const key of ['original','colleague']){
  const w=await SpreadsheetFile.importXlsx(await FileBlob.load(meta[key].path));
  const p=await w.render({sheetName:'完整属性卡',range:key==='original'?'D5:K10':'D1:L6',scale:1,format:'png'});
  await fs.writeFile(path.join(dir,'qa',`before-${key}.png`),new Uint8Array(await p.arrayBuffer()));
 }
 process.exit(0);
}
const data=JSON.parse(await fs.readFile(path.join(dir,'delivery.json'),'utf8')),w=Workbook.create();
applyAttributeCardLayout(data.sheets.find(s=>s.name==='完整属性卡'));
humanizeReviewUnits(data.sheets,JSON.parse(await fs.readFile(path.join(dir,'final-cards.json'),'utf8')));
for(const [i,spec]of data.sheets.entries())addReviewSheet(w,spec,i);
w.recalculate();
await fs.writeFile(path.join(dir,'qa/errors.ndjson'),(await w.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:30},maxChars:2000})).ndjson);
for(const spec of data.sheets){
 const end=Math.min(7,spec.rows.length+2),range=spec.name==='完整属性卡'?`D1:M${end}`:spec.name==='商品参考样本'?`A1:F${end}`:`B1:J${end}`;
 const p=await w.render({sheetName:spec.name,range,scale:1,format:'png'});
 await fs.writeFile(path.join(dir,'qa',spec.name+'.png'),new Uint8Array(await p.arrayBuffer()));
}
const file=path.join(dir,'清洁纸品21类属性卡与商品明细_运营审阅版.xlsx');
await(await SpreadsheetFile.exportXlsx(w)).save(file);
console.log(JSON.stringify({file,sheets:data.sheets.length,rows:data.sheets.reduce((n,s)=>n+s.rows.length,0),rowHeight:18}));
