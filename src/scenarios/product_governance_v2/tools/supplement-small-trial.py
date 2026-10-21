"""One bounded keyword supplement when random candidates cannot supply five matches."""
import importlib.util,json,concurrent.futures
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
spec=importlib.util.spec_from_file_location("compact_source",Path(__file__).with_name("collect-trial.py"))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);t=m.t
rev=ROOT/"outputs/product-governance-v2/clean-paper-20261020/revisions/closure-r3";run=rev/"small-trial-five"
cards=json.loads((rev/"final-cards.json").read_text())
terms={"中心抽大卷纸":["中心抽"],"盒装抽纸":["盒抽","盒装","盒"],"卷纸配件":["卷纸架","分配器","卷纸盒"],"大卷擦手纸":["卷筒擦手","大盘擦手","卷擦手"],"餐巾纸":["餐饮","饭店","餐厅","正方形"],"枕巾":["枕巾"]}
existing=json.loads((run/"approved-new.json").read_text())+[r["product"] for r in json.loads((run/"reused.json").read_text())]
node,auth,key=t.configuration()
def one(name):
    c=next(d["category"] for d in cards if d["category"]["name"]==name)
    body=t.query(c["id"],20,2026102006);b=body["query"]["function_score"]["query"]["bool"]
    b["must_not"].append({"terms":{"id":[p["id"] for p in existing]}})
    b["must"]=[{"bool":{"should":[{"match_phrase":{"title":s}} for s in terms[name]],"minimum_should_match":1}}]
    ep=run/"targeted-raw"/(c["id"]+"-es.json");dp=run/"targeted-raw"/(c["id"]+"-details.json")
    if ep.exists():es=json.loads(ep.read_text());assert es["query"]==body
    else:es={"query":body,"fetchedAt":t.now(),"response":t.post(f"{node}/{t.INDEX}/_search",body,auth)};t.save(ep,es)
    assert not es["response"].get("timed_out") and not es["response"]["_shards"]["failed"]
    ids=[h["_source"]["id"] for h in es["response"]["hits"]["hits"]]
    if dp.exists():de=json.loads(dp.read_text())
    else:de={"ids":ids,"fetchedAt":t.now(),"response":t.redact_sensitive(t.post(t.DETAIL_ENDPOINT,{"skus":ids},key)) if ids else []};t.save(dp,de)
    ps=m.compact(c,es,de,"关键词定向补样（非纯随机）",str(ep),str(dp))
    t.save(run/"targeted"/(c["id"]+".json"),{"category":c,"products":ps,"population":es["response"]["hits"]["total"]})
    print(json.dumps({"name":name,"products":[{"id":p["id"],"title":p["title"]} for p in ps]},ensure_ascii=False),flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(one,terms))
