"""Bounded supplementary sampling for the requested five-per-leaf trial."""
import importlib.util,json,concurrent.futures
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
spec=importlib.util.spec_from_file_location("compact_source",Path(__file__).with_name("collect-trial.py"))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
t=m.t
run=ROOT/"outputs/product-governance-v2/clean-paper-20261020"
rev=run/"revisions/closure-r3"
out=rev/"small-trial-five"
old=json.loads((rev/"product-trial/candidate-final.json").read_text())
cards=json.loads((rev/"final-cards.json").read_text())
chosen=[];needs=[]
for d in cards:
    candidates=[r for r in old if r["product"]["categoryId"]==d["category"]["id"] and r["eligible"] and not r["errors"]]
    candidates.sort(key=lambda r:r["product"].get("sampleRank",0))
    chosen+=candidates[:5]
    if len(candidates)<5:needs.append({"category":d["category"],"need":5-len(candidates)})
t.save(out/"reused.json",chosen)
t.save(out/"needs.json",needs)
node,auth,key=t.configuration()
def collect(n):
    c=n["category"];ep=out/"raw"/(c["id"]+"-es.json");dp=out/"raw"/(c["id"]+"-details.json")
    body=t.query(c["id"],50,2026102005)
    body["query"]["function_score"]["query"]["bool"]["must_not"].append({"terms":{"id":[r["product"]["id"] for r in chosen]}})
    if ep.exists():es=json.loads(ep.read_text());assert es["query"]==body
    else:
        es={"query":body,"fetchedAt":t.now(),"response":t.post(f"{node}/{t.INDEX}/_search",body,auth)}
        t.save(ep,es)
    assert not es["response"].get("timed_out") and not es["response"]["_shards"]["failed"]
    ids=[h["_source"]["id"] for h in es["response"]["hits"]["hits"]]
    if dp.exists():detail=json.loads(dp.read_text());assert detail["ids"]==ids
    else:
        detail={"ids":ids,"fetchedAt":t.now(),"response":t.redact_sensitive(t.post(t.DETAIL_ENDPOINT,{"skus":ids},key)) if ids else []}
        t.save(dp,detail)
    products=m.compact(c,es,detail,"本轮补抽候选",str(ep),str(dp))
    t.save(out/"candidates"/(c["id"]+".json"),{"category":c,"need":n["need"],"population":es["response"]["hits"]["total"],"products":products})
    return {"category":c["name"],"need":n["need"],"candidates":len(products)}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    for v in pool.map(collect,needs):print(json.dumps(v,ensure_ascii=False),flush=True)
print("reused",len(chosen))
