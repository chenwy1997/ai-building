/** Reorder the attribute-card display only; other worksheets remain untouched. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {Workbook,SpreadsheetFile,FileBlob} from '@oai/artifact-tool';
import {reviewLayout,columnLetter,applyAttributeCardLayout,addReviewSheet,humanizeReviewUnits} from './review-layout.mjs';
const dir=path.resolve(process.argv[2]),cardsPath=process.argv[3],file=path.join(dir,'清洁纸品21类属性卡与商品明细_运营审阅版.xlsx'),backup=path.join(dir,cardsPath?'before-unit-boundary.xlsx':'before-readable-units.xlsx');
try{await fs.access(backup);}catch{await fs.copyFile(file,backup);}
const source=await SpreadsheetFile.importXlsx(await FileBlob.load(file)),data=JSON.parse(await fs.readFile(path.join(dir,'delivery.json'),'utf8'));
const changedDetailSheets=[];
// Preserve the actual review cells, including operator feedback. Rebuild this controlled
// value-only report through its shared writer so moved validation ranges cannot linger.
for(const sh of data.sheets){
 const s=source.worksheets.getItem(sh.name),last=columnLetter(sh.headers.length-1);
 sh.headers=s.getRange(`A2:${last}2`).values[0];
 if(sh.rows.length)sh.rows=s.getRange(`A3:${last}${sh.rows.length+2}`).values;
}
const spec=data.sheets.find(s=>s.name==='完整属性卡');
if(cardsPath){
 const cards=JSON.parse(await fs.readFile(path.resolve(cardsPath),'utf8'));
 if(cards.some(e=>e.unitBoundaryRevision&&e.codexUnitBoundaryReview?.status!=='approved_for_operations_review'))throw Error('unit-boundary changes require Codex approval');
 const byId=new Map(cards.map(e=>[e.category.id,e]));
 for(const e of cards)if(e.unitBoundaryRevision?.changes.some(c=>c.field==='name'))changedDetailSheets.push(e.category.name);
 const col=name=>spec.headers.indexOf(name);
 for(const row of spec.rows){
  const e=byId.get(row[col('标准类目ID')]),a=e?.card.attributes.find(a=>a.id===row[col('属性ID')]);
  if(!a)throw Error('unknown approved attribute');
  row[col('属性名')]=a.name;row[col('属性说明')]=a.definition;
 }
 for(const sh of data.sheets){
  if(sh===spec||sh.name==='商品参考样本')continue;
  const e=cards.find(e=>e.category.name===sh.name),attr=sh.headers.indexOf('属性ID'),name=sh.headers.indexOf('属性名');
  if(!e||attr<0||name<0)throw Error('unknown approved detail sheet');
  for(const row of sh.rows){const a=e.card.attributes.find(a=>a.id===row[attr]);if(!a)throw Error('unknown approved detail attribute');row[name]=a.name;}
 }
}
applyAttributeCardLayout(spec);
const modelCards=JSON.parse(await fs.readFile(path.resolve(cardsPath??path.join(dir,'final-cards.json')),'utf8'));
const unitDisplayChanges=humanizeReviewUnits(data.sheets,modelCards);
const w=Workbook.create();
for(const [i,sh]of data.sheets.entries())addReviewSheet(w,sh,i);
w.recalculate();
await fs.mkdir(path.join(dir,'qa-compact'),{recursive:true});
// Render the header without pane duplication; restore the saved Excel panes below.
const main=w.worksheets.getItem(spec.name);main.freezePanes.unfreeze();
for(const [name,range] of [['完整属性卡','A1:K8'],['完整属性卡-类目补充','J1:O8']]){
 const p=await w.render({sheetName:spec.name,range,scale:1,format:'png'});await fs.writeFile(path.join(dir,'qa-compact',name+'.png'),new Uint8Array(await p.arrayBuffer()));
}
main.freezePanes.freezeRows(2);main.freezePanes.freezeColumns(spec.freezeColumns);
for(const name of changedDetailSheets){
 const p=await w.render({sheetName:name,range:'E1:J16',scale:1,format:'png'});
 await fs.writeFile(path.join(dir,'qa-compact',name+'-命名修订.png'),new Uint8Array(await p.arrayBuffer()));
}
const kitchen=spec.rows.filter(row=>row[spec.headers.indexOf('末级类目')]==='厨房纸巾');
if(kitchen.length){
 const first=spec.rows.indexOf(kitchen.find(row=>row[spec.headers.indexOf('属性名')]==='单卷节数')??kitchen[0])+3;
 const p=await w.render({sheetName:spec.name,range:`E${Math.max(3,first-1)}:J${Math.min(first+8,spec.rows.length+2)}`,scale:1,format:'png'});
 await fs.writeFile(path.join(dir,'qa-compact','单位展示.png'),new Uint8Array(await p.arrayBuffer()));
 const p2=await w.render({sheetName:'厨房纸巾',range:'E15:J25',scale:1,format:'png'});
 await fs.writeFile(path.join(dir,'qa-compact','厨房纸巾-单位展示.png'),new Uint8Array(await p2.arrayBuffer()));
}
await(await SpreadsheetFile.exportXlsx(w)).save(file);
await fs.writeFile(path.join(dir,'delivery.json'),JSON.stringify(data,null,2));
await fs.writeFile(path.join(dir,'unit-display-changes.json'),JSON.stringify(unitDisplayChanges,null,2));
console.log(JSON.stringify({file,rowHeight:reviewLayout.rowHeight,unitDisplayChanges:unitDisplayChanges.length,frozenColumns:spec.headers.slice(0,5),categorySupplement:'O列：标准类目ID'}));
