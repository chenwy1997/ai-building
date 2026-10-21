import {join,resolve} from 'node:path';
import {read,save,hash,now} from '../runtime/store.ts';
import {checkCard} from '../domain/validate.ts';
import {registry} from '../domain/registry.ts';
const root=resolve(process.argv[2]!),rev=join(root,'revisions/closure-r3'),dir=join(rev,'naming-r1');
const cards=await read(join(dir,'candidate-cards.json')),records=await read(join(dir,'base-records.json')),migration=await read(join(dir,'candidate-migration.json'));
const errors:any[]=[];
for(const d of cards){
 for(const error of checkCard(d.card,d.category.id,d.sources))errors.push({category:d.category.name,error});
 const names=d.card.attributes.map((a:any)=>a.name);if(new Set(names).size!==names.length)errors.push({category:d.category.name,error:'duplicate displayed names'});
}
for(const record of records){
 const m=migration[record.product.id],card=cards.find((d:any)=>d.category.id===record.product.categoryId).card;
 const values=m?[...record.values.filter((v:any)=>!m.removeIds.includes(v.attributeId)&&!m.values.some((x:any)=>x.attributeId===v.attributeId)),...m.values]:record.values;
 const ids=values.map((v:any)=>v.attributeId);
 if(ids.length!==card.attributes.length||new Set(ids).size!==ids.length||ids.some((id:string)=>!card.attributes.some((a:any)=>a.id===id)))errors.push({productId:record.product.id,error:'migration coverage',missing:card.attributes.filter((a:any)=>!ids.includes(a.id)).map((a:any)=>a.id)});
 for(const v of values){
  if(v.status!=='filled')continue;
  const a=card.attributes.find((a:any)=>a.id===v.attributeId);
  if(!a)continue;
  if(!v.evidence?.length)errors.push({productId:record.product.id,id:v.attributeId,error:'filled without evidence'});
  for(const e of v.evidence??[]){
   const source=record.evidence.find((s:any)=>s.id===e.id);
   if(!source||!e.quote||!source.text.includes(e.quote))errors.push({productId:record.product.id,id:v.attributeId,error:'invalid exact quote',quote:e.quote,sourceId:e.id});
  }
  if(a.fieldType==='数值'&&!/^-?\d+(\.\d+)?$/.test(String(v.value)))errors.push({productId:record.product.id,id:v.attributeId,error:'numeric type'});
 }
}
await save(join(dir,'validation.json'),{errors,products:records.length,bindings:cards.reduce((n:number,d:any)=>n+d.card.attributes.length,0)});
if(errors.length){console.log(JSON.stringify(errors,null,2));process.exit(1);}
const reg=registry(cards.map((d:any)=>d.card));
await save(join(dir,'attribute-registry.json'),{version:'naming-r1',scope:'清洁纸品21类；非全站属性库',identity:'公共定义用显式common ID；非公共定义用categoryId+attribute.id定位；同名不自动合并',...reg});
for(const d of cards){
 const previousHash=d.cardHash;d.cardHash=hash(d.card);d.standardHash=(await read(join(dir,'repair-standard.json'))).hash;
 (d.history??=[]).push({stage:'naming-r1',previousCardHash:previousHash,cardHash:d.cardHash,standardHash:d.standardHash,reviewedAt:now(),audit:join(dir,'naming-audit.json')});
}
await save(join(dir,'final-cards.json'),cards);
await save(join(dir,'migration.json'),migration);
await save(join(rev,'final-cards.json'),cards);
console.log(JSON.stringify({verified:true,products:records.length,sharedDefinitions:reg.shared.length,categoryScopedDefinitions:reg.categoryScoped.length}));
