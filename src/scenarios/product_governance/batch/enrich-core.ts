import {join,resolve} from 'node:path';
import {readdir} from 'node:fs/promises';
import {read,save} from '../runtime/storage.ts';
// 外部项目适配边界：不把ai-core全项目纳入本场景的类型检查；调用方只使用已核对的只读方法。
const jdSdkPath=process.env.PRODUCT_GOV_JD_SDK??'/Users/sanheng/Project/sanheng/ai-core/src/lib/jd-vop/goods/index.ts';
const {getSkuDetailInfo}=await import(jdSdkPath);
const root=resolve(import.meta.dir,'../../../..'),dir=join(root,'outputs/product-governance/three-category-20261019');
for(const name of ['NO_PROXY','no_proxy'])process.env[name]=[process.env[name],'jdlink.sanheng.com','api.jd.com'].filter(Boolean).join(',');
const attempt=process.argv[2]??'r2',folder='jd-core-'+attempt;
const standard:any=await read(join(dir,'design/standard.json')),products:any[]=await read(join(dir,'inputs/model-products.json'));
const results=new Map<string,any>();
for(const f of (await readdir(join(dir,'models'))).filter(f=>/^fill-.*-deepseek.json$/.test(f)).sort((a,b)=>Number(a.includes('-repair-'))-Number(b.includes('-repair-')))){
 const r:any=await read(join(dir,'models',f));for(const p of r.content?.products??[])results.set(p.key,p);
}
const explicitKeys=process.argv[3]?.split(',').filter(Boolean);
const selected=products.filter(p=>explicitKeys?explicitKeys.includes(p.key):(()=>{const r=results.get(p.key);return r?.category?.status==='matched'&&standard.bindings.some((b:any)=>b.categoryId===p.categoryId&&b.required&&(!r.values?.[b.attributeId]?.length||r.values[b.attributeId][1]==='I'));})());
if(explicitKeys&&selected.length!==new Set(explicitKeys).size)throw new Error('显式补证清单包含未知或重复键');
await save(join(dir,'inputs',explicitKeys?folder+'-selection.json':'jd-core-selection.json'),{reason:explicitKeys?'Codex终审发现包装形态/图片型号对应疑点，限定商品追加只读补证。':'仅为初填缺少核心必填证据或仅有OCR线索的商品补查上游；同品核对通过才可采用。',keys:selected.map(p=>p.key)});
let cursor=0;await Promise.all(Array.from({length:3},async()=>{while(cursor<selected.length){const p=selected[cursor++],path=join(dir,'inputs',folder,p.key+'.json');if(await Bun.file(path).exists())continue;
 try{const raw:any=await getSkuDetailInfo({skuId:p.upstreamSku,queryExtSet:[1,2,3,5,6,9,10,11]});const detail=Array.isArray(raw)?raw.find(d=>String(d.skuId)===String(p.upstreamSku)):raw;
 if(!detail||String(detail.skuId)!==String(p.upstreamSku))throw new Error('无同SKU返回');
 const kept=Object.fromEntries(['skuId','skuName','spuName','brandName','categoryAttrList','paramGroupAttrList','specificParam','wareInfo','seoModel','saleUnit','color','size','imagePath'].filter(k=>detail[k]!==undefined).map(k=>[k,detail[k]]));
 await save(path,{key:p.key,productId:p.id,upstreamSku:p.upstreamSku,status:'ok',fetchedAt:new Date().toISOString(),detail:kept,sameProductVerified:false});
 }catch(e){await save(path,{key:p.key,productId:p.id,status:'error',error:'京东VOP查询不可用或无同SKU响应；不以接口失败代替无属性',fetchedAt:new Date().toISOString()});}
}}));
const records=await Promise.all(selected.map(p=>read<any>(join(dir,'inputs',folder,p.key+'.json'))));
await save(join(dir,'inputs',folder+'-summary.json'),{selected:selected.length,ok:records.filter(r=>r.status==='ok').length,error:records.filter(r=>r.status==='error').length,records});
