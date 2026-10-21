/** Build the review projection from approved DeepSeek results, without editing semantics. */
import {resolve,join} from 'node:path';
import {read,save,hash} from '../runtime/store.ts';
import {registry} from '../domain/registry.ts';
import {orderReviewRows,applyAttributeCardLayout,humanizeReviewUnits} from '../reports/review-layout.mjs';
const out=resolve(process.argv[2]!);
const original=await read(join(out,'ds-manifest.json')).then(m=>m.entries);
const book=await read(join(out,'source-workbook-data.json'));
const cards=await read(join(out,'ds-approved-cards.json'));
if(cards.length!==original.length||cards.some((e:any)=>e.businessRevision.provider!=='official_deepseek'||!e.codexReview))throw Error('approved DS results required');
const changes=cards.flatMap((e:any)=>e.businessRevision.changes.map((c:any)=>({...c,categoryId:e.category.id})));
const base=cards.flatMap((e:any)=>e.businessRevision.skuBaseFields.map((f:any)=>({...f,categoryId:e.category.id,categoryName:e.category.name})));
const aliases=cards.flatMap((e:any)=>e.card.attributes.map((a:any)=>({categoryId:e.category.id,attributeId:a.id,name:a.name,previousName:original.find((o:any)=>o.category.id===e.category.id).card.attributes.find((o:any)=>o.id===a.id)?.name})).filter((a:any)=>a.previousName!==a.name));
const byCategory=new Map(cards.map((d:any)=>[d.category.id,d]));
const parse=(sheet:any)=>{const i=sheet.rows.findIndex((row:any[])=>row.includes('属性ID')||row.includes('原始标题'));if(i<0)throw Error('missing header '+sheet.name);const headers=sheet.rows[i];return sheet.rows.slice(i+1).filter((r:any[])=>r.some(x=>x!==null&&x!==''&&x!==undefined)).map((r:any[])=>Object.fromEntries(headers.map((k:string,j:number)=>[k,r[j]??null])));};
const main=parse(book.sheets.find((s:any)=>s.name==='完整属性卡')),operator=new Map(book.colleagueCards.map((r:any)=>[r['类目ID']+'|'+r['属性ID'],r]));
const mainRows:any[]=[],nameByKey=new Map<string,string>();
for(const r of main){
 const e:any=byCategory.get(r['类目ID']),a=e.card.attributes.find((a:any)=>a.id===r['属性ID']);if(!a)continue;
 const b=e.card.bindings.find((b:any)=>b.attributeId===a.id),ops:any=operator.get(r['类目ID']+'|'+a.id);
 nameByKey.set(r['类目ID']+'|'+a.id,a.name);
 mainRows.push([mainRows.length+1,r['类目ID'],r['完整类目路径'],r['末级类目'],a.id,a.name,a.kind,a.fieldType,{always:'必填',conditional:'条件必填',optional:'可选'}[b.requiredness as string],a.unit,a.enumValues.join('；'),ops?.['运营审核状态']??r['运营审核状态']??'待运营审核',ops?.['运营意见']??r['运营意见']??'',b.condition,a.definition]);
}
const sheets:any[]=[{name:'完整属性卡',headers:['序号','标准类目ID','完整类目路径','末级类目','属性ID','属性名','公共/特性','字段类型','必填策略','单位','枚举值','运营审核','运营意见','条件必填说明','属性说明'],rows:mainRows,widths:[6,36,42,14,29,18,14,10,12,10,42,16,32,40,65],groups:[['类目与属性定位',0,4],['属性结果',5,10],['运营审核',11,12],['说明',13,14]],statusColumn:11,reviewColumns:[11,12],freezeColumns:5}];
const samples=parse(book.sheets.find((s:any)=>s.name==='商品参考样本')).filter((r:any)=>r['商品源ID']);
sheets.push({name:'商品参考样本',headers:['序号','商品标题','商品源ID','销售规格','末级类目','归属判断','判断理由','标准类目ID'],rows:samples.map((r:any,i:number)=>[i+1,r['原始标题'],r['商品源ID'],r['销售规格'],r['末级类目'],r['归属判断'],r['判断理由'],r['类目ID']]),widths:[6,65,36,40,16,14,70,36],groups:[['商品信息',0,4],['归属核对',5,6],['定位',7,7]],freezeColumns:1});
const archivedRows:any[]=[];let productRows=0;
for(const sh of book.sheets.slice(2)){
 const rows=parse(sh).filter((r:any)=>r['商品源ID']&&r['属性ID']),kept=rows.filter((r:any)=>{
  const key=r['类目ID']+'|'+r['属性ID'];if(nameByKey.has(key))return true;
  archivedRows.push({sheet:sh.name,field:'skuBase.salesUnit',originalRow:r});return false;
 });
 productRows+=kept.length;
 sheets.push({name:sh.name,headers:['序号','商品标题','商品源ID','销售规格','属性名','试填值','试填状态','单位','运营审核','运营意见','属性ID','归属判断','枚举状态','证据原文','填写依据或缺项原因'],rows:kept.map((r:any,i:number)=>[i+1,r['商品标题'],r['商品源ID'],r['销售规格'],nameByKey.get(r['类目ID']+'|'+r['属性ID']),r['试填值'],r['试填状态'],r['单位'],r['运营审核']??'待运营审核',r['运营意见']??'',r['属性ID'],r['归属判断及待确认事项']??r['商品归属确认依据']??'',r['枚举状态'],r['证据原文'],r['填写依据或缺项原因']]),widths:[6,65,36,40,18,26,16,10,16,32,29,50,16,70,65],groups:[['商品信息',0,3],['试填结果',4,7],['运营审核',8,9],['证据与定位',10,14]],statusColumn:8,reviewColumns:[8,9],freezeColumns:1});
}
applyAttributeCardLayout(sheets[0]);
orderReviewRows(sheets);
humanizeReviewUnits(sheets,cards);
const execution=await read(join(out,'ds-execution.json'));
const summary={categories:cards.length,previousAttributes:original.reduce((n:number,d:any)=>n+d.card.attributes.length,0),attributes:mainRows.length,skuBaseFields:base.length,publicKindCorrections:changes.filter((x:any)=>x.group==='attributes'&&x.field==='kind').length,skuLevelCorrections:changes.filter((x:any)=>x.group==='bindings'&&x.field==='valueLevel').length,nameCorrections:aliases.length,sheets:sheets.length,productRows,archivedBaseRows:archivedRows.length,paidModelCalls:execution.newCalls};
const library=registry(cards.map((d:any)=>d.card));
await save(join(out,'final-cards.json'),cards);await save(join(out,'attribute-library.json'),library);
await save(join(out,'sku-base-fields.json'),{fields:base,trialRows:archivedRows});await save(join(out,'attribute-aliases.json'),aliases);
await save(join(out,'business-changes.json'),{source:'ds-approved-cards.json',sourceHash:hash(original),changes,summary});
await save(join(out,'delivery.json'),{summary,sheets});console.log(JSON.stringify(summary));
