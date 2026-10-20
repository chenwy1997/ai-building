import {join,resolve} from 'node:path';
import {read,save,pool} from '../runtime/store.ts';
import {trialRuntime} from './runtime.ts';
import {screenSchema} from './contracts.ts';
const run=resolve(process.argv[2]!),rt=await trialRuntime(run),products=await read(join(run,'trial/products.json'));
const batches=Array.from({length:Math.ceil(products.length/15)},(_,i)=>products.slice(i*15,i*15+15));
const decisions:any[]=[];
const result=await pool(batches,async(group:any[])=>{
 const index=batches.indexOf(group);
 const r=await rt.call(`screen/${index}.json`,'trial_category_screen',{
  task:'仅根据当前商品标题、规格、品牌等文本复核是否符合挂载类目。对错挂给出候选V2已有末级ID；没有可靠目标则targetId留空并说明缺类目/信息/边界。纸巾本体、铝箔盘、纸杯不是纸巾盒；商用擦手纸分配器/卷纸筒按配件边界分开。不要因出现纸巾盒三个字自动通过。每个商品恰好一条。',
  cards:Object.values(rt.cards).map((c:any)=>({categoryId:c.categoryId,boundary:c.boundary})),candidates:rt.candidates,
  products:group.map(p=>({productId:p.id,categoryId:p.categoryId,title:p.title,saleSpec:p.saleSpec,brand:p.brand,evidence:p.evidence,detailStatusConflicts:p.detailStatusConflicts}))},screenSchema,7500);
 if(r.products.length!==group.length||new Set(r.products.map((x:any)=>x.productId)).size!==group.length)throw Error('screen coverage');
 for(const d of r.products){
  const p=group.find(p=>p.id===d.productId);if(!p)throw Error('unknown product');
  if(d.targetId&&!rt.candidates.some((c:any)=>c.id===d.targetId))throw Error('invalid target');
  if(p.detailStatusConflicts.length){d.status='uncertain';d.reason='详情在售状态冲突；'+d.reason;}
 }
 decisions.push(...r.products);console.log(JSON.stringify({batch:index,counts:r.products.reduce((a:any,d:any)=>(a[d.status]=(a[d.status]??0)+1,a),{})}));
},{initial:6,max:6,auto:false});
if(result.errors.length)throw Error(JSON.stringify(result.errors));
await save(join(run,'trial/screen-decisions.json'),products.map((p:any)=>decisions.find(d=>d.productId===p.id)));
