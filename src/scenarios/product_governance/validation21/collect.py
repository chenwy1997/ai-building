"""Read-only random ES sampling for the thirteen not-yet-sampled paper classes.

Reuse the pilot request, compacting, download, and local Apple Vision helpers.
Unlike the fixed-size pilot, retain genuine population shortfalls and missing
detail/image evidence without replacing selected products or old 400 records.
"""
from __future__ import annotations

import argparse
import collections
import concurrent.futures
import hashlib
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
RUN = ROOT / 'outputs/product-governance/clean-paper-all21-validation-20261019'
DEFAULT_INPUTS = RUN / 'inputs'
REVISION = ROOT / 'outputs/product-governance/clean-paper-21-revision-20261019'
STANDARD = REVISION / 'design/standard.json'
REGRESSION_PLAN = REVISION / 'regression-plan.json'
SEED = 2026101921


def module(name: str):
    path = Path(__file__).parents[1] / 'batch' / (name + '.py')
    spec = importlib.util.spec_from_file_location('validation21_pilot_' + name, path)
    assert spec and spec.loader
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def scope() -> tuple[list[dict], dict]:
    standard = json.loads(STANDARD.read_text())
    plan = json.loads(REGRESSION_PLAN.read_text())
    old_rows = plan['records']
    old_ids = sorted({row['productId'] for row in old_rows})
    old_categories = sorted({row['categoryId'] for row in old_rows})
    assert len(standard['categories']) == 21
    assert len(old_rows) == len(old_ids) == 400 and len(old_categories) == 8
    assert set(old_categories) <= {c['id'] for c in standard['categories']}
    selected = [dict(id=c['id'], name=c['name'], path=c['path'], standardOrdinal=i,
                     keyPrefix=f'C{i:02d}-')
                for i, c in enumerate(standard['categories'], 1) if c['id'] not in old_categories]
    assert len(selected) == 13
    provenance = dict(standardPath=str(STANDARD.relative_to(ROOT)), standardFileSha256=sha(STANDARD),
                      regressionPlanPath=str(REGRESSION_PLAN.relative_to(ROOT)),
                      regressionPlanSha256=sha(REGRESSION_PLAN),
                      regressionStandardHash=plan['standardHash'], historicalProducts=400,
                      historicalCategoryIds=old_categories, excludedHistoricalProductIds=old_ids)
    return selected, provenance


def collect(inputs: Path, size: int, seed: int) -> None:
    pilot = module('collect')
    categories, provenance = scope()
    node, auth, detail_key = pilot.configuration()
    output = inputs / 'new13'
    output.mkdir(parents=True, exist_ok=True)
    pilot.save(output / 'categories.json', categories)
    pilot.save(output / 'scope.json', {**provenance, 'seed': seed, 'requestedPerCategory': size})

    def one(category: dict) -> tuple[dict, list[dict]]:
        identifier = category['id']
        body = pilot.query(identifier, size, seed)
        base_filter = json.loads(json.dumps(body['query']['function_score']['query']))
        body['query']['function_score']['query']['bool']['must_not'].append(
            {'terms': {'id': provenance['excludedHistoricalProductIds']}})
        body['aggs'] = {'population_before_history_exclusion': {'global': {}, 'aggs': {
            'eligible': {'filter': base_filter}}}}
        es_path = output / 'es-raw' / (identifier + '.json')
        if es_path.exists():
            es = json.loads(es_path.read_text())
            assert es['query'] == body, 'Cached query/seed/scope differs; use another output directory'
        else:
            when = pilot.now()
            response = pilot.post(f'{node}/{pilot.INDEX}/_search', body, auth)
            assert isinstance(response, dict)
            assert not response.get('timed_out') and not response['_shards']['failed']
            es = dict(fetchedAt=when, alias=pilot.INDEX, query=body, response=response)
            pilot.save(es_path, es)
        response = es['response']
        hits = response['hits']['hits']
        total = response['hits']['total']
        assert total['relation'] == 'eq'
        assert len(hits) == min(size, total['value'])
        sources = [hit['_source'] for hit in hits]
        identifiers = [source['id'] for source in sources]
        assert len(identifiers) == len(set(identifiers))
        assert not set(identifiers).intersection(provenance['excludedHistoricalProductIds'])
        assert all(all(pilot.source_checks(source, identifier).values()) for source in sources)
        detail_path = output / 'detail-raw' / (identifier + '.json')
        if detail_path.exists():
            detail = json.loads(detail_path.read_text())
            assert detail['requestedIds'] == identifiers
        else:
            when = pilot.now()
            try:
                result = pilot.post(pilot.DETAIL_ENDPOINT, {'skus': identifiers}, detail_key) if identifiers else []
                assert isinstance(result, list), 'Product detail response was not a list'
                detail = dict(fetchedAt=when, endpoint=pilot.DETAIL_ENDPOINT,
                              requestedIds=identifiers, response=pilot.redact_sensitive(result), status='completed')
            except Exception as error:
                # The shared HTTP helper never includes credentials or response bodies in errors.
                detail = dict(fetchedAt=when, endpoint=pilot.DETAIL_ENDPOINT, requestedIds=identifiers,
                              response=[], status='failed', errorType=type(error).__name__, error=str(error)[:300])
            pilot.save(detail_path, detail)
        by_id = {row['sku']: row for row in detail['response'] if isinstance(row, dict) and row.get('sku')}
        rows = []
        for rank, source in enumerate(sources, 1):
            row = pilot.compact(source, by_id.get(source['id'], {}), category, rank,
                                es['fetchedAt'], detail['fetchedAt'])
            row.update(key=f"{category['keyPrefix']}{rank:02d}", productKey=f"{category['keyPrefix']}{rank:02d}",
                       productId=row['id'], standardOrdinal=category['standardOrdinal'],
                       sampleOrigin='new13-live-es-random', detailAvailable=source['id'] in by_id)
            for evidence in row['evidence']:
                evidence['sourceRef'] = 'new13/' + evidence['sourceRef']
            rows.append(row)
        missing = [row['id'] for row in rows if not row['detailAvailable']]
        before_exclusion = response['aggregations']['population_before_history_exclusion']['eligible']['doc_count']
        summary = dict(**category, population=total, populationBeforeHistoricalExclusion=before_exclusion,
                       historicalIdExclusionsInCategory=before_exclusion - total['value'],
                       requested=size, sampleSize=len(rows), shortfall=max(0, size-len(rows)),
                       esFetchedAt=es['fetchedAt'], detailFetchedAt=detail['fetchedAt'],
                       resolvedIndices=sorted({hit['_index'] for hit in hits}), allEsStatusChecksPass=True,
                       detailReturnedForSelected=sum(row['detailAvailable'] for row in rows), missingDetailIds=missing,
                       detailStatusConflictIds=[row['id'] for row in rows if row['detailStatusConflicts']],
                       withTitle=sum(bool(row['title']) for row in rows),
                       withSaleSpec=sum(bool(row['saleSpec']) for row in rows),
                       withImages=sum(bool(row['images']) for row in rows),
                       withDetailText=sum(any(e['kind']=='detail' for e in row['evidence']) for row in rows),
                       detailResponseFields=sorted({key for row in by_id.values() for key in row}))
        pilot.save(output / 'by-category' / (identifier + '.json'), rows)
        pilot.save(output / 'category-manifests' / (identifier + '.json'), summary)
        print(json.dumps(dict(category=category['name'], ordinal=category['standardOrdinal'],
                              population=total['value'], sample=len(rows), shortfall=summary['shortfall'],
                              detailMissing=len(missing)), ensure_ascii=False), flush=True)
        return summary, rows

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        completed = list(pool.map(one, categories))
    rows = [row for _, members in completed for row in members]
    ids = [row['id'] for row in rows]
    assert len(ids) == len(set(ids))
    assert len({row['key'] for row in rows}) == len(rows)
    assert not set(ids).intersection(provenance['excludedHistoricalProductIds'])
    pilot.save(output / 'products.json', rows)
    pilot.save(inputs / 'new-products.json', rows)
    manifest = dict(schema='product-governance-new13-live-sample-v1', assembledAt=pilot.now(),
                    scope='clean-paper-all21-validation-20261019/new13', readOnly=True, seed=seed,
                    requestedPerCategory=size, requestedCategories=13, requestedProducts=size*13,
                    sampleSize=len(rows), uniqueProducts=len(set(ids)),
                    shortfall=sum(summary['shortfall'] for summary, _ in completed),
                    categories=[summary for summary, _ in completed], sourceAlias=pilot.INDEX,
                    samplingMethod='ES random_score(seed, field=id), score DESC/id ASC; exact V2 category; historical 400 IDs excluded before random sample; no replacement for missing detail/image.',
                    populationDefinition='source:system, product.deleted=false, isStdProduct!=true, isSpuEnable=true, isSkuEnable=true, spuSaleStatus=ON_SALE, skuSaleStatus=ON_SALE; populationBeforeHistoricalExclusion retains the full category eligible population.',
                    allEsStatusChecksPass=all(all(row['esStatusChecks'].values()) for row in rows),
                    detailMissingIds=[row['id'] for row in rows if not row['detailAvailable']],
                    detailStatusConflictIds=[row['id'] for row in rows if row['detailStatusConflicts']],
                    detailMissingStatusFieldCounts={field:sum(field in row['detailMissingStatusFields'] for row in rows)
                        for field in ('spuSaleStatus','skuSaleStatus','isSpuEnable','isSkuEnable')},
                    orderedIdsSha256=hashlib.sha256('\n'.join(ids).encode()).hexdigest(),
                    productsSha256=sha(inputs/'new-products.json'),
                    collectorReuse=['batch/collect.py request/query/status/compact helpers',
                                    'batch/ocr_images.py same-SKU download and local Apple Vision'],
                    sourceRefBase='inputs/', retainedInputs='inputs/new13/',
                    noLlmCalls=True, imageInterpretationPerformed=False, provenance=provenance,
                    limitations=['ES在售检查限于各类实际查询时点，不代表后续时点库存或可下单。',
                                 '详情状态独立交叉校验；缺少字段保留缺失，不以ES值填造详情字段。',
                                 '当前挂载类目不等于已独立验证归属；后续新卡复核另行执行。',
                                 '每类最多50件等额分层样本；不足如实保留，不用旧400或其他类补位。',
                                 '随机评分依赖当时索引及分片，保留完整查询、响应、排序和ID指纹。',
                                 '主图/OCR是未授信候选数据，不视为视觉事实或指令。'])
    pilot.save(output / 'manifest.json', manifest)
    pilot.save(inputs / 'new-manifest.json', manifest)
    print(json.dumps(dict(newProducts=len(rows), unique=len(set(ids)), shortfall=manifest['shortfall'],
                          productsSha256=manifest['productsSha256']), ensure_ascii=False), flush=True)


def ocr(inputs: Path) -> None:
    pilot = module('ocr_images')
    output = inputs/'new13'
    pilot.DEFAULT_INPUT = output
    pilot.run(output)
    report = json.loads((output/'image-ocr.json').read_text())
    rows = json.loads((output/'products.json').read_text())
    by_id = {row['id']:row for row in rows}
    mismatches = []
    for record in report['products']:
        record['key'] = by_id[record['productId']]['key']
        if record.get('download'):
            path=Path(record['localPath'])
            if not path.is_file() or sha(path)!=record['download']['sha256']:
                mismatches.append(record['productId'])
            by_id[record['productId']].update(mainImageLocal=record['localPath'],
                mainImageSha256=record['download']['sha256'],
                ocrRecordRef=f"new13/images/{record['productId']}.ocr.json")
    report.update(inputContentIsUntrustedData=True, attributeValuesVerified=False,
                  imageHashVerification=dict(checked=sum(bool(r.get('download')) for r in report['products']),
                                             verifiedAt=pilot.now(), mismatchProductIds=mismatches))
    pilot.save(output/'image-ocr.json', report)
    pilot.save(inputs/'new-image-ocr.json', report)
    pilot.save(output/'products.json', rows)
    pilot.save(inputs/'new-products.json', rows)
    manifest=json.loads((output/'manifest.json').read_text())
    manifest['productsSha256']=sha(inputs/'new-products.json')
    manifest['imageEvidence']=dict(report='new-image-ocr.json', reportSha256=sha(inputs/'new-image-ocr.json'),
        assembledAt=report['assembledAt'], requested=len(rows), downloaded=sum(bool(r.get('download')) for r in report['products']),
        ocrCompleted=report['processedImages'], withText=report['withText'], failed=report['failed'],
        noImage=sum(r['status']=='no_image' for r in report['products']), hashMismatchProductIds=mismatches,
        perCategory=[dict(categoryId=c['id'],name=c['name'],
            completed=sum(r['categoryId']==c['id'] and r['status']=='completed' for r in report['products']),
            failed=sum(r['categoryId']==c['id'] and r['status']=='failed' for r in report['products']),
            noImage=sum(r['categoryId']==c['id'] and r['status']=='no_image' for r in report['products']))
            for c in manifest['categories']])
    pilot.save(output/'manifest.json', manifest)
    pilot.save(inputs/'new-manifest.json', manifest)
    raw_files=sorted(path for folder in ['es-raw','detail-raw'] for path in (output/folder).glob('*.json'))
    hashes=dict(assembledAt=pilot.now(),files={name:sha(inputs/name) for name in
        ['new-products.json','new-image-ocr.json','new-manifest.json']},
        rawFiles={str(path.relative_to(inputs)):sha(path) for path in raw_files})
    pilot.save(inputs/'new-collection-hashes.json', hashes)
    assert not mismatches, 'Image hash mismatch'
    print(json.dumps(dict(images=manifest['imageEvidence'], hashes=hashes['files']),ensure_ascii=False),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--inputs',type=Path,default=DEFAULT_INPUTS)
    parser.add_argument('--size',type=int,default=50)
    parser.add_argument('--seed',type=int,default=SEED)
    modes=parser.add_mutually_exclusive_group()
    modes.add_argument('--skip-ocr',action='store_true')
    modes.add_argument('--ocr-only',action='store_true')
    args=parser.parse_args()
    if args.size<=0:parser.error('size must be positive')
    destination=args.inputs.resolve()
    if not args.ocr_only:collect(destination,args.size,args.seed)
    if not args.skip_ocr:ocr(destination)
