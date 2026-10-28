"""Read-only, bounded own-source discovery. Do not return upstream or credentials."""
import argparse, base64, json, os, re, urllib.request
from datetime import datetime, timezone
from pathlib import Path

FIELDS = ['title', 'brand', 'standardCategory', 'isStdProduct', 'properties', 'attrs', 'spec', 'sku', 'productId', 'sourceName']
DENIED = re.compile(r'upstream|token|secret|password|authorization|credential|cookie', re.I)

def sanitize(value):
    if isinstance(value, dict):
        return {k: sanitize(v) for k, v in value.items() if not DENIED.search(k)}
    if isinstance(value, list):
        return [sanitize(v) for v in value]
    return value

def main():
    p = argparse.ArgumentParser(description=__doc__)
    group = p.add_mutually_exclusive_group(required=True)
    group.add_argument('--category-id')
    group.add_argument('--category-name')
    p.add_argument('--out', required=True)
    p.add_argument('--limit', type=int, default=100)
    p.add_argument('--env-file', action='append', default=[])
    p.add_argument('--index', default='uece-prod-sc_current')
    p.add_argument('--execute', action='store_true')
    a = p.parse_args()
    if not 1 <= a.limit <= 500 or not re.fullmatch(r'[a-zA-Z0-9_-]+', a.index):
        p.error('Invalid limit or index')
    query = {'term': {'standardCategory.id': a.category_id}} if a.category_id else {'match_phrase': {'standardCategory.name': a.category_name}}
    body = {'size': a.limit, 'track_total_hits': True, '_source': FIELDS, 'query': query}
    if not a.execute:
        print(json.dumps({'preflight': True, 'request': body, 'productionWrites': 0})); return
    values = {k: os.environ.get(k, '') for k in ['ES_NODE', 'ES_USERNAME', 'ES_PASSWORD']}
    for file in a.env_file:
        for line in Path(file).read_text().splitlines():
            m = re.match(r'^\s*(ES_NODE|ES_USERNAME|ES_PASSWORD)\s*=\s*(.*?)\s*$', line)
            if m and not values[m[1]]: values[m[1]] = m[2].strip('\"\'')
    if not all(values.values()): raise ValueError('Configuration unavailable')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    req = urllib.request.Request(values['ES_NODE'].rstrip('/') + '/' + a.index + '/_search', data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'Authorization': 'Basic ' + base64.b64encode((values['ES_USERNAME'] + ':' + values['ES_PASSWORD']).encode()).decode()}, method='POST')
    with opener.open(req, timeout=45) as response:
        data = response.read(10_000_001)
    if len(data) > 10_000_000: raise ValueError('Response exceeded bounded size')
    raw = json.loads(data)
    hits = [{'id': h['_id'], 'source': sanitize({k: v for k, v in h.get('_source', {}).items() if k in FIELDS})} for h in raw.get('hits', {}).get('hits', [])]
    result = {'capturedAt': datetime.now(timezone.utc).isoformat(), 'query': body, 'total': raw.get('hits', {}).get('total'), 'hits': hits, 'mappingStatus': 'exact_id_query' if a.category_id else 'name_discovery_requires_id_and_path_confirmation', 'productionWrites': 0}
    output = Path(a.out)
    if output.exists(): raise ValueError('Output exists; choose a new receipt path')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps({'output': str(output), 'returned': len(hits), 'productionWrites': 0}))

if __name__ == '__main__':
    try: main()
    except Exception as e:
        print(json.dumps({'status': 'read_failed', 'errorType': type(e).__name__, 'message': 'Provider response and credentials omitted'}))
        raise SystemExit(1)
