import {join} from 'node:path';
import {read,save} from '../runtime/storage.ts';
import {RUN,MODELS,COMMON_RULES} from './settings.ts';
import {invoke,covers} from './model-run.ts';

const mode=process.argv[2]??'fetch';
const selection:any=await read(join(RUN,'inputs/jd-selection.json'));
const products:any[]=await read(join(RUN,await Bun.file(join(RUN,'inputs/model-products.json')).exists()?'inputs/model-products.json':'inputs/products.json'));
const chosen=products.filter(p=>selection.keys.includes(p.key));
if(chosen.length!==new Set(selection.keys).size)throw new Error('补证键不存在或重复');
if(mode==='fetch'){
 // Credentials remain owned by ai-core; launch from that project with its existing env.
 for(const k of ['NO_PROXY','no_proxy'])process.env[k]=[process.env[k],'jdlink.sanheng.com','api.jd.com'].filter(Boolean).join(',');
 const sdk=process.env.PRODUCT_GOV_JD_SDK??'/Users/sanheng/Project/sanheng/ai-core/src/lib/jd-vop/goods/index.ts';
 const {getSkuDetailInfo}=await import(sdk);let next=0;
 await Promise.all(Array.from({length:3},async()=>{while(next<chosen.length){
  const p=chosen[next++],file=join(RUN,'inputs/jd',p.key+'.json');if(await Bun.file(file).exists())continue;
  try{
   if(!p.upstreamSku)throw new Error('no upstream sku');
   const raw:any=await getSkuDetailInfo({skuId:p.upstreamSku,queryExtSet:[1,2,3,5,6,9,10,11]});
   const detail=Array.isArray(raw)?raw.find(r=>String(r.skuId)===String(p.upstreamSku)):raw;
   if(!detail||String(detail.skuId)!==String(p.upstreamSku))throw new Error('no matching sku response');
   const kept=Object.fromEntries(['skuId','skuName','spuName','brandName','categoryAttrList','paramGroupAttrList','specificParam','wareInfo','seoModel','saleUnit','color','size','imagePath'].filter(k=>detail[k]!==undefined).map(k=>[k,detail[k]]));
   await save(file,{key:p.key,productId:p.id,upstreamSku:p.upstreamSku,status:'ok',fetchedAt:new Date().toISOString(),detail:kept,sameProductVerified:false});
  }catch{await save(file,{key:p.key,productId:p.id,status:'error',error:'京东VOP暂不可用或未返回对应SKU；未据此认定缺参数',fetchedAt:new Date().toISOString()});}
 }}));
 const records=await Promise.all(chosen.map(p=>read<any>(join(RUN,'inputs/jd',p.key+'.json'))));
 await save(join(RUN,'inputs/jd-summary.json'),{selected:chosen.length,ok:records.filter(r=>r.status==='ok').length,error:records.filter(r=>r.status==='error').length,records});
}else{
 const model=MODELS.find(m=>m.id===mode);if(!model)throw new Error('specify fetch/deepseek/kimi');
 const summary:any=await read(join(RUN,'inputs/jd-summary.json')),standard:any=await read(join(RUN,'design/standard.json'));
 const rows=summary.records.filter((r:any)=>r.status==='ok'),groups=Array.from({length:Math.ceil(rows.length/5)},(_,i)=>rows.slice(i*5,(i+1)*5));let next=0;const failed:any[]=[];
 await Promise.all(Array.from({length:3},async()=>{while(next<groups.length){const idx=next++,g=groups[idx];
  const ids=new Set(g.map((r:any)=>products.find(p=>p.key===r.key).categoryId));
  const bindings=standard.bindings.filter((b:any)=>ids.has(b.categoryId)),attributes=new Set(bindings.map((b:any)=>b.attributeId));
  const context={releaseId:standard.releaseId,categories:standard.categories,definitions:standard.definitions.filter((a:any)=>attributes.has(a.id)),bindings,broadCategoryAdmission:standard.broadCategoryAdmission,requirednessContract:standard.requirednessContract,requirementGroups:standard.requirementGroups.filter((x:any)=>ids.has(x.categoryId))};
  const payload={task:'独立审核京东VOP新增证据。先确认与当前销售SKU的品牌、型号、主体、包装一致，再提出有证据的属性补充和归属意见。不给其他模型答案。',standard:context,rules:COMMON_RULES,
   products:g.map((r:any)=>{const p=products.find(p=>p.key===r.key);return {key:p.key,categoryId:p.categoryId,upstreamSku:p.upstreamSku,evidence:p.evidence,jdText:JSON.stringify(r.detail),candidateCategories:p.candidateCategories};}),
   output:{products:[{key:'',sameProduct:{status:'matched|conflict|uncertain',reason:''},category:{status:'matched|wrong|uncertain',targetId:'',targetName:'',reason:''},values:{'attribute.id':['规范值','J','jdText精确片段']},conflicts:[],notes:[]}]}};
  const stage='jd-review-'+String(idx+1).padStart(2,'0');await save(join(RUN,'batches',stage+'.input.json'),payload);
  if(!await invoke(stage,model,payload,covers(g.map((p:any)=>p.key))))failed.push(stage);
 }}));
 await save(join(RUN,'models',mode+'-jd-status.json'),{expected:groups.length,failed});if(failed.length)process.exitCode=1;
}
