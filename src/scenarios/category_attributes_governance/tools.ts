import {join} from 'node:path';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {loadGoodsApi} from '../category_governance/product_delivery/collect.ts';
import {extractFields} from '../category_governance/product_delivery/prepare.ts';
import {gunzipSync} from 'node:zlib';
import {ROOT,hash,read,optional,save} from './storage.ts';
import type {Evidence} from './types.ts';
const obj=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const str={type:'string'};
export const TOOLS=[
 {type:'function',function:{name:'jd_search',description:'关键词找商品候选，每页20个，至多100个。可改同义词/用途；不要把标题相似视为已匹配，先看整机/配件/包装。',parameters:obj({query:str,page:{type:'integer',minimum:1,maximum:5}})}},
 {type:'function',function:{name:'jd_detail',description:'仅取已搜索的SKU详情，先挑2~4个不同品牌/型号，再视证据缺口继续。reason说明属于目标类目的理由；返回参数仍需检查相关性。',parameters:obj({sku:str,reason:str})}},
 {type:'function',function:{name:'web_search',description:'搜索制造商/行业技术资料。没有配置Tavily时只检索本地已核验网络资料库，返回mode明确标记。结果只有摘要；优先调用web_read读取资料。',parameters:obj({query:str})}},
 {type:'function',function:{name:'web_read',description:'读取web_search返回的URL，禁止猜造URL。返回资料可以支持属性存在/定义，不能把单型号数值当封闭枚举。',parameters:obj({url:str})}},
];
export interface WebSeed {url:string;title:string;terms:string[];text:string;checkedAt:string}
export interface ToolOptions {direct:boolean;jdProject:string;jdConcurrency:number;maxCandidates:number;maxDetails:number;webKey?:string}
export class Gate{active=0;queue:Array<()=>void>=[];constructor(readonly max:number){}async run<T>(fn:()=>Promise<T>){if(this.active>=this.max)await new Promise<void>(r=>this.queue.push(r));else this.active++;try{return await fn();}finally{const next=this.queue.shift();if(next)next();else this.active--;}}}
export async function publicUrl(raw:string){const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443')throw new Error('只读取公开HTTPS网页');const host=u.hostname.replace(/^\[|\]$/g,'');if(isIP(host)||host==='localhost'||!host.includes('.')||/\.(local|internal)$/i.test(host))throw new Error('不读取本地地址');const addresses=await lookup(host,{all:true});if(!addresses.length||addresses.some(({address})=>/^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.|::|f[cd]|fe80)/i.test(address)))throw new Error('不读取私有地址');return u;}
async function webpage(url:string):Promise<string>{for(let i=0;i<4;i++){const u=await publicUrl(url);const response=await fetch(u,{redirect:'manual',signal:AbortSignal.timeout(20000)});if(response.status>=300&&response.status<400){const loc=response.headers.get('location');if(!loc)throw new Error('网页重定向缺失');url=new URL(loc,u).href;continue;}if(!response.ok)throw new Error(`网页HTTP ${response.status}`);if(!/text\/(html|plain)|application\/xhtml/i.test(response.headers.get('content-type')??''))throw new Error('当前读取器仅支持HTML/文本；PDF需先精炼为资料库');const reader=response.body!.getReader();let length=0,text='';const decoder=new TextDecoder();while(true){const r=await reader.read();if(r.done)break;length+=r.value.length;if(length>2_000_000){await reader.cancel();throw new Error('网页超出2MB读取上限');}text+=decoder.decode(r.value,{stream:true});}text+=decoder.decode();return text.replace(/<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();}throw new Error('网页重定向过多');}
export class Sources {
 readonly gate:Gate;readonly known=new Map<string,Record<string,unknown>>();readonly seeds:WebSeed[];readonly cachedDetails:Record<string,{status:string;detail?:Record<string,unknown>}>;
 api?:Awaited<ReturnType<typeof loadGoodsApi>>;jdDisabled?:string;searches=0;details=0;webRequests=0;cacheHits=0;
 private constructor(readonly options:ToolOptions,seeds:WebSeed[],details:Sources['cachedDetails']){this.gate=new Gate(options.jdConcurrency);this.seeds=seeds;this.cachedDetails=details;}
 static async create(options:ToolOptions){const p=join(import.meta.dir,'../category_governance/workspace/output/v1/product-delivery-v1/.repro/jd-details.json.gz');const old=await Bun.file(p).exists()?JSON.parse(gunzipSync(new Uint8Array(await Bun.file(p).arrayBuffer())).toString()):{items:{}};return new Sources(options,await read<WebSeed[]>(join(import.meta.dir,'knowledge/web-sources.json')),old.items);}
 async jd(){if(this.jdDisabled)throw new Error(this.jdDisabled);return this.api??=await loadGoodsApi(this.options.jdProject,this.options.direct);}
 async cache<T>(kind:string,args:unknown,fn:()=>Promise<T>):Promise<T>{const p=join(ROOT,'cache',kind,hash(args)+'.json');const old=await optional<T>(p);if(old!==undefined){this.cacheHits++;return old;}const value=await fn();await save(p,value);return value;}
 session(){return new SessionTools(this);}
}
export class SessionTools {
 readonly evidence=new Map<string,Evidence>();readonly candidates=new Map<string,Record<string,unknown>>();readonly urls=new Set<string>();candidateCount=0;detailCount=0;callCount=0;webCount=0;
 constructor(readonly sources:Sources){}
 async execute(name:string,args:Record<string,unknown>):Promise<unknown>{this.callCount++;if(this.callCount>18)throw new Error('本类目工具次数已达18次');
  if(name==='jd_search'){
   if(typeof args.query!=='string'||!args.query.trim()||args.query.length>120||!Number.isInteger(args.page)||Number(args.page)<1||Number(args.page)>5)throw new Error('搜索参数非法');
   if(this.candidateCount>=this.sources.options.maxCandidates)throw new Error('候选数达到上限');
   const request={keyword:args.query,pageIndex:args.page,pageSize:20,needMergeSku:0,extAttrCollect:1,priceCollect:0,useCacheStore:1,sortType:1};
   let raw:Record<string,unknown>;
   try{raw=await this.sources.cache('jd-search',request,()=>this.sources.gate.run(async()=>{this.sources.searches++;try{return await (await this.sources.jd()).searchSku(request);}catch(e){const msg=String(e);if(/白名单|IP.*(限制|非法|允许)|not.*whitelist/i.test(msg))this.sources.jdDisabled='京东IP白名单限制；当前环境无法访问';throw e;}}));}catch(e){return{mode:'unavailable',error:this.sources.jdDisabled??String(e).slice(0,300),items:[]};}
   const items=((raw.skuHitResultPaging as {items?:Record<string,unknown>[]})?.items??[]).filter(x=>x.skuId).slice(0,this.sources.options.maxCandidates-this.candidateCount).map(x=>({sku:String(x.skuId),title:x.skuName,brand:x.brandName,path:[x.categoryName1,x.categoryName2,x.categoryName3].filter(Boolean)}));
   this.candidateCount+=items.length;for(const i of items)this.candidates.set(i.sku,i);return{mode:'jd',items,candidatesRemaining:this.sources.options.maxCandidates-this.candidateCount};
  }
  if(name==='jd_detail'){
   const sku=String(args.sku??'');if(!this.candidates.has(sku)||typeof args.reason!=='string'||!args.reason.trim())throw new Error('必须选择本次搜索过的SKU并说明匹配理由');
   if(this.detailCount>=this.sources.options.maxDetails)throw new Error('本类目详情预算已用完');this.detailCount++;
   const raw=await this.sources.cache<Record<string,unknown>>('jd-detail',{sku,ext:[1,2,3,5,6,9,10,11]},async()=>{const old=this.sources.cachedDetails[sku];if(old?.status==='ok'&&old.detail){this.sources.cacheHits++;return old.detail;}return this.sources.gate.run(async()=>{this.sources.details++;const r=await (await this.sources.jd()).getSkuDetailInfo({skuId:sku,queryExtSet:[1,2,3,5,6,9,10,11]});const d=Array.isArray(r)?r.find(d=>String(d.skuId)===sku):r;if(!d||String(d.skuId)!==sku)throw new Error('SKU不匹配或空详情');return d;});});
   if(String(raw.skuId)!==sku)throw new Error('缓存SKU不匹配');const id='J'+hash(raw).slice(0,12),fields=extractFields(raw);
   const e:Evidence={id,kind:'jd',sku,title:String(raw.skuName??this.candidates.get(sku)?.title??''),url:`https://item.jd.com/${sku}.html`,retrievedAt:new Date().toISOString(),scope:args.reason,fields:fields.filter(f=>f.value.length<=1200).slice(0,100).map((f,i)=>[`${id}.${i}`,f.name,f.value,f.source])};
   this.evidence.set(id,e);return{...e,retrievedAt:undefined};
  }
  if(name==='web_search'){
   if(typeof args.query!=='string'||!args.query.trim()||args.query.length>200)throw new Error('网络搜索参数非法');if(++this.webCount>4)throw new Error('本类目网络搜索达到4次上限');
   const q=args.query.toLowerCase();const local=this.sources.seeds.map(s=>({s,score:s.terms.filter(t=>q.includes(t.toLowerCase())).length})).filter(x=>x.score).sort((a,b)=>b.score-a.score).slice(0,5).map(({s})=>({url:s.url,title:s.title,summary:s.text.slice(0,500)}));
   let items=local,mode='local-verified-library';if(this.sources.options.webKey){mode='tavily';items=await this.sources.cache('web-search',{query:q},async()=>{this.sources.webRequests++;const r=await fetch('https://api.tavily.com/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({api_key:this.sources.options.webKey,query:args.query,search_depth:'basic',max_results:5,include_raw_content:false}),signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error(`搜索HTTP ${r.status}`);const data=await r.json() as {results:Array<{url:string;title:string;content:string}>};return data.results.map(x=>({url:x.url,title:x.title,summary:x.content.slice(0,700)}));});}
   for(const i of items)this.urls.add(i.url);return{mode,items,note:mode==='tavily'?'搜索摘要需读取正文确认':'仅本地已核验资料；没有公网搜索Key，不宣称搜索整个网络'};
  }
  if(name==='web_read'){
   if(typeof args.url!=='string'||!this.urls.has(args.url))throw new Error('仅可读取本次搜索返回的URL');
   const seed=this.sources.seeds.find(s=>s.url===args.url);const content=seed?.text??await this.sources.cache('web-page',{url:args.url},async()=>{this.sources.webRequests++;return webpage(String(args.url));});
   const id='W'+hash([args.url,content]).slice(0,12),limit=content.slice(0,10000);const e:Evidence={id,kind:'web',title:seed?.title??args.url,url:args.url,retrievedAt:seed?.checkedAt??new Date().toISOString(),scope:'来源正文/已核验摘要，适用性需模型判断',fields:[[id+'.0','技术资料',limit]]};this.evidence.set(id,e);return{...e,retrievedAt:undefined,truncated:content.length>limit.length};
  }
  throw new Error('未注册工具');
 }
}
