import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Read-only, configuration-driven collector. Category rules belong to profiles.json.
const execute = process.argv.includes('--execute');
const flags = Object.fromEntries(process.argv.slice(2).filter(v=>v!=='--execute').reduce<string[][]>((a,v,i,all)=> {
  if (i%2===0) { if(!v.startsWith('--') || !all[i+1]) throw Error('expected --flag value'); a.push([v.slice(2),all[i+1]!]); } return a;
},[]));
const out=path.resolve(flags.out??path.dirname(new URL(import.meta.url).pathname));
const phase=flags.phase??'search', concurrency=Number(flags.concurrency??6), cap=Number(flags.limit??60);
if(!['search','details'].includes(phase)||!Number.isInteger(concurrency)||concurrency<1||concurrency>32||!Number.isInteger(cap)||cap<1||cap>100)throw Error('invalid collector options');
const config=JSON.parse(await fs.readFile(path.join(out,'profiles.json'),'utf8'));
if(config.categories.some((c:any)=>c.sampleLimit!==undefined&&(!Number.isInteger(c.sampleLimit)||c.sampleLimit<1||c.sampleLimit>cap)))throw Error('profile sampleLimit must be between 1 and --limit');
if(!execute){console.log(JSON.stringify({preflight:true,out,phase,concurrency,limit:cap,categories:config.categories.length,productionWrites:0}));process.exit(0);}
const project=flags['jd-project']??'/Users/sanheng/Project/sanheng/ai-core';
const json=(x:unknown)=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?String(v):v,2);
for(const name of ['.env.local','.env']) {
  const body=await fs.readFile(path.join(project,name),'utf8').catch(()=> '');
  for(const line of body.split(/\r?\n/)) {
    const m=line.match(/^\s*(?:export\s+)?(JD_VOP_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if(m && process.env[m[1]!]===undefined)process.env[m[1]!]=m[2]!.replace(/^(['"])(.*)\1$/,'$2');
  }
}
if(!process.env.JD_VOP_APP_KEY||!process.env.JD_VOP_APP_SECRET)throw Error('VOP configuration unavailable');
for(const k of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'])delete process.env[k];
process.env.NO_PROXY='*';process.env.no_proxy='*';
const sdk=await import(path.join(project,'src/lib/jd-vop/goods/index.ts'));
await fs.mkdir(path.join(out,'receipts'),{recursive:true});
const inflight=new Map<string,Promise<any>>();
async function cached(method:string,request:any) {
  const key=createHash('sha256').update(json({method,request})).digest('hex').slice(0,20);
  const basename=method.split('.').at(-1)+'-'+key+'.json';
  const file=path.join(out,'receipts',basename);
  if(inflight.has(file))return inflight.get(file);
  const p=(async()=>{
    for(const dir of [out,...(config.cacheDirectories??[])]) {
      const existing=path.join(dir,'receipts',basename);
      try { const record=JSON.parse(await fs.readFile(existing,'utf8')); if(record.status==='ok' && json(record.request)===json(request))return {file:existing,record,cached:true}; }
      catch(e:any){if(e.code!=='ENOENT')throw e;}
    }
    let data;
    for(let attempt=1;attempt<=2;attempt++) {
      try{ data=method.endsWith('searchSku')?await sdk.searchSku(request):await sdk.getSkuDetailInfo(request);break; }
      catch {if(attempt===2)throw Error('VOP read failed after 2 attempts; credentials and provider error omitted'); await new Promise(r=>setTimeout(r,800));}
    }
    const record={method,request,fetchedAt:new Date().toISOString(),status:'ok',data};
    await fs.writeFile(file+'.tmp',json(record));await fs.rename(file+'.tmp',file);
    return {file,record,cached:false};
  })();
  inflight.set(file,p);return p;
}
async function parallel<T>(items:T[],fn:(x:T,i:number)=>Promise<any>) {
  let next=0;const results:any[]=new Array(items.length);
  await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{
    while(next<items.length){const i=next++;results[i]=await fn(items[i]!,i);}
  })); return results;
}
const catalogs=await Promise.all(config.catalogFiles.map(async(f:string)=>JSON.parse(await fs.readFile(f,'utf8'))));
const enabled=new Set(catalogs.flatMap(c=>c.matches.filter((x:any)=>x.enabled&&x.level===2).map((x:any)=>String(x.categoryId))));
if(phase==='search') {
  const results=await parallel(config.categories,async(c:any)=>{
    if(c.reusePilot)return {id:c.id,name:c.name,reusePilot:c.reusePilot,scope:c.scope,results:[],candidates:[]};
    const products=new Map<string,any>(),results=[];
    for(const q of c.searches) {
      if(!enabled.has(String(q.categoryId)))throw Error('search category not in enabled catalog: '+q.categoryId);
      for(let page=1;page<=(q.pages??1);page++) {
        const request={keyword:q.keyword,categoryId3:Number(q.categoryId),pageIndex:page,pageSize:50,needMergeSku:0,extAttrCollect:1,brandCollect:1,priceCollect:0,useCacheStore:1,sortType:1};
        try {
          const r=await cached('jingdong.vop.goods.searchSku',request),d=r.record.data;
          const items=d.skuHitResultPaging?.items??[];
          results.push({request,receipt:r.file,cached:r.cached,count:items.length,total:d.skuHitResultPaging?.pageItemTotal});
          for(const p of items) {
            const id=String(p.skuId),old=products.get(id);
            if(old)old.searchReceipts.push(r.file);else products.set(id,{...p,skuId:id,searchReceipts:[r.file]});
          }
          if(items.length<50)break;
        }catch {results.push({request,status:'error',error:'search_read_failed'});}
      }
    }
    const candidates=[...products.values()].map(p=>{
      const title=p.skuName??'';
      const included=(!c.include||new RegExp(c.include,'i').test(title))&&(!c.exclude||!new RegExp(c.exclude,'i').test(title));
      return {...p,screening:included?(c.scope==='uncertain'?'观察样本：范围待核':'匹配候选'):'排除：对象不符',eligible:included};
    });
    console.log(`[搜索完成] ${c.name} · ${candidates.length} SKU · 初筛 ${candidates.filter(p=>p.eligible).length}`);
    return {id:c.id,name:c.name,scope:c.scope,scopeNote:c.scopeNote,results,candidates};
  });
  await fs.writeFile(path.join(out,'search-manifest.json'),json({generatedAt:new Date().toISOString(),categories:results,deepseekRequests:0,productionWrites:0}));
} else {
  const search=JSON.parse(await fs.readFile(path.join(out,'search-manifest.json'),'utf8'));
  const cats=search.categories.map((c:any)=>{
    if(c.reusePilot)return {...c,selected:[]};
    const categoryCap=config.categories.find((x:any)=>x.id===c.id)?.sampleLimit??cap;
    const buckets=new Map<string,any[]>();
    for(const p of c.candidates.filter((p:any)=>p.eligible)) {
      const k=p.brandName||'未提供';if(!buckets.has(k))buckets.set(k,[]);buckets.get(k)!.push(p);
    }
    const selected:any[]=[],spus=new Set<string>();
    // Prefer distinct JD SPUs, rotate brands; no market-share inference.
    for(let pass=0;pass<2&&selected.length<categoryCap;pass++) {
      let changed=true;
      while(changed&&selected.length<categoryCap) {
        changed=false;
        for(const brand of [...buckets.keys()].sort()) {
          const bucket=buckets.get(brand)!;
          const i=bucket.findIndex(p=>pass===1||!spus.has(String(p.spuId||p.skuId)));
          if(i<0)continue;
          const p=bucket.splice(i,1)[0];selected.push(p);spus.add(String(p.spuId||p.skuId));changed=true;
          if(selected.length>=categoryCap)break;
        }
      }
    }
    return {...c,selected};
  });
  const unique=new Map<string,any>();
  for(const c of cats)for(const p of c.selected)unique.set(p.skuId,p);
  let done=0;
  const details=await parallel([...unique.values()],async(p:any)=>{
    try {
      const request={skuId:p.skuId,queryExtSet:[1,2,3,5,6,9,10,11]};
      const r=await cached('jingdong.vop.goods.getSkuDetailInfo',request);
      const d=Array.isArray(r.record.data)?r.record.data.find((x:any)=>String(x.skuId)===p.skuId):r.record.data;
      if(!d||String(d.skuId)!==p.skuId)throw Error('sku mismatch');
      if(++done%25===0||done===unique.size)console.log(`[详情] ${done}/${unique.size}`);
      return {skuId:p.skuId,receipt:r.file,cached:r.cached,status:'ok'};
    }catch {done++;return {skuId:p.skuId,status:'error',error:'detail_read_failed'};}
  });
  await fs.writeFile(path.join(out,'sampling-manifest.json'),json({generatedAt:new Date().toISOString(),cap,concurrency,categories:cats,details,deepseekRequests:0,productionWrites:0}));
  console.log(json({categories:cats.length,uniqueDetails:details.length,ok:details.filter(x=>x.status==='ok').length,failed:details.filter(x=>x.status!=='ok').length}));
}
