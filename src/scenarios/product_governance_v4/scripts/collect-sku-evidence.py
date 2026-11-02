#!/usr/bin/env python3
"""Read-only ES and supply-chain collection for a frozen SKU pilot.

No network operation occurs without --execute. No management API, image interpretation,
model request, or production write is performed. The ES source is strictly projected.
"""
import argparse
import base64
import concurrent.futures
import hashlib
import json
import os
import re
import sys
import tempfile
import urllib.error
import urllib.request
from collections import Counter, defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path('/Users/sanheng/Project/cwy/ai-building')
JD_PROJECT = Path('/Users/sanheng/Project/sanheng/ai-core')
CONTRACT = ROOT / 'outputs/product-governance-v4/cleaning-supplies-procurement-20261030/review/attribute-proposals.json'
OUT = ROOT / 'outputs/product-governance-v4/sku-fill-pilot-20261030'
CATEGORY_QUOTAS = [('无芯小卷纸', 40), ('有芯小卷纸', 80), ('盒装抽纸', 80), ('软包抽纸', 80), ('洗脸巾', 60), ('平口式垃圾袋', 60), ('分类垃圾桶', 20), ('公共垃圾桶', 20), ('脚踏垃圾桶', 20)]
ROOT_CATEGORY_ID = '8d67b123-c890-45e4-aafc-b138e296c722'
INDEX = 'uece-prod-sc_current'
ES_FIELDS = ['title', 'rawTitle', 'productId', 'spuProductId', 'productInstanceId', 'categoryInstanceId', 'categoryIds', 'categoryInstance.categoryId', 'brand.name', 'isHead', 'isStdProduct', 'isSpuEnable', 'isSkuEnable', 'spuSaleStatus', 'skuSaleStatus', 'product.upstreamId', 'product.upstreamSku', 'product.upstreamSpu']
SUMMARY_FIELDS = ['sku', 'title', 'saleSpec', 'brandName', 'upstreamName', 'mainImages', 'categoryNames', 'isSpuEnable', 'isSkuEnable', 'spuSaleStatus', 'skuSaleStatus']
SALT = 'sku-fill-pilot-20261030-v1'
UUID = re.compile(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs): return None

OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

def now(): return datetime.now(timezone.utc).isoformat()
def digest(data): return hashlib.sha256(data).hexdigest()
def json_bytes(obj): return (json.dumps(obj, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
def read_json(file): return json.loads(file.read_text(encoding='utf-8'))
def save(file, value, allow_existing=False):
    file.parent.mkdir(parents=True, exist_ok=True)
    if allow_existing: raise RuntimeError('overwriting_outputs_forbidden')
    with tempfile.NamedTemporaryFile(dir=file.parent, prefix='.sku-evidence-', delete=False) as stream:
        temp = Path(stream.name)
        try: stream.write(json_bytes(value))
        except Exception:
            temp.unlink(missing_ok=True)
            raise
    try:
        # Linking is atomic and fails if the destination already exists.
        os.link(temp, file)
    except FileExistsError as error:
        raise RuntimeError('output_exists') from error
    finally:
        temp.unlink(missing_ok=True)
def hash_file(file): return digest(file.read_bytes())
def key_hash(*args): return digest(('|'.join([SALT] + [str(x) for x in args])).encode())

def load_vars(file, names):
    result = {}
    for line in file.read_text(encoding='utf-8').splitlines():
        m = re.match(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$', line)
        if m and m.group(1) in names:
            value = m.group(2)
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'": value = value[1:-1]
            result[m.group(1)] = value
    return result

def post(url, body, headers, timeout=60):
    request = urllib.request.Request(url, data=json.dumps(body,ensure_ascii=False).encode(), headers={'Content-Type':'application/json',**headers}, method='POST')
    with OPENER.open(request, timeout=timeout) as response:
        return json.loads(response.read())

def contract_info(contract_path=None):
    contract = read_json(contract_path or CONTRACT)
    rows = []
    for name, quota in CATEGORY_QUOTAS:
        hits = [x for x in contract['categories'] if x.get('category') == name]
        if len(hits) != 1: raise RuntimeError('ambiguous_contract_category')
        c = hits[0]
        if not UUID.fullmatch(c['categoryId']) or not str(c.get('path','')).startswith('清洁用品>'): raise RuntimeError('invalid_contract_category')
        rows.append({'name': name,'categoryId': c['categoryId'],'path':c['path'],'requested':quota})
    return contract, rows

def query_for(category_id, after=None, root_id=None, sku_ids=None):
    root_id = root_id or ROOT_CATEGORY_ID
    filters = [{'term':{'categoryIds':root_id}},{'term':{'categoryInstance.categoryId':category_id}}]
    if sku_ids is not None: filters.append({'terms':{'productId':sku_ids}})
    body = {'size':1000, 'track_total_hits':True, '_source':ES_FIELDS,
       'query':{'bool':{'filter':filters}},
       'sort':[{'productId':{'order':'asc','missing':'_last'}},{'productInstanceId':{'order':'asc','missing':'_last'}}]}
    if after is not None: body['search_after'] = after
    return body

def es_source(value):
    value = value if isinstance(value,dict) else {}
    allowed = {'title','rawTitle','productId','spuProductId','productInstanceId','categoryInstanceId','categoryIds','isHead','isStdProduct','isSpuEnable','isSkuEnable','spuSaleStatus','skuSaleStatus'}
    out = {k:value[k] for k in allowed if k in value}
    for field, subfields in [('brand',['name']),('categoryInstance',['categoryId']),('product',['upstreamId','upstreamSku','upstreamSpu'])]:
        item = value.get(field)
        if isinstance(item,dict): out[field] = {k:item[k] for k in subfields if k in item}
    return out

def read_category(es_conf, cat, root_id=None, sku_ids=None):
    root_id = root_id or ROOT_CATEGORY_ID
    creds = base64.b64encode((es_conf['ES_USERNAME'] + ':' + es_conf['ES_PASSWORD']).encode()).decode()
    docs, after, total, sort_keys = [], None, None, set()
    start = now()
    while True:
        data = post(es_conf['ES_NODE'].rstrip('/') + '/' + INDEX + '/_search',query_for(cat['categoryId'],after,root_id,sku_ids),{'Authorization':'Basic '+creds},45)
        if data.get('timed_out') or data.get('_shards',{}).get('failed',0): raise RuntimeError('es_partial_response')
        hits = data.get('hits',{}); this_total = hits.get('total',{})
        if not isinstance(this_total,dict) or this_total.get('relation') != 'eq': raise RuntimeError('es_inexact_total')
        if total is None: total = this_total.get('value')
        elif total != this_total.get('value'): raise RuntimeError('es_total_changed_during_pagination')
        batch = hits.get('hits',[])
        for hit in batch:
            source = es_source(hit.get('_source'))
            if root_id not in (source.get('categoryIds') or []) or source.get('categoryInstance',{}).get('categoryId') != cat['categoryId'] or (sku_ids is not None and source.get('productId') not in sku_ids): raise RuntimeError('es_scope_mismatch')
            sort_key = json.dumps(hit.get('sort'),ensure_ascii=False)
            if hit.get('sort') is None or sort_key in sort_keys: raise RuntimeError('es_nonunique_sort_key')
            sort_keys.add(sort_key); docs.append(source)
        if not batch or len(docs) >= total: break
        after = batch[-1].get('sort')
    if len(docs) != total: raise RuntimeError('es_incomplete_pagination')
    return {'category':cat,'capturedFrom':start,'capturedAt':now(),'query':query_for(cat['categoryId'],None,root_id,sku_ids),'skuDocuments':total,'records':docs}

def choose(category, records):
    # Duplicate product IDs represent ES documents, not extra SKUs. Prefer head,
    # then choose deterministically; record every duplicate in the receipt.
    groups=defaultdict(list)
    invalid=0
    for row in records:
        pid=row.get('productId')
        if not isinstance(pid,str) or not UUID.fullmatch(pid): invalid+=1; continue
        groups[pid].append(row)
    representatives=[]
    for pid, rows in groups.items():
        rows.sort(key=lambda x:(x.get('isHead') is not True,key_hash(json.dumps(x,ensure_ascii=False,sort_keys=True))))
        representatives.append(rows[0])
    buckets=defaultdict(list)
    for row in representatives:
        brand = row.get('brand',{}).get('name') or '未提供'
        buckets[brand].append(row)
    for brand in buckets: buckets[brand].sort(key=lambda x:key_hash(category['categoryId'],x['productId']))
    brands=sorted(buckets,key=lambda x:key_hash(category['categoryId'],'brand',x))
    queues={b:deque(buckets[b]) for b in brands}
    selected=[]; spus=set()
    # First choose one per identified SPU with fair brand rotation, then repeat SPUs.
    for distinct_pass in (True,False):
        progressed=True
        while progressed and len(selected)<category['requested']:
            progressed=False
            for brand in brands:
                q=queues[brand]; eligible=None
                for idx,row in enumerate(q):
                    spu = row.get('spuProductId') or ('missing-spu:'+row['productId'])
                    if not distinct_pass or spu not in spus: eligible=idx; break
                if eligible is None: continue
                q.rotate(-eligible); row=q.popleft(); q.rotate(eligible)
                spu=row.get('spuProductId') or ('missing-spu:'+row['productId'])
                selected.append({'skuId':row['productId'],'spuProductId':row.get('spuProductId'), 'productInstanceId':row.get('productInstanceId'), 'brandName':row.get('brand',{}).get('name'), 'categoryId':category['categoryId'],'selectionPass':'distinct_spu' if distinct_pass else 'repeat_spu'})
                spus.add(spu); progressed=True
                if len(selected)>=category['requested']: break
    duplicate_ids = sorted(pid for pid, rows in groups.items() if len(rows)>1)
    return {'category':category, 'availableDocuments':len(records), 'availableUniqueSku':len(groups), 'availableUniqueKnownSpu':len({r.get('spuProductId') for r in representatives if r.get('spuProductId')}), 'invalidProductIdDocuments':invalid, 'duplicateSkuIds':duplicate_ids, 'selected':selected, 'gap':max(0,category['requested']-len(selected))}

def load_frozen_scope(scope_path, contract_path):
    """Resolve a pinned inventory and an explicitly frozen SKU set locally."""
    scope_path, contract_path = scope_path.resolve(), contract_path.resolve()
    scope_bytes = scope_path.read_bytes()
    scope = json.loads(scope_bytes)
    if not isinstance(scope, dict) or scope.get('version') != 1 or not isinstance(scope.get('rootCategoryId'), str) or not UUID.fullmatch(scope['rootCategoryId']):
        raise RuntimeError('invalid_scope_manifest')
    def pinned(name):
        ref = scope.get(name)
        if not isinstance(ref, dict) or not isinstance(ref.get('path'), str) or not ref['path'].strip() or not isinstance(ref.get('sha256'), str) or not re.fullmatch(r'[0-9a-f]{64}', ref['sha256']):
            raise RuntimeError('invalid_scope_reference')
        file = (scope_path.parent / ref['path']).resolve()
        data = file.read_bytes()
        if digest(data) != ref['sha256']: raise RuntimeError('scope_input_hash_mismatch')
        return {'path':str(file), 'sha256':ref['sha256']}, data
    (contract_ref, contract_bytes), (inventory_ref, inventory_bytes) = pinned('contract'), pinned('inventory')
    if Path(contract_ref['path']) != contract_path: raise RuntimeError('scope_contract_path_mismatch')
    contract, inventory = json.loads(contract_bytes), json.loads(inventory_bytes)
    if contract.get('attributeContractVersion') != 1 or not isinstance(contract.get('categories'), list) or not isinstance(contract.get('proposals'), list):
        raise RuntimeError('invalid_scope_contract')
    if inventory.get('rootCategoryId') != scope['rootCategoryId'] or not isinstance(inventory.get('records'), list):
        raise RuntimeError('inventory_root_mismatch')
    attrs = Counter(p.get('categoryId') for p in contract['proposals'] if isinstance(p, dict))
    category_map = {}
    for c in contract['categories']:
        if not isinstance(c, dict): raise RuntimeError('invalid_contract_category')
        cid = c.get('categoryId')
        if cid in category_map: raise RuntimeError('duplicate_contract_category')
        category_map[cid] = c
    allowed = scope.get('categoryIds')
    if allowed is not None and (not isinstance(allowed, list) or not allowed or any(not isinstance(x, str) or not UUID.fullmatch(x) for x in allowed) or len(set(allowed)) != len(allowed)):
        raise RuntimeError('invalid_scope_categories')
    if allowed and any(cid not in category_map or not attrs[cid] for cid in allowed): raise RuntimeError('ungoverned_scope_category')
    by_id, by_category = defaultdict(list), defaultdict(list)
    for row in inventory['records']:
        if not isinstance(row, dict): raise RuntimeError('invalid_inventory_row')
        sku, cid = row.get('productId'), row.get('categoryId')
        by_category[cid].append(row)
        if isinstance(sku, str) and UUID.fullmatch(sku):
            by_id[sku].append(row)
    forms = int('skuIds' in scope) + int('skus' in scope) + int(scope.get('selectionMode') == 'all_categories')
    if forms != 1: raise RuntimeError('scope_requires_exactly_one_frozen_selection')
    requested = []
    if 'skuIds' in scope:
        if not isinstance(scope['skuIds'], list): raise RuntimeError('invalid_frozen_skus')
        requested = [(sku, None) for sku in scope['skuIds']]
    elif 'skus' in scope:
        if not isinstance(scope['skus'], list) or any(not isinstance(row, dict) or not isinstance(row.get('categoryId'),str) or not UUID.fullmatch(row['categoryId']) for row in scope['skus']): raise RuntimeError('invalid_frozen_skus')
        requested = [(row.get('skuId'), row.get('categoryId')) for row in scope['skus']]
    else:
        if not allowed: raise RuntimeError('all_categories_requires_category_ids')
        if any(not isinstance(row.get('productId'),str) or not UUID.fullmatch(row['productId']) for cid in allowed for row in by_category[cid]):
            raise RuntimeError('invalid_inventory_sku_for_all_categories')
        requested = [(sku, None) for sku in dict.fromkeys(row['productId'] for cid in allowed for row in by_category[cid])]
    if not requested or any(not isinstance(sku, str) or not UUID.fullmatch(sku) for sku, _ in requested) or len({sku for sku, _ in requested}) != len(requested):
        raise RuntimeError('invalid_or_duplicate_frozen_skus')
    grouped = {}
    for sku, declared_cid in requested:
        rows = by_id.get(sku, [])
        cids = {row.get('categoryId') for row in rows}
        if not rows or len(cids) != 1: raise RuntimeError('frozen_sku_missing_or_ambiguous')
        cid = next(iter(cids))
        if not isinstance(cid, str) or not UUID.fullmatch(cid) or cid not in category_map or not attrs[cid] or (allowed and cid not in allowed) or (declared_cid is not None and declared_cid != cid):
            raise RuntimeError('frozen_sku_category_mismatch')
        cat = category_map[cid]
        if not isinstance(cat.get('category'), str) or not cat['category'].strip() or not isinstance(cat.get('path'), str) or not cat['path'].strip():
            raise RuntimeError('invalid_contract_category')
        # A changed product instance or SPU is not resolved by guessing a head.
        for field in ('productInstanceId', 'spuProductId'):
            values = {r.get(field) for r in rows if r.get(field) is not None}
            if len(values) > 1: raise RuntimeError('ambiguous_inventory_sku_identity')
        representative = sorted(rows, key=lambda x:(x.get('isHead') is not True, json.dumps(x, sort_keys=True, ensure_ascii=False)))[0]
        selected = {'skuId':sku,'spuProductId':representative.get('spuProductId'),'productInstanceId':representative.get('productInstanceId'),
                    'brandName':None,'categoryId':cid,'selectionPass':'frozen_inventory'}
        grouped.setdefault(cid, []).append(selected)
    chosen = []
    for cid, selected in grouped.items():
        cat = category_map[cid]
        category = {'name':cat['category'],'categoryId':cid,'path':cat['path'],'requested':len(selected)}
        available = by_category[cid]
        chosen.append({'category':category,'availableDocuments':len(available),'availableUniqueSku':len({r['productId'] for r in available if isinstance(r.get('productId'),str) and UUID.fullmatch(r['productId'])}),
            'availableUniqueKnownSpu':len({r['spuProductId'] for r in available if r.get('spuProductId')}), 'invalidProductIdDocuments':sum(not isinstance(r.get('productId'),str) or not UUID.fullmatch(r['productId']) for r in available),
            'duplicateSkuIds':sorted(sku for sku, rows in by_id.items() if len(rows)>1 and rows[0].get('categoryId') == cid), 'selected':selected,'gap':0})
    return {'scope':scope,'scopeRef':{'path':str(scope_path),'sha256':digest(scope_bytes)},'contract':contract,'contractRef':contract_ref,
            'inventoryRef':inventory_ref,'chosen':chosen,'selectedSkuCount':len(requested)}

def es_config():
    names = {'ES_NODE','ES_USERNAME','ES_PASSWORD'}
    for file in (ROOT/'.env', JD_PROJECT/'.env'):
        if file.exists():
            config = load_vars(file,names)
            if all(config.get(x) for x in names): return config
    return {}

def read_frozen_category(es_conf, chosen, root_id):
    """Only hydrate already frozen IDs; retain one placeholder for every failure."""
    cat, selected = chosen['category'], chosen['selected']
    records, statuses, queries = [], {}, []
    for i in range(0, len(selected), 500):
        picks = selected[i:i+500]; ids = [p['skuId'] for p in picks]
        queries.append(query_for(cat['categoryId'], None, root_id, ids))
        try:
            if not es_conf: raise RuntimeError('es_configuration_unavailable')
            fetched = read_category(es_conf, cat, root_id, ids)
            by_sku = defaultdict(list)
            for row in fetched['records']: by_sku[row.get('productId')].append(row)
            batch_status = None
        except Exception:
            by_sku = {}; batch_status = 'read_failed' if es_conf else 'configuration_unavailable'
        for pick in picks:
            sku = pick['skuId']; candidates = by_sku.get(sku, [])
            expected_instance = pick.get('productInstanceId')
            if expected_instance:
                matches = [r for r in candidates if r.get('productInstanceId') == expected_instance]
            else:
                instances = {r.get('productInstanceId') for r in candidates if r.get('productInstanceId')}
                matches = candidates if len(instances) <= 1 else []
            expected_spu = pick.get('spuProductId')
            if expected_spu: matches = [r for r in matches if r.get('spuProductId') == expected_spu]
            if matches:
                matches.sort(key=lambda x:(x.get('isHead') is not True,key_hash(json.dumps(x,ensure_ascii=False,sort_keys=True))))
                records.append(matches[0]); statuses[sku] = 'ok'
            else:
                statuses[sku] = batch_status or ('identity_changed_or_ambiguous' if candidates else 'missing_from_es')
                records.append({'productId':sku,'spuProductId':pick.get('spuProductId'),'productInstanceId':expected_instance,
                                'categoryInstance':{'categoryId':cat['categoryId']},'collectorReadStatus':statuses[sku], 'recordOrigin':'frozen_inventory'})
    return {'category':cat,'capturedAt':now(),'queryScope':{'rootField':'categoryIds','rootCategoryId':root_id,'leafField':'categoryInstance.categoryId',
            'skuField':'productId','batchSize':500},'queries':queries,'records':records,'skuReadStatuses':statuses,
            'statusCounts':dict(Counter(statuses.values())),'note':'inventory placeholders are not successful ES reads; failed SKUs are never replaced'}

def do_frozen_selection(out, concurrency, scope_path, contract_path):
    inputs = load_frozen_scope(scope_path, contract_path)
    chosen, root_id = inputs['chosen'], inputs['scope']['rootCategoryId']
    targets = [out/'selection.json', out/'selection-manifest.json'] + [out/'raw'/'es'/f"{x['category']['categoryId']}.json" for x in chosen]
    if any(path.exists() for path in targets): raise RuntimeError('selection_output_exists')
    config = es_config()
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as pool:
        receipts = list(pool.map(lambda cat:read_frozen_category(config,cat,root_id), chosen))
    for ref in (inputs['scopeRef'],inputs['inventoryRef'],inputs['contractRef']):
        if hash_file(Path(ref['path'])) != ref['sha256']: raise RuntimeError('scope_input_changed')
    raw_refs = []
    for receipt in receipts:
        file = out/'raw'/'es'/f"{receipt['category']['categoryId']}.json"
        save(file, receipt); raw_refs.append({'path':str(file.resolve()),'sha256':hash_file(file)})
    selected_ids = [r['skuId'] for c in chosen for r in c['selected']]
    status_counts = sum((Counter(r['statusCounts']) for r in receipts),Counter())
    selection = {'version':1,'frozenAt':now(),'purpose':'explicit frozen SKU inventory; offline evidence collection; no replacement or resampling',
        'scope':{'rootCategoryId':root_id,'rootField':'categoryIds','leafField':'categoryInstance.categoryId','index':INDEX,'statusFilters':[],
                 'sourceFields':ES_FIELDS,'scopeManifest':inputs['scopeRef'],'inventory':inputs['inventoryRef']},
        'selectionMethod':'explicit pinned inventory SKU IDs; no replacement after freezing','contractPath':inputs['contractRef']['path'],
        'contractSha256':inputs['contractRef']['sha256'],'contractAdoption':inputs['contract'].get('adoption'),'categories':chosen,
        'selectedSkuCount':len(selected_ids),'esReadStatusCounts':dict(status_counts),'productionWrites':0,'modelRequests':0}
    save(out/'selection.json',selection)
    manifest = {'version':2,'selectionPath':str((out/'selection.json').resolve()),'selectionSha256':hash_file(out/'selection.json'),
        'contractPath':inputs['contractRef']['path'],'contractSha256':inputs['contractRef']['sha256'],'scopeManifest':inputs['scopeRef'],
        'inventory':inputs['inventoryRef'],'rawEs':raw_refs,'frozenAt':selection['frozenAt'],'selectedSkuCount':len(selected_ids),
        'esReadStatusCounts':dict(status_counts),'categories':[{'name':c['category']['name'],'categoryId':c['category']['categoryId'],
        'requested':c['category']['requested'],'selected':len(c['selected']),'availableDocuments':c['availableDocuments'],
        'availableUniqueSku':c['availableUniqueSku'],'availableUniqueKnownSpu':c['availableUniqueKnownSpu'],'gap':c['gap']} for c in chosen]}
    save(out/'selection-manifest.json',manifest)
    print(json.dumps({'phase':'selection',**manifest},ensure_ascii=False),flush=True)

def do_selection(out, concurrency, contract_path=None, scope_path=None):
    if scope_path is not None: return do_frozen_selection(out, concurrency, scope_path, contract_path or CONTRACT)
    if (out/'selection.json').exists(): raise RuntimeError('selection_already_frozen')
    contract_path = (contract_path or CONTRACT).resolve()
    contract,categories=contract_info(contract_path)
    es_conf=load_vars(ROOT/'.env',{'ES_NODE','ES_USERNAME','ES_PASSWORD'})
    if not all(es_conf.get(x) for x in ('ES_NODE','ES_USERNAME','ES_PASSWORD')):
        es_conf=load_vars(JD_PROJECT/'.env',{'ES_NODE','ES_USERNAME','ES_PASSWORD'})
    if not all(es_conf.get(x) for x in ('ES_NODE','ES_USERNAME','ES_PASSWORD')): raise RuntimeError('es_config_unavailable')
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as pool:
        receipts = list(pool.map(lambda cat:read_category(es_conf,cat),categories))
    chosen=[choose(cat,receipt['records']) for cat,receipt in zip(categories,receipts)]
    ids=[row['skuId'] for cat in chosen for row in cat['selected']]
    if len(ids)!=len(set(ids)): raise RuntimeError('selected_sku_in_multiple_categories')
    for receipt in receipts: save(out/'raw'/'es'/f"{receipt['category']['categoryId']}.json",receipt)
    selection={'version':1,'frozenAt':now(),'purpose':'offline pilot, not a random or accuracy evaluation sample','scope':{'rootCategoryId':ROOT_CATEGORY_ID,'rootField':'categoryIds','leafField':'categoryInstance.categoryId','index':INDEX,'statusFilters':[],'sourceFields':ES_FIELDS},'selectionMethod':'stable SHA-256 order, brand rotation with distinct SPU first then remaining; no SKU replacement after freezing','contractPath':str(contract_path),'contractSha256':hash_file(contract_path),'contractAdoption':contract.get('adoption'),'categories':chosen,'selectedSkuCount':len(ids),'productionWrites':0,'modelRequests':0}
    save(out/'selection.json',selection)
    manifest={'selectionPath':str(out/'selection.json'),'selectionSha256':hash_file(out/'selection.json'),'contractPath':str(contract_path),'contractSha256':selection['contractSha256'],'frozenAt':selection['frozenAt'],'selectedSkuCount':len(ids),'categories':[{'name':c['category']['name'],'requested':c['category']['requested'],'selected':len(c['selected']),'availableDocuments':c['availableDocuments'],'availableUniqueSku':c['availableUniqueSku'],'availableUniqueKnownSpu':c['availableUniqueKnownSpu'],'gap':c['gap']} for c in chosen]}
    save(out/'selection-manifest.json',manifest)
    print(json.dumps({'phase':'selection',**manifest},ensure_ascii=False),flush=True)

def verify_frozen(out, contract_path=None, scope_path=None):
    selection, manifest = read_json(out/'selection.json'), read_json(out/'selection-manifest.json')
    pinned_contract = Path(manifest.get('contractPath') or contract_path or CONTRACT).resolve()
    if contract_path is not None and Path(contract_path).resolve() != pinned_contract: raise RuntimeError('frozen_contract_path_mismatch')
    if hash_file(out/'selection.json') != manifest['selectionSha256'] or hash_file(pinned_contract) != manifest['contractSha256']:
        raise RuntimeError('frozen_hash_mismatch')
    if manifest.get('version') == 2:
        selected = [row for c in selection.get('categories',[]) for row in c.get('selected',[])]
        ids = [r.get('skuId') for r in selected]
        if selection.get('selectedSkuCount') != len(ids) or manifest.get('selectedSkuCount') != len(ids) or len(ids) != len(set(ids)):
            raise RuntimeError('frozen_selection_count_mismatch')
        if selection.get('contractPath') != str(pinned_contract) or selection.get('contractSha256') != manifest['contractSha256']:
            raise RuntimeError('frozen_contract_mismatch')
        scope = manifest.get('scopeManifest', {})
        if scope_path is not None and Path(scope.get('path','')).resolve() != Path(scope_path).resolve(): raise RuntimeError('frozen_scope_path_mismatch')
        if selection.get('scope',{}).get('scopeManifest') != scope or selection.get('scope',{}).get('inventory') != manifest.get('inventory'):
            raise RuntimeError('frozen_scope_mismatch')
        for ref in (scope,manifest.get('inventory',{})):
            if not ref.get('path') or not re.fullmatch(r'[0-9a-f]{64}',ref.get('sha256','')) or hash_file(Path(ref['path'])) != ref['sha256']:
                raise RuntimeError('frozen_hash_mismatch')
        refs = manifest.get('rawEs')
        expected = {(out/'raw'/'es'/f"{c['category']['categoryId']}.json").resolve() for c in selection['categories']}
        if not isinstance(refs,list) or len(refs) != len(expected) or {Path(r.get('path','')).resolve() for r in refs} != expected:
            raise RuntimeError('frozen_es_receipts_mismatch')
        for ref in refs:
            if not re.fullmatch(r'[0-9a-f]{64}',ref.get('sha256','')) or hash_file(Path(ref['path'])) != ref['sha256']: raise RuntimeError('frozen_hash_mismatch')
    return selection, manifest

def summary_safe(row):
    out={k:row[k] for k in SUMMARY_FIELDS if k in row}
    images=out.get('mainImages')
    def valid_url(s):
        if not isinstance(s,str): return None
        u=urlsplit(s); return s if u.scheme in ('http','https') and bool(u.netloc) else None
    if isinstance(images,list): out['mainImages']=[x for x in (valid_url(s) for s in images) if x]
    elif isinstance(images,str): out['mainImages']=valid_url(images) or ''
    elif images is not None: out['mainImages']=''
    return out

def batch_summary(ids,key):
    at=now()
    try:
        response=post('https://sc.sanheng.com/api/external/getProductInfo',{'skus':ids},{'Authorization':key},60)
        if isinstance(response,dict) and isinstance(response.get('data'),list): response=response['data']
        if not isinstance(response,list): return {'requestedIds':ids,'capturedAt':at,'status':'unsupported_response','rows':[]}
        by_id=defaultdict(list); unexpected=0
        for row in response:
            if not isinstance(row,dict) or row.get('sku') not in ids: unexpected+=1; continue
            by_id[row['sku']].append(summary_safe(row))
        rows=[]
        for sku in ids:
            records=by_id[sku]
            if len(records)==1: rows.append({'skuId':sku,'status':'ok','data':records[0]})
            elif len(records)>1: rows.append({'skuId':sku,'status':'duplicate_in_response','data':None})
            else: rows.append({'skuId':sku,'status':'missing_from_response','data':None})
        return {'requestedIds':ids,'capturedAt':at,'status':'ok','unexpectedReturnedRows':unexpected,'rows':rows}
    except Exception:
        return {'requestedIds':ids,'capturedAt':at,'status':'request_failed','rows':[{'skuId':sku,'status':'request_failed','data':None} for sku in ids]}

def do_summary(out, concurrency, contract_path=None, scope_path=None):
    if (out/'collection'/'summary.json').exists() or (out/'collection'/'summary-receipt.json').exists(): raise RuntimeError('summary_already_collected')
    selection,manifest=verify_frozen(out,contract_path,scope_path)
    key=load_vars(JD_PROJECT/'.env',{'SANHENG_API_KEY'}).get('SANHENG_API_KEY')
    if not key: raise RuntimeError('summary_config_unavailable')
    selected=[r for c in selection['categories'] for r in c['selected']]
    ids=[r['skuId'] for r in selected]
    batches=[ids[i:i+6] for i in range(0,len(ids),6)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as pool: receipts=list(pool.map(lambda batch:batch_summary(batch,key),batches))
    for batch, receipt in zip(batches, receipts):
        if receipt.get('requestedIds') != batch: raise RuntimeError('summary_batch_mismatch')
        if receipt.get('status') != 'unsupported_response':
            returned = [r.get('skuId') for r in receipt.get('rows',[]) if isinstance(r,dict)]
            if len(returned) != len(batch) or len(set(returned)) != len(batch) or set(returned) != set(batch): raise RuntimeError('summary_reconciliation_mismatch')
    rows={r['skuId']:r for receipt in receipts for r in receipt['rows']}
    # Unsupported envelopes still need one status per requested SKU.
    for receipt in receipts:
        if receipt['status']=='unsupported_response':
            for sku in receipt['requestedIds']: rows[sku]={'skuId':sku,'status':'unsupported_response','data':None}
    ordered=[rows[sku] for sku in ids]
    result={'capturedAt':now(),'endpoint':'https://sc.sanheng.com/api/external/getProductInfo','selectionSha256':manifest['selectionSha256'],'contractSha256':manifest['contractSha256'],'safeFields':SUMMARY_FIELDS,'batchSize':6,'concurrency':concurrency,'batches':[{'requestedIds':x['requestedIds'],'capturedAt':x['capturedAt'],'status':x['status'],'unexpectedReturnedRows':x.get('unexpectedReturnedRows',0)} for x in receipts],'rows':ordered,'counts':dict(Counter(r['status'] for r in ordered)),'productionWrites':0,'modelRequests':0}
    verify_frozen(out,contract_path,scope_path)
    save(out/'collection'/'summary.json',result)
    if manifest.get('version') == 2:
        save(out/'collection'/'summary-receipt.json',{'summarySha256':hash_file(out/'collection'/'summary.json'),
             'selectionSha256':manifest['selectionSha256'],'contractSha256':manifest['contractSha256']})
    print(json.dumps({'phase':'summary','counts':result['counts'],'requested':len(ids)},ensure_ascii=False),flush=True)

VOP_QUERY_EXT = [1, 2, 3, 5, 6, 9, 10, 11]
JD_NAMES = {'京东', '京东供应链', '京东VOP', '京东企业购', '京东商城', 'JD', 'JD_VOP'}

VOP_CHILD_JS = r"""
import path from 'node:path';
// SDK provider messages can contain sensitive details; suppress them entirely.
console.log = () => {}; console.warn = () => {}; console.error = () => {};
const jobs = JSON.parse(await Bun.stdin.text());
const sdk = await import('/Users/sanheng/Project/sanheng/ai-core/src/lib/jd-vop/goods/index.ts');
const concurrency = Number(process.env.PILOT_CONCURRENCY || '6');
let next = 0;
await Promise.all(Array.from({length: Math.min(concurrency, jobs.length)}, async () => {
  while (next < jobs.length) {
    const skuId = jobs[next++];
    const request = {skuId, queryExtSet:[1,2,3,5,6,9,10,11]};
    process.stdout.write(JSON.stringify({event:'request_started',skuId}) + '\n');
    let result;
    try {
      const raw = await sdk.getSkuDetailInfo(request);
      const data = Array.isArray(raw) ? raw.find(x => String(x?.skuId) === skuId) : raw;
      if (!data || String(data.skuId) !== skuId) result = {skuId,status:'sku_mismatch'};
      else result = {skuId,status:'ok',request,fetchedAt:new Date().toISOString(),data};
    } catch { result = {skuId,status:'read_failed'}; }
    process.stdout.write(JSON.stringify(result, (_,v) => typeof v === 'bigint' ? String(v) : v) + '\n');
  }
}));
"""

def vop_key(sku):
    request={'skuId':sku,'queryExtSet':VOP_QUERY_EXT}
    key=json.dumps({'method':'jingdong.vop.goods.getSkuDetailInfo','request':request},ensure_ascii=False,indent=2)
    return 'getSkuDetailInfo-'+digest(key.encode())[:20]+'.json'

def vop_cache(skus, out):
    # Existing receipts use the same request-hash algorithm. Walk names only,
    # open matching files, and require identical ID, requested extensions and data ID.
    needed={vop_key(sku):sku for sku in skus}; matches=defaultdict(list)
    # A previous interrupted run may already have a validated local receipt.
    for sku in skus:
        existing=out/'raw'/'vop'/f'{sku}.json'
        if existing.exists(): matches[sku].append(existing)
    for base in (ROOT/'outputs/product-governance-v3', ROOT/'outputs/product-governance-v4'):
        if not base.exists(): continue
        for directory, _, files in os.walk(base):
            if Path(directory).is_relative_to(out): continue
            for name in set(files).intersection(needed): matches[needed[name]].append(Path(directory)/name)
    found={}
    for sku,paths in matches.items():
        candidates=[]
        for file in paths:
            try:
                item=read_json(file); req=item.get('request',{}); data=item.get('data')
                if item.get('status')!='ok' or str(req.get('skuId'))!=sku or req.get('queryExtSet')!=VOP_QUERY_EXT: continue
                if isinstance(data,list): data=next((d for d in data if isinstance(d,dict) and str(d.get('skuId'))==sku),None)
                if not isinstance(data,dict) or str(data.get('skuId'))!=sku: continue
                candidates.append((str(item.get('fetchedAt') or ''),file,item,data))
            except Exception: continue
        if candidates:
            fetched,file,item,data=max(candidates,key=lambda x:x[0])
            found[sku]={'method':'jingdong.vop.goods.getSkuDetailInfo','request':{'skuId':sku,'queryExtSet':VOP_QUERY_EXT},'fetchedAt':fetched,'status':'ok','data':data,'cacheSource':str(file),'cacheReusedAt':now()}
    return found

def fetch_vop(skus,out,concurrency):
    if not skus: return {}, set()
    import subprocess
    env={k:v for k,v in os.environ.items() if not k.startswith('JD_VOP_') and k not in ('HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy','SANHENG_API_KEY','ES_NODE','ES_USERNAME','ES_PASSWORD')}
    env.update(load_vars(JD_PROJECT/'.env',{line.split('=',1)[0].strip() for line in (JD_PROJECT/'.env').read_text().splitlines() if line.startswith('JD_VOP_') and '=' in line}))
    if not env.get('JD_VOP_APP_KEY') or not env.get('JD_VOP_APP_SECRET'): return {sku:{'status':'configuration_unavailable'} for sku in skus}, set()
    env.update({'NO_PROXY':'*','no_proxy':'*','PILOT_CONCURRENCY':str(concurrency)})
    try:
        proc=subprocess.Popen(['bun','--no-env-file','-e',VOP_CHILD_JS],cwd=str(ROOT),env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,encoding='utf-8',bufsize=1)
        proc.stdin.write(json.dumps(skus)); proc.stdin.close()
    except Exception: return {sku:{'status':'worker_start_failed'} for sku in skus}, set()
    results={}; started=set()
    for line in proc.stdout:
        try:
            x=json.loads(line); sku=x.get('skuId')
            if sku not in skus: continue
            if x.get('event')=='request_started': started.add(sku); continue
            if sku in results: continue
            status=x.get('status')
            if status=='ok' and isinstance(x.get('data'),dict) and str(x['data'].get('skuId'))==sku and x.get('request')=={'skuId':sku,'queryExtSet':VOP_QUERY_EXT}:
                receipt={'method':'jingdong.vop.goods.getSkuDetailInfo','request':x['request'],'fetchedAt':x['fetchedAt'],'status':'ok','data':x['data']}
                target=out/'raw'/'vop'/f'{sku}.json'; save(target,receipt)
                results[sku]={'status':'ok','receipt':str(target),'fetchedAt':x['fetchedAt'],'cached':False}
            else: results[sku]={'status':status if status in ('sku_mismatch','read_failed') else 'read_failed'}
            if len(results)%25==0 or len(results)==len(skus): print(json.dumps({'phase':'vop_progress','completed':len(results),'requested':len(skus)}),flush=True)
        except Exception: continue
    proc.wait()
    for sku in skus:
        if sku not in results: results[sku]={'status':'worker_incomplete'}
    return results, started

def do_vop(out,concurrency,contract_path=None,scope_path=None):
    target=out/'collection'/'vop-status.json'
    if target.exists(): raise RuntimeError('vop_already_collected')
    selection,manifest=verify_frozen(out,contract_path,scope_path); summary=read_json(out/'collection'/'summary.json')
    if summary['selectionSha256']!=manifest['selectionSha256']: raise RuntimeError('frozen_hash_mismatch')
    summary_receipt = None
    if manifest.get('version') == 2:
        summary_receipt=read_json(out/'collection'/'summary-receipt.json')
        if summary_receipt.get('summarySha256') != hash_file(out/'collection'/'summary.json') or summary_receipt.get('selectionSha256') != manifest['selectionSha256'] or summary_receipt.get('contractSha256') != manifest['contractSha256'] or summary.get('contractSha256') != manifest['contractSha256']:
            raise RuntimeError('frozen_summary_mismatch')
        expected=[r['skuId'] for c in selection['categories'] for r in c['selected']]
        actual=[r.get('skuId') for r in summary.get('rows',[])]
        if len(actual)!=len(expected) or len(set(actual))!=len(actual) or set(actual)!=set(expected): raise RuntimeError('summary_reconciliation_mismatch')
    summary_map={r['skuId']:r for r in summary['rows']}; rows=[]; eligible=set()
    for category in selection['categories']:
        raw=read_json(out/'raw'/'es'/f"{category['category']['categoryId']}.json")
        by_sku=defaultdict(list)
        for r in raw['records']: by_sku[r.get('productId')].append(r)
        for selected in category['selected']:
            sku=selected['skuId']; hits=by_sku[sku]
            hits.sort(key=lambda x:(x.get('isHead') is not True,key_hash(json.dumps(x,ensure_ascii=False,sort_keys=True))))
            es=hits[0] if hits else {}; upstream=es.get('product',{}); upsku=upstream.get('upstreamSku')
            if isinstance(upsku,int): upsku=str(upsku)
            valid_sku=isinstance(upsku,str) and re.fullmatch(r'[0-9]+',upsku) is not None
            summ=summary_map.get(sku,{}); source=(summ.get('data') or {}).get('upstreamName')
            es_status=(raw.get('skuReadStatuses') or {}).get(sku)
            row={'skuId':sku,'categoryId':selected['categoryId'],'upstreamName':source,'upstreamId':upstream.get('upstreamId'),'upstreamSku':upsku if isinstance(upsku,(str,type(None))) else None,'sameSkuIdentity':'unverified','requestStatus':'not_requested_upstream_not_confirmed'}
            if es_status is not None: row['esReadStatus']=es_status
            if summ.get('status')!='ok': row['requestStatus']='not_requested_summary_unavailable'
            elif source not in JD_NAMES: row['requestStatus']='not_requested_upstream_not_confirmed'
            elif es_status is not None and es_status != 'ok': row['requestStatus']='not_requested_es_unavailable'
            elif not valid_sku: row['requestStatus']='not_requested_exact_upstream_sku_missing_or_invalid'
            else: row['requestStatus']='pending'; eligible.add(upsku)
            rows.append(row)
    cached=vop_cache(eligible,out) if eligible else {}
    results={}
    for sku in eligible-set(cached):
        if (out/'raw'/'vop'/f'{sku}.json').exists(): raise RuntimeError('vop_receipt_conflict')
    for sku,receipt in cached.items():
        file=out/'raw'/'vop'/f'{sku}.json'
        if file.exists():
            existing=read_json(file)
            if existing.get('status')!='ok' or existing.get('request')!={'skuId':sku,'queryExtSet':VOP_QUERY_EXT} or not isinstance(existing.get('data'),dict) or str(existing['data'].get('skuId'))!=sku:
                raise RuntimeError('vop_receipt_conflict')
            receipt=existing
        else: save(file,receipt)
        results[sku]={'status':'ok','receipt':str(file),'fetchedAt':receipt.get('fetchedAt'),'cached':True,'cacheSource':receipt.get('cacheSource',str(file))}
    remaining=sorted(eligible-set(cached))
    fetched,started=fetch_vop(remaining,out,concurrency)
    results.update(fetched)
    for row in rows:
        if row['requestStatus']=='pending':
            result=results.get(row['upstreamSku'],{'status':'worker_incomplete'})
            row['requestStatus']=result['status']; row['receipt']=result.get('receipt'); row['fetchedAt']=result.get('fetchedAt'); row['cached']=result.get('cached',False)
            if result.get('cacheSource'): row['cacheSource']=result['cacheSource']
    output={'capturedAt':now(),'selectionSha256':manifest['selectionSha256'],'contractSha256':manifest['contractSha256'],'method':'jingdong.vop.goods.getSkuDetailInfo','queryExtSet':VOP_QUERY_EXT,'upstreamEligibility':'supply-chain upstreamName must explicitly identify JD and ES product.upstreamSku must be exact digits; local/imported source or digits alone are insufficient','sameSkuIdentityNote':'Exact upstream SKU is a lookup key, not independent verification that title, brand, and sold specification match. Review identity before using details.','jdUpstreamNames':sorted(JD_NAMES),'uniqueEligibleUpstreamSku':len(eligible),'cacheHits':len(cached),'networkRequestsPlanned':len(remaining),'networkRequests':len(started),'statusCounts':dict(Counter(r['requestStatus'] for r in rows)),'rows':rows,'productionWrites':0,'modelRequests':0}
    verify_frozen(out,contract_path,scope_path)
    if manifest.get('version') == 2 and hash_file(out/'collection'/'summary.json') != summary_receipt.get('summarySha256'):
        raise RuntimeError('frozen_summary_mismatch')
    save(target,output)
    print(json.dumps({'phase':'vop','eligibleUnique':len(eligible),'cacheHits':len(cached),'networkRequestsPlanned':len(remaining),'networkRequests':len(started),'statusCounts':output['statusCounts']},ensure_ascii=False),flush=True)

def do_source_link_audit(out,concurrency,audit_path,contract_path=None,scope_path=None):
    """Supplement separately: only exact JD links observed on the native SKU form."""
    target=out/'collection'/'source-link-demonstration.json'
    if target.exists(): raise RuntimeError('source_link_audit_already_collected')
    audit_path=audit_path.resolve(); audit=read_json(audit_path)
    if not isinstance(audit.get('rows'),list): raise RuntimeError('source_link_audit_invalid')
    selection,manifest=verify_frozen(out,contract_path,scope_path)
    selected={row['skuId'] for category in selection['categories'] for row in category['selected']}
    rows=[]; seen=set()
    for item in audit['rows']:
        fields=item.get('fields') or {}; link=fields.get('货源链接')
        if not link: continue
        sku=item.get('productId')
        if not isinstance(sku,str) or not UUID.fullmatch(sku) or sku in seen: raise RuntimeError('source_link_audit_invalid_sku')
        seen.add(sku)
        try:
            url=urlsplit(link) if isinstance(link,str) else None
            match=re.fullmatch(r'/([0-9]+)\.html',url.path) if url else None
            valid=bool(url and url.scheme=='https' and url.netloc.lower()=='item.jd.com' and match)
        except ValueError: valid=False; match=None
        # No domain guessing, redirects, or search results; only an exact item.jd.com form link.
        rows.append({'skuId':sku,'category':item.get('category'),'includedInFrozenSelection':sku in selected,'sourceLink':link if isinstance(link,str) else None,'jdSkuId':match.group(1) if valid else None,'uiObservedAt':audit.get('recordedAt'),'observedTitle':fields.get('商品名称'),'observedSaleSpec':fields.get('规格名称'),'sameSkuIdentity':'unverified','identityNote':'A link was observed on this SKU form, but its current JD item and sold specification still need comparison.'})
    if not rows: raise RuntimeError('source_link_audit_no_links')
    key=load_vars(JD_PROJECT/'.env',{'SANHENG_API_KEY'}).get('SANHENG_API_KEY')
    if not key: raise RuntimeError('summary_config_unavailable')
    ids=[row['skuId'] for row in rows]; batches=[ids[i:i+6] for i in range(0,len(ids),6)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as pool:
        summaries=list(pool.map(lambda batch:batch_summary(batch,key),batches))
    summary_map={r['skuId']:r for result in summaries for r in result['rows']}
    for row in rows:
        s=summary_map.get(row['skuId'],{'skuId':row['skuId'],'status':'unsupported_response','data':None})
        row['currentSummary']={'status':s['status'],'data':s.get('data')}
    eligible={r['jdSkuId'] for r in rows if r['jdSkuId']}; cached=vop_cache(eligible,out) if eligible else {}; results={}
    for sku,receipt in cached.items():
        file=out/'raw'/'vop'/f'{sku}.json'
        if file.exists():
            existing=read_json(file)
            if existing.get('status')!='ok' or str((existing.get('data') or {}).get('skuId'))!=sku: raise RuntimeError('vop_receipt_conflict')
        else: save(file,receipt)
        results[sku]={'status':'ok','receipt':str(file),'fetchedAt':receipt['fetchedAt'],'cached':True,'cacheSource':receipt['cacheSource']}
    fetched,started=fetch_vop(sorted(eligible-set(cached)),out,concurrency); results.update(fetched)
    for row in rows:
        row['vop']=results.get(row['jdSkuId'],{'status':'worker_incomplete'} if row['jdSkuId'] else {'status':'not_requested_invalid_or_non_jd_link'})
    output={'capturedAt':now(),'sourceAuditPath':str(audit_path),'sourceAuditSha256':hash_file(audit_path),'sourceAuditObservedAt':audit.get('recordedAt'),'selectionSha256':manifest['selectionSha256'],'contractSha256':manifest['contractSha256'],'purpose':'separate source-link demonstration; never changes frozen pilot denominator','qualification':'native SKU form contained an exact HTTPS item.jd.com/<digits>.html source link; no inference from local upstream numeric ID','queryExtSet':VOP_QUERY_EXT,'imageContentsRecognized':False,'uniqueJdSkuCount':len(eligible),'cacheHits':len(cached),'networkRequestsPlanned':len(eligible-set(cached)),'networkRequests':len(started),'statusCounts':dict(Counter(r['vop']['status'] for r in rows)),'rows':rows,'productionWrites':0,'modelRequests':0}
    save(target,output)
    print(json.dumps({'phase':'source_link_audit','rows':len(rows),'inFrozenSelection':sum(r['includedInFrozenSelection'] for r in rows),'networkRequests':len(started),'statusCounts':output['statusCounts']},ensure_ascii=False),flush=True)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--phase',choices=['selection','summary','vop','source-links','all'],default='all')
    p.add_argument('--out',type=Path,default=OUT)
    p.add_argument('--scope-manifest',type=Path,help='pinned real-root inventory and explicit frozen SKU list')
    p.add_argument('--contract',type=Path,help='frozen attribute contract; required with --scope-manifest')
    p.add_argument('--source-link-audit',type=Path,help='read-only prior native SKU form observation receipt')
    p.add_argument('--concurrency',type=int,default=6)
    p.add_argument('--execute',action='store_true')
    args=p.parse_args()
    if not 1<=args.concurrency<=12: p.error('concurrency must be 1..12')
    if args.phase=='source-links' and args.source_link_audit is None: p.error('--source-link-audit is required for source-links')
    if args.scope_manifest is not None and args.contract is None: p.error('--contract is required with --scope-manifest')
    inputs=load_frozen_scope(args.scope_manifest,args.contract) if args.scope_manifest else None
    if inputs:
        categories=[c['category'] for c in inputs['chosen']]
        root_id=inputs['scope']['rootCategoryId']
    else:
        _,categories=contract_info(args.contract); root_id=ROOT_CATEGORY_ID
    if not args.execute:
        example_ids=[r['skuId'] for r in inputs['chosen'][0]['selected'][:500]] if inputs else None
        print(json.dumps({'preflight':True,'phase':args.phase,'categories':categories,'esRequestExample':query_for(categories[0]['categoryId'],None,root_id,example_ids),'summaryFields':SUMMARY_FIELDS,'productionWrites':0},ensure_ascii=False));return
    if args.phase in ('selection','all'): do_selection(args.out,args.concurrency,args.contract,args.scope_manifest)
    if args.phase in ('summary','all'): do_summary(args.out,args.concurrency,args.contract,args.scope_manifest)
    if args.phase in ('vop','all'): do_vop(args.out,args.concurrency,args.contract,args.scope_manifest)
    if args.phase=='source-links': do_source_link_audit(args.out,args.concurrency,args.source_link_audit,args.contract,args.scope_manifest)

if __name__=='__main__':
    try: main()
    except Exception as error:
        # Exception strings may include URLs, credentials, or provider messages.
        print(json.dumps({'status':'read_failed','phase':'execution','errorType':type(error).__name__,'message':'Details omitted; no provider error or credentials logged.'}),file=sys.stderr)
        raise SystemExit(1)
