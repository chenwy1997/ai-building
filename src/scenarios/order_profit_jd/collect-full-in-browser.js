// Paste into the authenticated report tab console. Read-only, resumable IndexedDB checkpoints.
void (async () => {
  if (window.__fullCollectorRunning) return console.log('FULL_ALREADY_RUNNING');
  window.__fullCollectorRunning = true;
  const req = r => new Promise((a,b) => { r.onsuccess=()=>a(r.result);r.onerror=()=>b(r.error); });
  const db = window.__profitDb;
  if (!db) throw Error('Open existing collection database first');
  const get = (s,k) => req(db.transaction(s).objectStore(s).get(k));
  const all = s => req(db.transaction(s).objectStore(s).getAll());
  const put = (s,k,v) => new Promise((a,b)=>{const t=db.transaction(s,'readwrite');t.objectStore(s).put(v,k);t.oncomplete=a;t.onerror=()=>b(t.error);});
  const post = async(url,body) => {for(let n=0;;n++){try{const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});if(!r.ok)throw Error('HTTP '+r.status);return await r.json();}catch(e){if(n>=3||/401|403/.test(String(e)))throw e;await new Promise(a=>setTimeout(a,2000*(n+1)));}}};
  const parallel = async(items,n,fn) => {let i=0;await Promise.all(Array.from({length:n},async()=>{while(i<items.length)await fn(items[i++]);}));};
  const st = await get('meta','full') || {startedAt:new Date().toISOString(),phase:'orders'};
  window.__fullStatus=st;
  try {
    const previous=await get('meta','orders');
    const count=previous.initialCount;
    st.initialCount=count;
    const keys=await req(db.transaction('pages').objectStore('pages').getAllKeys());
    const missing=Array.from({length:Math.ceil(count/1000)},(_,i)=>i+1).filter(p=>!keys.includes(p));
    st.pagesDone=keys.length;st.pagesTotal=Math.ceil(count/1000);
    const fields=['orderItemRealTimeId','storeOrderNo','orderStatus','productSku','productName','specName','quantity','unitPrice','totalPrice','purchaseUnitPrice','purchaseTotalCostPrice','profit','profitRate','submittedAt'];
    await parallel(missing,4,async page=>{
      const d=await post('/manage/report/order-item-profit/api/getList',{page,pageSize:1000,orderStatus:['ALL_SHIPPED','FINISHED']});
      if(!Array.isArray(d.list))throw Error('Invalid order page '+page);
      st.lastCount=d.count;
      await put('pages',page,d.list.map(x=>Object.fromEntries(fields.map(k=>[k,x[k]]))));
      st.pagesDone++;await put('meta','full',st);
      if(st.pagesDone%10===0)console.log('FULL_PAGES',st.pagesDone,st.pagesTotal);
    });
    const rows=[...new Map((await all('pages')).flat().map(r=>[r.orderItemRealTimeId,r])).values()];
    st.rows=rows.length;
    const ids=[...new Set(rows.map(r=>r.productSku))];st.uniqueSkus=ids.length;
    const skip=new Set(previous.skipSkus||[]);
    const done=new Set(await req(db.transaction('sku').objectStore('sku').getAllKeys()));
    const targets=ids.filter(id=>!skip.has(id)&&!done.has(id));
    st.phase='details';st.reusedSkus=ids.filter(id=>skip.has(id)).length;st.detailsDone=done.size;st.detailsTotal=ids.length-st.reusedSkus;
    const groups=[];for(let i=0;i<targets.length;i+=100)groups.push(targets.slice(i,i+100));
    const wanted=new Set(['sourceUrl','compareUrl','specTitle','mergedSpecName','saleUnit','specUnits','sku_unit_text','SPEC_UNITS','detailedSpecTable']);
    await parallel(groups,2,async batch=>{
      const d=await post('/manage/product/api/findMany',{earningsRateMin:null,earningsRateMax:null,searchKeyWords:'',tag:'',bucket:'source',venderId:'',venderProductApprovalStatus:'COMFIRMED',page:1,pageSize:100,blacklistOfCategoryIds:[],upstreamIds:[],upstreamList:[],creatorId:'',rangeType:'createdAt',submitTimeRange:null,hasVendor:null,vendorIds:[],materialCodeList:[],skuCodeList:batch,hasTargetCustomer:false,targetCustomerIds:[]});
      const x=d.items;if(!Array.isArray(x?.propertyValueInstances))throw Error('Invalid metadata');
      const props=new Map(x.inheritPropertyInstances.map(p=>[p.id,p]));
      const values=new Map(x.propertyValueInstances.map(v=>[v.id,v]));
      const relations=new Map();for(const r of x.propertyValueInstanceOnProductInstances)relations.set(r.productInstanceId,[...(relations.get(r.productInstanceId)||[]),r]);
      const found=new Map();
      for(const p of [...(x.productInstances||[]),...(x.childrenProductInstances||[])]){
        const id=String(p.productId).split('-')[0];if(!batch.includes(id))continue;
        const m=found.get(id)||{localSku:id,productId:p.productId,fields:{},evidence:[]};
        for(const r of relations.get(p.id)||[]){const v=values.get(r.propertyValueInstanceId),prop=props.get(v?.propertyInstanceId);if(!prop)continue;const value=v.stringValue??v.numberValue??v.optionValue;if(value==null||typeof value==='object')continue;for(const k of [prop.sourceKey,prop.key])if(wanted.has(k))m.fields[k]=String(value).slice(0,5000);if(['sourceUrl','compareUrl'].includes(prop.sourceKey||prop.key))m.evidence.push({key:prop.sourceKey||prop.key,value,productInstanceId:p.id,propertyValueInstanceId:v.id});}
        found.set(id,m);
      }
      for(const id of batch)await put('sku',id,found.get(id)||{localSku:id,missing:true,fields:{},evidence:[]});
      st.detailsDone+=batch.length;await put('meta','full',st);
      if(st.detailsDone%1000===0)console.log('FULL_DETAILS',st.detailsDone,st.detailsTotal);
    });
    st.phase='complete';st.finishedAt=new Date().toISOString();await put('meta','full',st);
    const payload={...st,scope:'full_default_order_ALL_SHIPPED_FINISHED',count:st.lastCount,rows,normalizedMetadata:await all('sku'),batches:[]};
    const u=URL.createObjectURL(new Blob([JSON.stringify(payload)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download='order-profit-full-source-20261015.json';a.click();
    console.log('FULL_SOURCE_COMPLETE',JSON.stringify(st));
  }catch(e){st.error=String(e);st.failedAt=new Date().toISOString();await put('meta','full',st);console.log('FULL_SOURCE_ERROR',JSON.stringify(st));}
  finally{window.__fullCollectorRunning=false;}
})();
