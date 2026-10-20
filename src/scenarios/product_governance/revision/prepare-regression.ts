import {join} from 'node:path';
import {read,save,digest} from '../runtime/storage.ts';
import {ROOT} from '../expansion/settings.ts';
const run=join(ROOT,'outputs/product-governance/clean-paper-21-revision-20261019');
const standard:any=await read(join(run,'design/standard.json'));
const batches=['three-category-20261019','clean-paper-five-20261019'];
const relevant=(a:any)=>Object.fromEntries(['name','kind','type','unit','definition','rule','enum','selection','dictionary','formula','quantity','measurement','operator'].filter(k=>a[k]!==undefined).map(k=>[k,a[k]]));
const records:any[]=[];
for(const batch of batches){
 const dir=join(ROOT,'outputs/product-governance',batch);
 const [old,data]:any[]=await Promise.all([read(join(dir,'design/standard.json')),read(join(dir,'analysis/final.json'))]);
 const definitionChanges=new Set(standard.definitions.filter((a:any)=>{const prev=old.definitions.find((p:any)=>p.id===a.id);return !prev||digest(relevant(prev))!==digest(relevant(a));}).map((a:any)=>a.id));
 for(const p of data.rows){
  const bindings=standard.bindings.filter((b:any)=>b.categoryId===p.categoryId);
  const changed=bindings.filter((b:any)=>{const previous=old.bindings.find((x:any)=>x.categoryId===b.categoryId&&x.attributeId===b.attributeId);return definitionChanges.has(b.attributeId)||!previous||digest(previous)!==digest(b);}).map((b:any)=>b.attributeId);
  records.push({batch,key:p.key,productId:p.id,categoryId:p.categoryId,categoryName:p.categoryName,title:p.title,previousCategoryStatus:p.category.status,changedAttributeIds:changed,reason:'新版本三值条件及证据授信契约适用；必须重新评估，不直接搬用旧填充率',status:'pending_revalidation',originalResultHash:digest(p),newStandardHash:digest(standard),ratePolicy:p.category.status==='matched'?'按新卡独立重算':'先复核归属，未确认前排除原类分母'});
 }
}
await save(join(run,'regression-plan.json'),{status:'planned-not-executed',standardHash:digest(standard),historicalBatches:batches,records,summary:{records:records.length,uniqueProducts:new Set(records.map(x=>x.productId)).size,categories:new Set(records.map(x=>x.categoryId)).size},rules:['逐来源保存旧结果；相同SKU跨批不重复算新批商品数','本清单不是重新填写结果；不据此报告新填充率','本轮21类尚未完成运营随机抽检及线上验收']});
console.log({records:records.length,categories:new Set(records.map(x=>x.categoryId)).size});
