// Run in the authenticated sc.sanheng.com report tab's DevTools Console.
// Read-only collection. No cookies/tokens are copied into the downloaded file.
(async () => {
  const limit = 1000;
  const state = { startedAt: new Date().toISOString(), limit, rows: [], batches: [], errors: [], phase: 'orders', count: null };
  window.__profitBatch = state;
  const post = async (url, body) => {
    const r = await fetch(url, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
    return r.json();
  };
  const pick = (x, keys) => Object.fromEntries(keys.filter(k => x[k] !== undefined).map(k => [k, x[k]]));
  try {
    const seen = new Set();
    for (let page=1; state.rows.length < limit; page++) {
      const data = await post('/manage/report/order-item-profit/api/getList', { page, pageSize:100, orderStatus:['ALL_SHIPPED','FINISHED'] });
      if (!Array.isArray(data.list)) throw new Error('Invalid order list');
      state.count = data.count;
      if (!data.list.length) break;
      for (const row of data.list) if (!seen.has(row.orderItemRealTimeId) && state.rows.length < limit) { seen.add(row.orderItemRealTimeId); state.rows.push(row); }
      if (page * 100 >= data.count) break;
    }
    const ids = [...new Set(state.rows.map(r => r.productSku))]; state.uniqueSkus = ids.length;
    state.phase = 'details';
    for (let i=0; i<ids.length; i+=100) {
      const requestedSkus = ids.slice(i,i+100);
      const data = await post('/manage/product/api/findMany', {
        earningsRateMin:null,earningsRateMax:null,searchKeyWords:'',tag:'',bucket:'source',venderId:'',venderProductApprovalStatus:'COMFIRMED',
        page:1,pageSize:100,blacklistOfCategoryIds:[],upstreamIds:[],upstreamList:[],creatorId:'',rangeType:'createdAt',submitTimeRange:null,
        hasVendor:null,vendorIds:[],materialCodeList:[],skuCodeList:requestedSkus,hasTargetCustomer:false,targetCustomerIds:[],
      });
      const x = data.items;
      if (!x || !Array.isArray(x.propertyValueInstances)) throw new Error('Invalid product details');
      const instances = [...(x.productInstances??[]),...(x.childrenProductInstances??[])];
      state.batches.push({ requestedSkus, items: {
        products:(x.products??[]).map(p=>pick(p,['id','upstreamSku','upstreamSpu'])),
        productInstances:[...new Map(instances.map(p=>[p.id,pick(p,['id','productId','name','title','searchKeyWords'])])).values()],
        inheritPropertyInstances:x.inheritPropertyInstances.map(p=>pick(p,['id','key','sourceKey','title'])),
        propertyValueInstances:x.propertyValueInstances,
        propertyValueInstanceOnProductInstances:x.propertyValueInstanceOnProductInstances,
      }});
    }
    state.phase='complete'; state.finishedAt=new Date().toISOString();
  } catch(e) { state.phase='error'; state.errors.push(String(e)); }
  const blob = new Blob([JSON.stringify(state)],{type:'application/json'});
  const url=URL.createObjectURL(blob), a=document.createElement('a'); a.href=url; a.download='order-profit-batch-source.json'; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
  console.log({phase:state.phase,rows:state.rows.length,uniqueSkus:state.uniqueSkus,batches:state.batches.length,errors:state.errors});
})();
