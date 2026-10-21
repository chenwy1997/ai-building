/** One business-review layout. Full modeling/evidence stays in the local JSON. */
export const reviewLayout=Object.freeze({font:'Arial',fontSize:10,rowHeight:15,headerHeight:18,groupHeight:18,headerRow:2});
export const headerGroupColors=['#D9E1F2','#FCE4D6','#FFF2CC','#E2EFDA','#E4DFEC'];
export const columnLetter=index=>{let s='';for(let n=index+1;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
const literal=v=>typeof v==='string'&&/^[=+@]/.test(v)?"'"+v:v??null;
/** The fixed area identifies the attribute; category IDs stay in the right-hand supplement. */
export function applyAttributeCardLayout(spec){
 const headers=['序号','完整类目路径','末级类目','属性ID','属性名','公共/特性','字段类型','必填策略','单位','枚举值','运营审核','运营意见','条件必填说明','属性说明','标准类目ID'];
 const order=headers.map(h=>spec.headers.indexOf(h));
 if(order.some(i=>i<0)||spec.headers.length!==headers.length)throw Error('unexpected attribute card columns');
 spec.rows=spec.rows.map(row=>order.map(i=>row[i]));
 Object.assign(spec,{headers,widths:[6,42,14,29,18,14,10,12,20,42,16,32,40,65,36],groups:[['类目与属性定位',0,4],['属性结果',5,9],['运营审核',10,11],['说明',12,13],['类目补充',14,14]],statusColumn:10,reviewColumns:[10,11],freezeColumns:5});
 return spec;
}
/** Display projection only: keep machine references in cards, never in the unit column. */
export function humanizeReviewUnits(sheets,cards){
 const byId=new Map(cards.map(e=>[e.category.id,e]));
 const byName=new Map();
 for(const e of cards){if(byName.has(e.category.name))throw Error('ambiguous leaf '+e.category.name);byName.set(e.category.name,e);}
 const changes=[];
 const paired=(entry,id)=>{
  const a=entry.card.attributes.find(a=>a.id===id);if(!a)throw Error('unknown displayed attribute '+id);
  const match=a.unit.match(/^见配套(?:属性|字段)\s*[:：]?\s*([a-z][a-z0-9_.]*)$/);
  if(!match){if(/见配套/.test(a.unit))throw Error('unresolved unit display '+id);return null;}
  const p=entry.card.attributes.find(a=>a.id===match[1]);if(!p)throw Error('missing paired unit '+match[1]);
  return p;
 };
 const explain=(text,entry)=>{
  let value=text??'';
  for(const a of [...entry.card.attributes].sort((a,b)=>b.id.length-a.id.length)){
   const id=a.id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
   value=value.replace(new RegExp('(?<![a-zA-Z0-9_.])'+id+'(?![a-zA-Z0-9_.])','g'),()=>`“${a.name}”`);
  }
  return value.replace(/见配套属性\s*(“[^”]+”)/g,'见$1');
 };
 for(const sh of sheets){
  const col=name=>sh.headers.indexOf(name),unit=col('单位'),attr=col('属性ID');
  if(unit<0||attr<0)continue;
  if(sh.name==='完整属性卡'){
   for(const row of sh.rows){
    const e=byId.get(row[col('标准类目ID')]);if(!e)throw Error('unknown category for unit display');
    const p=paired(e,row[attr]);if(!p)continue;
    const value=p.enumValues.length?p.enumValues.join('/'):'按商品原文';
    if(row[unit]!==value)changes.push({sheet:sh.name,attributeId:row[attr],before:row[unit],after:value});
    row[unit]=value;
    const note=`计数单位按商品原文填写，配套字段为“${p.name}”，不默认换算。`;
    const d=col('属性说明');row[d]=explain(row[d],e);
    if(!row[d].includes(note))row[d]+=(row[d]&&!/[。；]$/.test(row[d])?'。':'')+note;
    const c=col('条件必填说明');if(c>=0&&row[c])row[c]=explain(row[c],e);
   }
  }else{
   const e=byName.get(sh.name);if(!e)throw Error('unknown leaf for unit display');
   const product=col('商品源ID'),value=col('试填值'),status=col('试填状态');
   const rows=new Map(sh.rows.map(row=>[row[product]+'|'+row[attr],row]));
   for(const row of sh.rows){
    const p=paired(e,row[attr]);if(!p)continue;
    const peer=rows.get(row[product]+'|'+p.id),raw=peer?.[value];
    // A real per-product unit wins; never infer it from the category's option list.
    const known=typeof raw==='string'&&raw.trim()&&!/^(?:unknown|未知|待确认|未提供|无值|其他)$/i.test(raw.trim());
    const display=known?raw:row[status]==='不适用'?'不适用':'待确认';
    if(row[unit]!==display)changes.push({sheet:sh.name,productId:row[product],attributeId:row[attr],before:row[unit],after:display});
    row[unit]=display;
   }
  }
 }
 return changes;
}
/** Keep category/product groups intact; classification comes from the approved card. */
export function orderReviewRows(sheets){
 const main=sheets.find(s=>s.name==='完整属性卡');
 if(!main)throw Error('missing 完整属性卡');
 const column=name=>{const i=main.headers.indexOf(name);if(i<0)throw Error('missing '+name);return i;};
 const category=column('标准类目ID'),leaf=column('末级类目'),attribute=column('属性ID'),kind=column('公共/特性');
 const groups=new Map();
 for(const row of main.rows)if(!groups.has(row[category]))groups.set(row[category],groups.size);
 main.rows=main.rows.map((row,index)=>({row,index})).sort((a,b)=>
  groups.get(a.row[category])-groups.get(b.row[category])||
  Number(b.row[kind]==='公共属性')-Number(a.row[kind]==='公共属性')||a.index-b.index
 ).map(({row})=>row);
 const ranksByLeaf=new Map(),ownerByLeaf=new Map();
 for(const row of main.rows){
  const name=row[leaf],id=row[category];
  if(ownerByLeaf.has(name)&&ownerByLeaf.get(name)!==id)throw Error('ambiguous leaf sheet '+name);
  ownerByLeaf.set(name,id);
  if(!ranksByLeaf.has(name))ranksByLeaf.set(name,new Map());
  const ranks=ranksByLeaf.get(name);ranks.set(row[attribute],ranks.size);
 }
 const renumber=spec=>{const i=spec.headers.indexOf('序号');if(i>=0)spec.rows=spec.rows.map((row,n)=>{const copy=[...row];copy[i]=n+1;return copy;});};
 renumber(main);
 for(const spec of sheets){
  if(spec===main||!ranksByLeaf.has(spec.name))continue;
  const product=spec.headers.indexOf('商品源ID'),attr=spec.headers.indexOf('属性ID');
  if(product<0||attr<0)continue;
  const products=new Map(),ranks=ranksByLeaf.get(spec.name);
  for(const row of spec.rows)if(!products.has(row[product]))products.set(row[product],products.size);
  spec.rows=spec.rows.map((row,index)=>({row,index})).sort((a,b)=>
   products.get(a.row[product])-products.get(b.row[product])||
   (ranks.get(a.row[attr])??Number.MAX_SAFE_INTEGER)-(ranks.get(b.row[attr])??Number.MAX_SAFE_INTEGER)||a.index-b.index
  ).map(({row})=>row);
  renumber(spec);
 }
 return sheets;
}
export function addReviewSheet(wb,spec,index){
 return writeReviewSheet(wb.worksheets.add(spec.name),spec,index);
}
export function writeReviewSheet(s,spec,index){
 const last=columnLetter(spec.headers.length-1),end=spec.rows.length+2;
 s.showGridLines=false;
 s.getRange(`A1:${last}${end}`).format={font:{name:reviewLayout.font,size:reviewLayout.fontSize,color:'#243247'},rowHeight:reviewLayout.rowHeight,wrapText:false,verticalAlignment:'center'};
 s.getRange(`A2:${last}2`).values=[spec.headers];
 if(spec.rows.length)s.getRange(`A3:${last}${end}`).values=spec.rows.map(row=>row.map(literal));
 for(let c=0;c<spec.headers.length;c++)s.getCell(0,c).format.columnWidth=spec.widths[c];
 s.getRange(`A2:${last}2`).format={font:{name:reviewLayout.font,size:10,bold:true,color:'#243247'},rowHeight:reviewLayout.headerHeight,wrapText:false,verticalAlignment:'center'};
 for(const [i,[label,start,finish]]of spec.groups.entries()){
  const range=`${columnLetter(start)}1:${columnLetter(finish)}1`;
  if(start!==finish)s.mergeCells(range);
  s.getRange(`${columnLetter(start)}1`).values=[[label]];
  s.getRange(range).format={fill:headerGroupColors[i%headerGroupColors.length],font:{name:reviewLayout.font,size:10,bold:true,color:'#243247'},rowHeight:reviewLayout.groupHeight,horizontalAlignment:'center'};
  s.getRange(`${columnLetter(start)}2:${columnLetter(finish)}2`).format.fill=headerGroupColors[i%headerGroupColors.length];
 }
 if(spec.rows.length){
  const t=s.tables.add(`A2:${last}${end}`,true,`BusinessReview${index}`);t.style='TableStyleLight9';t.showFilterButton=true;
  for(const column of spec.reviewColumns??[])s.getRange(`${columnLetter(column)}3:${columnLetter(column)}${end}`).format.fill='#FFF2CC';
  if(spec.statusColumn!==undefined)s.getRange(`${columnLetter(spec.statusColumn)}3:${columnLetter(spec.statusColumn)}${end}`).dataValidation={rule:{type:'list',values:['待运营审核','通过','需修改']}};
 }
 s.freezePanes.freezeRows(2);s.freezePanes.freezeColumns(spec.groups.some(g=>g[0]==='类目与属性定位')?5:spec.freezeColumns??1);
 return s;
}
