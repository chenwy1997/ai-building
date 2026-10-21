"""Exhaust the two unresolved leaves, retaining each ES and detail page."""
import concurrent.futures
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
spec = importlib.util.spec_from_file_location("compact_source", Path(__file__).with_name("collect-trial.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
t = m.t
rev = ROOT / "outputs/product-governance-v2/clean-paper-20261020/revisions/closure-r3"
out = rev / "small-trial-five/pagination"
cards = json.loads((rev / "final-cards.json").read_text())
node, auth, key = t.configuration()


def collect(d):
    c = d["category"]
    products, seen, cursor, page, total = [], set(), None, 0, None
    while True:
        page += 1
        body = t.query(c["id"], 50, 2026102007)
        body["query"] = body["query"]["function_score"]["query"]
        body["sort"] = [{"id": "asc"}]
        if cursor is not None:
            body["search_after"] = cursor
        ep = out / "raw" / f"{c['id']}-{page:03d}-es.json"
        dp = out / "raw" / f"{c['id']}-{page:03d}-details.json"
        if ep.exists():
            es = json.loads(ep.read_text())
            assert es["query"] == body
        else:
            es = {"query": body, "fetchedAt": t.now(), "response": t.post(f"{node}/{t.INDEX}/_search", body, auth)}
            t.save(ep, es)
        response = es["response"]
        assert not response.get("timed_out") and not response["_shards"]["failed"]
        hits = response["hits"]["hits"]
        assert response["hits"]["total"]["relation"] == "eq"
        population = response["hits"]["total"]["value"]
        if total is None:
            total = population
        assert population == total, "Population changed during pagination; do not claim exhaustive coverage."
        ids = [h["_source"]["id"] for h in hits]
        assert not seen.intersection(ids) and len(ids) == len(set(ids))
        if dp.exists():
            details = json.loads(dp.read_text())
            assert details["ids"] == ids
        else:
            details = {"ids": ids, "fetchedAt": t.now(), "response": t.redact_sensitive(t.post(t.DETAIL_ENDPOINT, {"skus": ids}, key)) if ids else []}
            t.save(dp, details)
        products.extend(m.compact(c, es, details, "按商品源ID逐页完整检索后筛选（非随机抽样）", str(ep), str(dp)))
        seen.update(ids)
        print(json.dumps({"category": c["name"], "page": page, "read": len(seen), "total": total}, ensure_ascii=False), flush=True)
        if len(seen) == total:
            break
        assert hits, "Unexpected empty page before total reached."
        cursor = hits[-1]["sort"]
    result = {"category": c, "population": total, "pages": page, "pageSize": 50, "uniqueProducts": len(seen), "exhausted": True, "products": products,
              "limitation": "本次固定在售筛选口径、精确末级挂载；每页总数一致且去重计数等于总数。非跨页事务快照，不代表全站或下架商品数量。"}
    t.save(out / (c["id"] + ".json"), result)


with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    list(pool.map(collect, [d for d in cards if d["category"]["name"] in ["一次性日杂", "生活用纸"]]))
