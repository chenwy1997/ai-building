"""Build only the requested five-per-leaf appendix; never manufacture fill rates."""
import json,copy,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
root=ROOT/"outputs/product-governance-v2/clean-paper-20261020"
rev=root/"revisions/closure-r3";run=rev/"small-trial-five"
cards=json.loads((rev/"final-cards.json").read_text())
records=json.loads((run/"reused.json").read_text())
overrides=json.loads((run/"provisional-value-corrections.json").read_text()) if (run/"provisional-value-corrections.json").exists() else {}
decisions=[]
for r in records:
    r["origin"]="复用本日已完成试填并核对当前卡"
    if r["product"]["id"].startswith("eb843a1b"):
        v=next(v for v in r["values"] if v["attributeId"]=="color")
        v["value"]="";v["status"]="conflict"
        v["explanation"]="规格“黑心形+牙签筒”混有颜色、形状和配件，标题同时称透明纸盒；黑色究竟描述盒体还是心形装饰未明确，不将整段规格填颜色。原文仅保留为核对线索。"
        decisions.append({"id":r["product"]["id"],"attributeId":"color","reason":v["explanation"]})
    if r["product"]["id"].startswith("a0e7a638"):
        v=next(v for v in r["values"] if v["attributeId"]=="cat.kitchen_paper.inner_pack")
        v["value"]="6包/组";v["explanation"]="标题为6包×3组，每组6包；未据此猜袋/盒容器。修正模型原文“6包+包”的格式错误。"
        decisions.append({"id":r["product"]["id"],"attributeId":v["attributeId"],"reason":v["explanation"]})
for p in json.loads((run/"approved-new.json").read_text()):
    d=json.loads((run/"final-new"/(p["id"]+".json")).read_text())
    if d.get("reused"):
        d=d["record"]
        r={"product":p,"values":d["filled"]["values"],"evidence":d["evidence"],"category":d["filled"]["category"],"origin":"复用本日已有试填"}
    else:
        vs=[]
        for x in d["filled"]["values"]:
            x=copy.deepcopy(x)
            x.update(overrides.get(p["id"],{}).get(x["attributeId"],{}))
            # Codex decisions are exact-product, exact-field corrections.
            change=None
            if p["id"].startswith("a7dfebff") and x["attributeId"]=="attr.main_material":
                x["value"]="棉";change="标题仅称棉枕巾，不足以证明纯棉；保留棉为枚举外候选。"
            if p["id"].startswith("e74977a3") and x["attributeId"]=="attr.main_material":
                x["value"]="竹炭纤维";change="竹炭纤维不能无依据等同竹纤维；保留原文枚举外候选。"
            if p["id"].startswith("bf154d15") and x["attributeId"]=="attr.accessory_type":
                x["status"]="filled";x["value"]="擦手纸盒";change="标题明确不锈钢擦手纸盒；纸架为宽泛称呼，按规则保留具体主形态擦手纸盒。"
            if x["status"]!="filled" and x["value"]:
                x["reason"]+="；未确认候选："+x["value"];x["value"]=""
            if change:
                x["reason"]=change;decisions.append({"id":p["id"],"attributeId":x["attributeId"],"reason":change})
            vs.append({"attributeId":x["attributeId"],"status":x["status"],"value":x["value"],"evidence":[{"id":x["sourceId"],"quote":x["quote"]}] if x["sourceId"] and x["quote"] else [],"explanation":x["reason"],"calculation":{"formula":x["formula"]}})
        r={"product":p,"values":vs,"evidence":d["evidence"],"category":{"status":"provisional" if p.get("provisionalTrial") else "matched","reason":p["membershipReason"]},"origin":"DeepSeek小样本试填及一次复核，Codex异常裁定"}
    records.append(r)
assert len(records)==len({r["product"]["id"] for r in records})
enum_corrections=run/"enum-value-corrections.json"
if enum_corrections.exists():
    fixes=json.loads(enum_corrections.read_text())
    for r in records:
        for v in r["values"]:
            fix=fixes.get(r["product"]["id"],{}).get(v["attributeId"])
            if fix:
                v.update(fix)
                decisions.append({"id":r["product"]["id"],"attributeId":v["attributeId"],"reason":v["explanation"]})
# Keep a canonical evidence-backed input for scoped semantic migrations.
if not (rev/"naming-r1/base-records.json").exists():
    (rev/"naming-r1").mkdir(exist_ok=True)
    (rev/"naming-r1/base-records.json").write_text(json.dumps(records,ensure_ascii=False,indent=2))
if (rev/"naming-r1/migration.json").exists():
    migration=json.loads((rev/"naming-r1/migration.json").read_text())
    for r in records:
        changes=migration.get(r["product"]["id"])
        if changes:
            removed=set(changes["removeIds"])
            replaced={v["attributeId"] for v in changes["values"]}
            r["values"]=[v for v in r["values"] if v["attributeId"] not in removed|replaced]+changes["values"]
status={"filled":"已填写","missing":"缺少证据","conflict":"证据或口径冲突","not_applicable":"不适用","applicability_unknown":"适用条件待确认"}
req={"always":"必填","conditional":"条件必填","optional":"可选"}
report={"sheets":[],"overview":[],"products":len(records)}
for d in cards:
    c=d["category"];card=d["card"];rs=[r for r in records if r["product"]["categoryId"]==c["id"]];assert len(rs)<=5
    rows=[]
    for r in rs:
        p=r["product"];assert (r["category"]["status"]=="matched" or (r["category"]["status"]=="provisional" and p.get("provisionalTrial"))) and not p["detailStatusConflicts"]
        assert all(p["esStatusChecks"].values())
        ev={e["id"]:e for e in r["evidence"]}
        values={v["attributeId"]:v for v in r["values"]}
        assert set(values)=={a["id"] for a in card["attributes"]}
        for aid in [a for dim in card["dimensions"] for a in dim["attributeIds"]]:
            a=next(a for a in card["attributes"] if a["id"]==aid);b=next(b for b in card["bindings"] if b["attributeId"]==aid);v=values[aid]
            filled=v["status"]=="filled";value=v["value"] if filled else "";explanation=v["explanation"]
            if filled:
                assert v["evidence"],(p["id"],aid,"missing evidence")
                for e in v["evidence"]:assert e["id"] in ev and e["quote"] and e["quote"] in ev[e["id"]]["text"],(p["id"],aid,"invalid quote")
                if a["fieldType"]=="是否":
                    value={"true":"是","false":"否","是":"是","否":"否"}.get(value)
                    assert value is not None,(p["id"],aid,"bool")
                elif a["fieldType"]=="数值":
                    assert re.fullmatch(r"-?\d+(?:\.\d+)?",value),(p["id"],aid,"number")
                    value=float(value);value=int(value) if value.is_integer() else value
            enum=""
            if filled and a["fieldType"]=="选项":
                multi=not re.search("单选|不允许多值|不可多选",a["enumPolicy"]) and re.search("多值|多选|中文分号",a["enumPolicy"])
                parts=str(value).split("；") if multi else [str(value)]
                enum="枚举内" if all(x.strip() in a["enumValues"] for x in parts) else "枚举外候选"
            elif filled:enum="非枚举字段"
            sources=list(dict.fromkeys(ev[e["id"]].get("source","") for e in v["evidence"] if e["id"] in ev))
            rows.append([len(rows)+1,c["id"],c["path"],aid,a["name"],p["id"],p["title"],str(p["saleSpec"]),a["fieldType"],a["unit"],req[b["requiredness"]],status[v["status"]],value,enum,"；".join(a["enumValues"]),"\n".join(e["quote"] for e in v["evidence"]),"；".join(sources),explanation,v.get("calculation",{}).get("formula",""),r["category"].get("reason") or p.get("membershipReason","已核对当前类目主体与用途"),p["esFetchedAt"],p.get("cohort","历史随机样本")+"；"+r["origin"],"待运营审核","", "\n".join(ev[e["id"]].get("sourceRef",e["id"]) for e in v["evidence"] if e["id"] in ev)])
    candidates=10
    for folder in ["candidates","targeted"]:
        f=run/folder/(c["id"]+".json")
        if f.exists():candidates+=len(json.loads(f.read_text())["products"])
    note="每件商品按属性逐行展示。仅纳入确认归属匹配且ES快照在售的商品；缺证留空，枚举外真实值保留候选。"
    if c["name"] in ["一次性日杂","生活用纸"]:
        page_file=run/"pagination"/(c["id"]+".json")
        population=json.loads(page_file.read_text())["population"]
        candidates=population
        note=f"已逐页检索{population}件在售商品源，选取{len(rs)}件按当前挂载类目先试填。归属待运营确认，不阻断有证据的属性填写；枚举外值保留，证据冲突与缺项单独标明。本次不计算填充率。"
    if c["name"]=="擦手纸配件":note="本轮确认3件器具样本，尚缺2件；其余抽查候选多为海绵、湿巾等，排除不试填。"
    report["sheets"].append({"name":c["name"],"rows":rows,"note":note})
    report["overview"].append([c["name"],c["id"],5,len(rs),5-len(rs),candidates,note if len(rs)<5 else "已补齐5件。复用本日有效样本，不足部分随机候选筛选及关键词定向补样；非全类分布抽样。"])
ledger=json.loads((root/"ledger.json").read_text());cost=sum(e.get("charged") or 0 for e in ledger["entries"])
before=json.loads((run/"ledger-before.json").read_text()) if (run/"ledger-before.json").exists() else {"estimated":24.79388784}
report.update({"cumulativeCost":cost,"incrementCost":cost-before["estimated"],"note":"每类目标5件；复用本日样本并定向补样，非纯随机统计，不计算填充率。用户授权一次性日杂与生活用纸先按当前挂载试填，归属待运营确认，与属性值审核分开。已有同品京东证据沿用，不提取图片。"})
(run/"report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2))
(run/"codex-small-decisions.json").write_text(json.dumps(decisions,ensure_ascii=False,indent=2))
print(json.dumps({"products":len(records),"sheets":21,"rows":sum(len(s["rows"]) for s in report["sheets"]),"gaps":[[x[0],x[3],x[4]] for x in report["overview"] if x[4]],"incrementCost":report["incrementCost"]},ensure_ascii=False))
