"""Read-only ES sampling. Reuse transport helpers, never old governance answers."""
import argparse, importlib.util, json, concurrent.futures
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
spec=importlib.util.spec_from_file_location("raw_source_transport",ROOT/"src/scenarios/product_governance/batch/collect.py")
transport=importlib.util.module_from_spec(spec);spec.loader.exec_module(transport)

def main():
 p=argparse.ArgumentParser();p.add_argument("--run",required=True);p.add_argument("--count",type=int,default=10);p.add_argument("--seed",type=int,default=20261020)
 args=p.parse_args();run=Path(args.run);categories=json.loads((run/"selected-categories.json").read_text())
 node,auth,key=transport.configuration()
 def one(c):
  output=run/"samples"/(c["id"]+".json")
  if output.exists():
   old=json.loads(output.read_text())
   if old["seed"]!=args.seed or old["requested"]!=args.count:raise RuntimeError("sample configuration changed")
   return {"category":c["name"],"count":len(old["products"]),"reused":True}
  body=transport.query(c["id"],args.count,args.seed)
  espath=run/"samples/raw"/(c["id"]+"-es.json")
  if espath.exists():
   es=json.loads(espath.read_text());assert es["query"]==body
  else:
   es={"query":body,"fetchedAt":transport.now(),"response":transport.post(f"{node}/{transport.INDEX}/_search",body,auth)}
   transport.save(espath,es)
  data=es["response"];assert not data.get("timed_out") and not data["_shards"]["failed"]
  hits=[r["_source"] for r in data["hits"]["hits"]]
  assert all(all(transport.source_checks(r,c["id"]).values()) for r in hits)
  ids=[r["id"] for r in hits];assert len(ids)==len(set(ids))
  dp=run/"samples/raw"/(c["id"]+"-details.json")
  if dp.exists():detail=json.loads(dp.read_text());assert detail["ids"]==ids
  else:
   detail={"ids":ids,"fetchedAt":transport.now(),"response":transport.redact_sensitive(transport.post(transport.DETAIL_ENDPOINT,{"skus":ids},key)) if ids else []}
   transport.save(dp,detail)
  detailby={r["sku"]:r for r in detail["response"]}
  products=[]
  for h in hits:
   d=detailby.get(h["id"],{})
   products.append({"id":h["id"],"title":d.get("title") or h.get("title") or "",
    "saleSpec":d.get("saleSpec") or "", "detailReturned":bool(d),
    "detailStatusConflicts":[k for k,v in {"spuSaleStatus":"ON_SALE","skuSaleStatus":"ON_SALE","isSpuEnable":True,"isSkuEnable":True}.items() if k in d and d[k]!=v],
    "sourceChecks":transport.source_checks(h,c["id"])})
  transport.save(output,{"category":c,"seed":args.seed,"requested":args.count,"population":data["hits"]["total"],"fetchedAt":es["fetchedAt"],
   "queryFile":str(espath.relative_to(run)),"detailFile":str(dp.relative_to(run)),
   "populationDefinition":"ES商品源source:system；非标准商品；未删除；SPU/SKU启用且ON_SALE；精确挂载类目",
   "products":products,"shortfall":max(0,args.count-len(products))})
  return {"category":c["name"],"count":len(products),"shortfall":max(0,args.count-len(products))}
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
  for row in pool.map(one,categories):print(json.dumps(row,ensure_ascii=False),flush=True)
if __name__=="__main__":main()
