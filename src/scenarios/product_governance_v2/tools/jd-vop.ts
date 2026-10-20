import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {read,save,exists,hash,now} from '../runtime/store.ts';

/** Text only. Image tags, attributes (including alt), scripts and styles are not evidence. */
export function productText(value:any):string{
 return (typeof value==='string'?value:JSON.stringify(value))
  .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,' ')
  .replace(/<img\b[^>]*>/gi,' ')
  .replace(/<[^>]+>/g,' ')
  .replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
  .replace(/\s+/g,' ').trim();
}
export class JdVopTools{
 private sdk:any;
 constructor(private run:string){}
 async init(){
  // Reuse the existing read-only SDK and its owned token refresh/signing boundary.
  const env=await readFile('/Users/sanheng/Project/sanheng/ai-core/.env','utf8');
  for(const line of env.split('\n')){
   const m=line.match(/^(JD_VOP_APP_KEY|JD_VOP_APP_SECRET|JD_VOP_TIME_OFFSET)\s*=\s*(.*)$/);
   if(m&&!process.env[m[1]!])process.env[m[1]!]=m[2]!.trim().replace(/^(['"])(.*)\1$/,'$2');
  }
  if(!process.env.JD_VOP_APP_KEY||!process.env.JD_VOP_APP_SECRET)throw Error('JD VOP config missing');
  for(const k of ['NO_PROXY','no_proxy'])process.env[k]=[process.env[k],'jdlink.sanheng.com','api.jd.com'].filter(Boolean).join(',');
  const sdkPath=process.env.PRODUCT_GOV_JD_SDK??'/Users/sanheng/Project/sanheng/ai-core/src/lib/jd-vop/goods/index.ts';
  this.sdk=await import(sdkPath);
 }
 private async cached(method:string,input:any,call:()=>Promise<any>){
  const file=join(this.run,'trial/jd-cache',hash({method,input})+'.json');
  if(await exists(file))return read(file);
  let result:any;
  try{result={method,input,status:'ok',data:await call(),fetchedAt:now()};}
  catch{result={method,input,status:'error',message:'京东VOP请求失败；未视为无参数，不自动重复请求。',fetchedAt:now()};}
  await save(file,result);return result;
 }
 detail(skuId:string){
  if(!/^\d+$/.test(skuId))throw Error('invalid JD sku');
  return this.cached('getSkuDetailInfo',{skuId},async()=>{
   const raw=await this.sdk.getSkuDetailInfo({skuId,queryExtSet:[1,2,3,5,6,9,10,11]});
   const d=Array.isArray(raw)?raw.find((x:any)=>String(x.skuId)===skuId):raw;
   if(!d||String(d.skuId)!==skuId)throw Error('detail SKU mismatch');
   // Intentionally omit images and all non-product fields from persisted supplementary data.
   return Object.fromEntries(['skuId','skuName','brandName','seoModel','wareInfo','categoryAttrList','paramGroupAttrList','specificParam','saleUnit','color','size','category'].filter(k=>d[k]!==undefined).map(k=>[k,d[k]]));
  });
 }
 search(keyword:string){
  if(!keyword.trim()||keyword.length>160)throw Error('invalid keyword');
  return this.cached('searchSku',{keyword},async()=>{
   const r=await this.sdk.searchSku({keyword,pageIndex:1,pageSize:5,needMergeSku:0});
   return (r.skuHitResultPaging?.items??[]).map((p:any)=>({skuId:String(p.skuId),skuName:p.skuName,brandName:p.brandName,categoryName3:p.categoryName3}));
  });
 }
}
export function jdEvidence(receipt:any){
 if(receipt.status!=='ok')return [];
 const d=receipt.data,sku=String(d.skuId);
 return Object.entries(d).filter(([k])=>k!=='skuId').map(([k,v])=>({id:`jd:${sku}:${k}`,field:k,text:productText(v),
  source:'京东VOP同品补充',sourceRef:`https://item.jd.com/${sku}.html#${k}`,fetchedAt:receipt.fetchedAt,skuId:sku})).filter(e=>e.text);
}
