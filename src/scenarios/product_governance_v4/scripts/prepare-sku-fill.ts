import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

// Prepare frozen evidence and author packets. This step does not infer values.
const flags=Object.fromEntries(process.argv.slice(2).reduce<string[][]>((a,v,i,all)=>{if(i%2===0)a.push([v.replace(/^--/,''),all[i+1]!]);return a;},[]));
if(!flags.out)throw Error('--out required');
const out=path.resolve(flags.out),read=async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const selection=await read(path.join(out,'selection.json'));
const contractText=await fs.readFile(selection.contractPath,'utf8');
if(sha(contractText)!==selection.contractSha256)throw Error('Frozen contract changed');
const contract=JSON.parse(contractText),summary=await read(path.join(out,'collection/summary.json'));
const byId=new Map<string,any>(summary.rows.map((r:any)=>[r.skuId,r]));
const sources:any[]=[],skus:any[]=[],packets:any[]=[];
function source(skuId:string,kind:string,field:string,text:string|null,readState:string,locator:string){
 const s={sourceId:`${kind}:${skuId}:${field}`,skuId,kind,field,text,sha256:text===null?null:sha(text),readState,locator};sources.push(s);return s;
}
for(const cat of selection.categories){
 const c={...cat.category,id:cat.category.categoryId};
 const es=await read(path.join(out,'raw/es',c.id+'.json'));
 const esMap=new Map(es.records.map((r:any)=>[r.productId,r]));
 const selected:any[]=[];
 for(const pick of cat.selected){
  const e:any=esMap.get(pick.skuId);if(!e)throw Error('Missing frozen ES row');
  const q=byId.get(pick.skuId),data=q?.data??{};
  const fields=[];
  for(const field of ['title','rawTitle'])if(typeof e[field]==='string'&&e[field].trim())fields.push(source(pick.skuId,'es',field,e[field],'available',`raw/es/${c.id}.json#${pick.skuId}/${field}`));
  for(const field of ['title','saleSpec','brandName']){
   const text=typeof data[field]==='string'?data[field]:null;
   fields.push(source(pick.skuId,'summary',field,text,q?.status==='ok'?(text?.trim()?'available':'empty'):'read_failed',`collection/summary.json#${pick.skuId}/${field}`));
  }
  fields.push(source(pick.skuId,'management','full_detail',null,'unread','完整管理端详情尚无可用批量鉴权；不是已读取后为空'));
  if(data.mainImages)fields.push({...source(pick.skuId,'image','main',null,'image_only',String(data.mainImages)),note:'摘要首图仅记录地址；未识图'});
  const identity={...pick,category:c.name,path:c.path,title:data.title??e.title??e.rawTitle??'',saleSpec:data.saleSpec??'',upstreamName:data.upstreamName??'',summaryStatus:q?.status??'missing',fullDetailRead:false,imageRecognized:false};
  skus.push(identity);selected.push({...identity,sources:fields.filter(f=>f.readState==='available')});
 }
 packets.push({category:c.name,categoryId:c.id,attributes:contract.proposals.filter((p:any)=>p.categoryId===c.id),skus:selected});
}
const evidence={version:1,createdAt:new Date().toISOString(),contractPath:selection.contractPath,expectedContractSha256:selection.contractSha256,selectionSha256:sha(await fs.readFile(path.join(out,'selection.json'))),sampling:{method:selection.selectionMethod,categories:selection.categories.map((c:any)=>({...c.category,selected:c.selected.length,available:c.availableUniqueSku,gap:c.gap}))},skus,sources,limitations:['摘要不包含全部动态参数、详情正文和详情图','ES/摘要同标题不是两份独立证据','未读取图片内容','属性方案认可不等于商品值认可'],productionWrites:0};
await fs.mkdir(path.join(out,'author-input'),{recursive:true});
await fs.writeFile(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');
for(const packet of packets)await fs.writeFile(path.join(out,'author-input',packet.category+'.json'),JSON.stringify({contractSha256:selection.contractSha256,...packet},null,2)+'\n');
console.log(JSON.stringify({skus:skus.length,sources:sources.length,categories:packets.length,productionWrites:0}));
