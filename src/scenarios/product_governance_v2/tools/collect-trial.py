"""Reuse today's raw pilot evidence and supplement tissue-box candidates from ES.
No images or previous filled attribute answers enter the model inputs.
"""
import argparse, importlib.util, json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
spec=importlib.util.spec_from_file_location("transport",ROOT/"src/scenarios/product_governance/batch/collect.py")
t=importlib.util.module_from_spec(spec);spec.loader.exec_module(t)

def compact(c,es,details,cohort,esref,detailref):
 by={p["sku"]:p for p in details["response"]}
 out=[]
 for rank,h in enumerate(es["response"]["hits"]["hits"]):
  raw=h["_source"];d=by.get(raw["id"],{})
  assert all(t.source_checks(raw,c["id"]).values())
  p=t.compact(raw,d,c,rank,es["fetchedAt"],details["fetchedAt"])
  p.pop("images",None);p["cohort"]=cohort;p["detailReturned"]=bool(d)
  p["evidenceNotes"]=["本轮未读取或解析任何图片。"]
  for e in p["evidence"]:e["sourceRef"]=(esref if e["source"]=="es" else detailref)+"#"+p["id"]+"/"+e["field"]
  out.append(p)
 return out

def main():
 a=argparse.ArgumentParser();a.add_argument("--run",required=True);a.add_argument("--count",type=int,default=60);a.add_argument("--seed",type=int,default=2026102002)
 args=a.parse_args();run=Path(args.run).resolve();trial=run/"trial";trial.mkdir(exist_ok=True)
 cats=json.loads((run/"selected-categories.json").read_text());products=[]
 for c in cats:
  ep=run/"samples/raw"/(c["id"]+"-es.json");dp=run/"samples/raw"/(c["id"]+"-details.json")
  products+=compact(c,json.loads(ep.read_text()),json.loads(dp.read_text()),"原10件随机样本",str(ep),str(dp))
 box=next(c for c in cats if c["name"]=="纸巾盒")
 node,auth,key=t.configuration();body=t.query(box["id"],args.count,args.seed)
 body["query"]["function_score"]["query"]["bool"]["must_not"].append({"terms":{"id":[p["id"] for p in products]}})
 ep=trial/"raw/box-extra-es.json";dp=trial/"raw/box-extra-details.json"
 if ep.exists():
  es=json.loads(ep.read_text());assert es["query"]==body
 else:
  es={"query":body,"fetchedAt":t.now(),"response":t.post(f"{node}/{t.INDEX}/_search",body,auth)};t.save(ep,es)
 assert not es["response"].get("timed_out") and not es["response"]["_shards"]["failed"]
 ids=[h["_source"]["id"] for h in es["response"]["hits"]["hits"]]
 if dp.exists():
  details=json.loads(dp.read_text());assert details["ids"]==ids
 else:
  details={"ids":ids,"fetchedAt":t.now(),"response":t.redact_sensitive(t.post(t.DETAIL_ENDPOINT,{"skus":ids},key))};t.save(dp,details)
 products+=compact(box,es,details,"补抽候选（筛选后补足10件有效）",str(ep),str(dp))
 assert len({p["id"] for p in products})==len(products)
 t.save(trial/"products.json",products)
 t.save(trial/"sampling.json",{"seed":args.seed,"supplementCandidates":len(ids),"originalSamples":30,"validBoxTarget":10,"allCandidates":len(products),"imageExtraction":False,
 "populationDefinition":"ES商品源source:system、精确挂载类目、非标准商品、未删除、SPU/SKU启用且在售；详情状态冲突者排除。",
 "limitation":"纸巾盒补样按语义归属筛选，仅用于属性试验，不用于估算全类错挂率。"})
 print(json.dumps({"original":30,"boxCandidates":len(ids),"total":len(products)},ensure_ascii=False))
if __name__=="__main__":main()
