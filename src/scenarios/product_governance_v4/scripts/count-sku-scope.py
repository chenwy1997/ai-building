#!/usr/bin/env python3
"""Exact read-only SKU/SPU inventory in a real category subtree, using one ES PIT.

Only identifier and category fields are retrieved; no product descriptions or credentials
are written. Previous selection/result inputs distinguish category expansion from remaining
SKUs in previously sampled categories. No collection/model/write phase is triggered.
"""
import argparse, base64, hashlib, importlib.util, json, os, sys, urllib.error, urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

FIELDS = ['productId', 'spuProductId', 'productInstanceId', 'categoryIds', 'categoryInstance.categoryId', 'categoryInstance.name', 'isHead']

def read(p): return json.loads(Path(p).read_text())
def digest(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def ref(p): return {'path': str(Path(p).resolve()), 'sha256': digest(p)}
def now(): return datetime.now(timezone.utc).isoformat()
def counts(rows):
    return {'documents': len(rows), 'skus': len({r['productId'] for r in rows if r.get('productId')}),
            'spus': len({r['spuProductId'] for r in rows if r.get('spuProductId')})}

def summarize(records, nodes, contract, selection, prior):
    attrs=defaultdict(list)
    for p in contract['proposals']: attrs[p['categoryId']].append(p)
    old_categories={c['category']['categoryId'] for c in selection['categories']}
    done={s['skuId'] for s in prior['skus']}
    by_category=defaultdict(list)
    for r in records: by_category[r['categoryId']].append(r)
    scoped=[r for r in records if r['categoryId'] in attrs]
    remaining=[r for r in scoped if r['productId'] not in done]
    other=[r for r in remaining if r['categoryId'] not in old_categories]
    old_remaining=[r for r in remaining if r['categoryId'] in old_categories]
    categories=[]
    for cat in sorted(set(attrs)|set(by_category),key=lambda value:str(value)):
        rows=by_category[cat]; node=nodes.get(cat,{})
        todo=[r for r in rows if r['productId'] not in done]
        categories.append({'categoryId':cat,'path':node.get('path'), 'isLeaf':node.get('isLeaf'),
          'enabled':node.get('enabled'), 'observedNames':sorted({r['categoryName'] for r in rows if r.get('categoryName')}),
          'hasAttributeContract':cat in attrs, 'attributeCount':len(attrs.get(cat,[])), 'previousPilotCategory':cat in old_categories,
          **counts(rows),'previousSamplePresent':len({r['productId'] for r in rows if r['productId'] in done}),
          'remainingSkus':len({r['productId'] for r in todo}), 'remainingAttributePositions':len({r['productId'] for r in todo})*len(attrs.get(cat,[]))})
    by_group=defaultdict(list)
    for r in other:
        path=nodes.get(r['categoryId'],{}).get('path','未映射')
        by_group[path.split('>')[1] if '>' in path else path].append(r)
    docs_by_sku=defaultdict(list)
    for r in records: docs_by_sku[r.get('productId')].append(r)
    return {'allRoot':counts(records),'governedCategories':counts(scoped),'outsideAttributeContract':counts([r for r in records if r['categoryId'] not in attrs]),
      'allRemainingGoverned':counts(remaining),'otherCategoriesRemaining':counts(other),'previousCategoriesRemaining':counts(old_remaining),
      'priorSampleCount':len(done),'priorSampleStillInRoot':len(done & {r['productId'] for r in records}),
      'priorSampleOutsideCurrentRoot':sorted(done-{r['productId'] for r in records}),
      'governedCategoryCount':len(attrs),'otherCategoryCount':len(set(attrs)-old_categories),
      'otherCategoriesWithRemainingSkus':len({r['categoryId'] for r in other}),
      'otherAttributePositions':sum(c['remainingAttributePositions'] for c in categories if c['hasAttributeContract'] and not c['previousPilotCategory']),
      'groups':[{'name':g,**counts(rs),'categories':len({r['categoryId'] for r in rs})} for g,rs in sorted(by_group.items())],
      'categories':categories,'duplicateSkuDocumentGroups':[{'skuId':sku,'documents':len(rs),'categoryIds':sorted({r['categoryId'] for r in rs})} for sku,rs in docs_by_sku.items() if len(rs)>1],
      'missingSkuDocuments':sum(not r.get('productId') for r in records),'missingSpuDocuments':sum(not r.get('spuProductId') for r in records)}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for flag in ['root-id','tree','contract','prior-selection','prior-result','out']:p.add_argument('--'+flag,required=True)
    p.add_argument('--env-file',default='.env');p.add_argument('--fallback-env-file',default='/Users/sanheng/Project/sanheng/ai-core/.env')
    p.add_argument('--index',default='uece-prod-sc_current');p.add_argument('--execute',action='store_true')
    a=p.parse_args();tree=read(a.tree);nodes={n['id']:n for n in tree['oldNodes']}
    root=nodes.get(a.root_id)
    if not root or root.get('mallCategoryId')!=a.root_id or root.get('enabled') is not True:raise ValueError('real_enabled_root_required')
    contract,selection,prior=read(a.contract),read(a.prior_selection),read(a.prior_result)
    out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
    if (out/'scope-count.json').exists():raise ValueError('output_exists')
    query={'term':{'categoryIds':a.root_id}}
    preflight={'root':root,'query':query,'index':a.index,'sourceFields':FIELDS,'statusFilters':[], 'productionWrites':0,'modelRequests':0}
    print(json.dumps(preflight,ensure_ascii=False),flush=True)
    if not a.execute:return
    spec=importlib.util.spec_from_file_location('collector',Path(__file__).with_name('collect-sku-evidence.py'))
    lib=importlib.util.module_from_spec(spec);spec.loader.exec_module(lib)
    names=['ES_NODE','ES_USERNAME','ES_PASSWORD'];conf={k:os.environ.get(k,'') for k in names}
    for f in [a.env_file,a.fallback_env_file]:
        if Path(f).exists():
            for k,v in lib.load_vars(Path(f),set(names)).items():
                if not conf[k]:conf[k]=v
    if not all(conf.values()):raise ValueError('es_configuration_missing')
    auth='Basic '+base64.b64encode((conf['ES_USERNAME']+':'+conf['ES_PASSWORD']).encode()).decode()
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),lib.NoRedirect())
    def request(route,body=None,method='POST'):
        req=urllib.request.Request(conf['ES_NODE'].rstrip('/')+route,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json','Authorization':auth},method=method)
        with opener.open(req,timeout=45) as resp:raw=resp.read(20_000_001)
        if len(raw)>20_000_000:raise ValueError('response_too_large')
        data=json.loads(raw)
        if data.get('timed_out') or data.get('_shards',{}).get('failed',0):raise ValueError('partial_response')
        return data
    pit=request('/'+a.index+'/_pit?keep_alive=5m')['id'];started=now()
    records=[];pages=[];seen=set();after=None;total=None
    try:
        identity=request('/_search?allow_partial_search_results=false',{'size':10,'track_total_hits':True,'pit':{'id':pit,'keep_alive':'5m'},'query':{'term':{'categoryInstance.categoryId':a.root_id}},'_source':['categoryInstance.categoryId','categoryInstance.name','categoryIds']})
        pit=identity.get('pit_id',pit)
        identity_rows=[h['_source'] for h in identity['hits']['hits']]
        for r in identity_rows:
            if r.get('categoryInstance',{}).get('name')!=root['path'].split('>')[-1]:raise ValueError('root_identity_mismatch')
        while True:
            body={'size':2000,'track_total_hits':True,'pit':{'id':pit,'keep_alive':'5m'},'query':query,'_source':FIELDS,'sort':[{'_shard_doc':'asc'}]}
            if after is not None:body['search_after']=after
            data=request('/_search?allow_partial_search_results=false',body);pit=data.get('pit_id',pit);hits=data['hits']
            if hits['total']['relation']!='eq':raise ValueError('inexact_total')
            if total is None:total=hits['total']['value']
            if total!=hits['total']['value']:raise ValueError('snapshot_total_changed')
            for h in hits['hits']:
                k=(h['_index'],h['_id'])
                if k in seen:raise ValueError('duplicate_document_page')
                seen.add(k);s=h['_source']
                if a.root_id not in s.get('categoryIds',[]):raise ValueError('scope_mismatch')
                records.append({**{f:s.get(f) for f in ['productId','spuProductId','productInstanceId','isHead']},'categoryId':s.get('categoryInstance',{}).get('categoryId'),'categoryName':s.get('categoryInstance',{}).get('name')})
            pages.append({'documents':len(hits['hits']),'tookMs':data.get('took')})
            print(json.dumps({'event':'count_progress','documents':len(records),'total':total}),flush=True)
            if not hits['hits'] or len(records)==total:break
            next_after=hits['hits'][-1]['sort']
            if after==next_after:raise ValueError('cursor_not_advanced')
            after=next_after
        if len(records)!=total:raise ValueError('incomplete_inventory')
        report={**preflight,'capturedAt':started,'completedAt':now(),'method':'single_PIT_identifier_scan_and_exact_sets','identityReadback':identity_rows,'pages':pages,
          'inputs':{k:ref(v) for k,v in [('tree',a.tree),('contract',a.contract),('priorSelection',a.prior_selection),('priorResult',a.prior_result)]},
          **summarize(records,nodes,contract,selection,prior),'notes':['按真实类目子树的当前ES索引统计，未筛上下架/启用，不等于可售数','SKU按productId、SPU按spuProductId精确去重；不同分组SPU不能直接相加','其他类目指排除原抽样9类（实际数量从输入读取），并排除已处理SKU；原类目有样本不代表全类做完']}
        for name,value in [('inventory.json',{'capturedAt':started,'rootCategoryId':a.root_id,'records':records}),('scope-count.json',report)]:
            with (out/name).open('x') as f:json.dump(value,f,ensure_ascii=False,indent=2);f.write('\n')
        print(json.dumps({k:report[k] for k in ['allRoot','otherCategoriesRemaining','previousCategoriesRemaining','outsideAttributeContract','otherCategoriesWithRemainingSkus','otherAttributePositions','groups']},ensure_ascii=False),flush=True)
    finally:request('/_pit',{'id':pit},'DELETE')

if __name__=='__main__':
    try:main()
    except urllib.error.HTTPError as e:print(json.dumps({'error':'ES_HTTP','status':e.code}));sys.exit(1)
    except Exception as e:print(json.dumps({'error':type(e).__name__,'detail':'Read-only scope count failed; credentials/provider body omitted.'}));sys.exit(1)
