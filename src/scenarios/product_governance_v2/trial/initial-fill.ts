import {join,resolve} from 'node:path';
import {read,save,exists} from '../runtime/store.ts';
import {groupedPending,trialConcurrency} from '../runtime/grouped.ts';
import {trialRuntime} from './runtime.ts';
import {fillSchema} from './contracts.ts';
const run=resolve(process.argv[2]!),rt=await trialRuntime(run),selected=await read(join(run,'trial/selected-products.json'));
const screen=await read(join(run,'trial/screen-final.json'));
const out=await groupedPending(selected.filter((p:any)=>screen.find((d:any)=>d.productId===p.id).status==='matched'),(p:any)=>p.categoryId,
 (p:any)=>exists(join(run,'trial/initial',p.id+'.json')),async(p:any)=>{
 const result=await rt.call(`initial/${p.id}.json`,'trial_initial_fill',{
  task:'按当前属性卡逐项试填，每个属性恰好一条，不改属性卡。仅当前商品evidence可作填写依据；不能用卡的外部模板、合成例子或同类商品代填。表面工艺、香型、材质未明示留空；棉/原木系列名不能推导原料。每条引用逐字原文。计算必须给独立输入与简短公式。全部字段必须覆盖，包括缺证、不适用与条件待确认。',
  product:{id:p.id,title:p.title,saleSpec:p.saleSpec,brand:p.brand,categoryId:p.categoryId},evidence:p.evidence,
  card:{...rt.cards[p.categoryId],provenance:undefined},candidates:rt.candidates},fillSchema,10500);
 const ids=rt.cards[p.categoryId].attributes.map((a:any)=>a.id);
 if(result.productId!==p.id||result.values.length!==ids.length||new Set(result.values.map((v:any)=>v.attributeId)).size!==ids.length||result.values.some((v:any)=>!ids.includes(v.attributeId)))throw Error('fill coverage '+p.id);
 console.log(JSON.stringify({id:p.id.slice(0,8),filled:result.values.filter((v:any)=>v.status==='filled').length,total:ids.length}));
},trialConcurrency());
await save(join(run,'trial/initial-v3-status.json'),out);if(out.errors.length)throw Error(JSON.stringify(out.errors));
