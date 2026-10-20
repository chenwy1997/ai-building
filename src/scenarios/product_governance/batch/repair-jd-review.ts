import {join,resolve} from 'node:path';
import {read,save} from '../runtime/storage.ts';
import {callModel} from '../adapters/models.ts';
const dir=resolve(import.meta.dir,'../../../../outputs/product-governance/three-category-20261019');
const base:any=await read(join(dir,'batches/jd-review-03.input.json'));
const config:any=await read(join(import.meta.dir,'config.json'));
// 原14件超时后，仅两次有边界的7件重试；原始失败记录和账本均不覆盖。
const model={...config.models.find((m:any)=>m.id==='kimi'),maxCalls:22};
await Promise.all([0,1].map(async i=>{
 const stage='jd-review-03-repair-'+(i+1),payload={...base,products:base.products.slice(i*7,(i+1)*7)};
 await save(join(dir,'batches',stage+'.input.json'),payload);
 const r=await callModel(dir,stage,model,payload);console.log(stage,r.status,r.error??'');
}));
