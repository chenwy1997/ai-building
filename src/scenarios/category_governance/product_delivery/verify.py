"""Read-only, independent validation of the exported workbook and evidence joins."""
import json
import sys
import re
import zipfile
from pathlib import Path
from hashlib import sha256
import gzip
import openpyxl

baseline_root = Path(__file__).resolve().parent.parent / "workspace/output/v1/product-delivery-v1"
root = Path(sys.argv[1]).resolve() if len(sys.argv)>1 else baseline_root
products = json.loads((root / ".repro/resolved-products.json").read_text())
inputs = json.loads((baseline_root / ".repro/inputs.json").read_text())
details = json.loads(gzip.decompress((baseline_root / ".repro/jd-details.json.gz").read_bytes()))
wb = openpyxl.load_workbook(root / "比赛结果-1000商品.xlsx", read_only=True, data_only=False)
assert wb.sheetnames == ["商品挂载", "商品属性"]
mounts = list(wb["商品挂载"].values)
attrs = list(wb["商品属性"].values)
assert len(mounts) == 1001
assert len(attrs) == 1 + sum(len(p["filled"]) for p in products)
assert len({str(row[1]) for row in mounts[1:]}) == 1000
assert all(details["items"][p["sku"]]["status"] == "ok" for p in products)
assert all(str(details["items"][p["sku"]]["detail"]["skuId"]) == p["sku"] for p in products)
assert sha256(Path(inputs["source"]).read_bytes()).hexdigest() == inputs["sourceHash"]

def clean(s):
    if not isinstance(s, str): return s
    parts=re.split(r"([；。\n])",s)
    return "".join(part for i,part in enumerate(parts) if not re.search("codex",part,re.I) and not (i>0 and re.fullmatch(r"[；。\n]",part) and re.search("codex",parts[i-1],re.I))).lstrip("；。\n").rstrip("；\n")

def equal(actual, expected):
    expected = clean(expected)
    # Excel blank and JSON empty text mean the same thing; no numeric or text
    # coercion is allowed for SKU/model identifiers.
    return (actual if actual is not None else "") == (expected if expected is not None else "")

def value(v):
    return ("是" if v else "否") if isinstance(v, bool) else v

def required(a):
    return ("条件必填" if a.get("requiredWhenApplicable") else "条件选填") if a.get("condition") else ("必填" if a.get("required") else "选填")

attribute_row = 1
for p, original, mount in zip(products, inputs["products"], mounts[1:], strict=True):
    expected = [original[k] for k in ["row", "sku", "title", "variant", "price"]]
    assert all(equal(x, y) for x, y in zip(mount[:5], expected, strict=True)), p["row"]
    path = p["category"]["path"][1:]
    assert all(equal(mount[5+i], path[i] if i < len(path) else "") for i in range(4)), p["row"]
    assert mount[9] == p["category"]["id"]
    assert mount[10] == p["mappingStatus"]
    assert mount[11] == p["filledCount"]
    assert equal(mount[12], "；".join(p["requiredMissing"]))
    summary = "；".join(f'{x["name"]}：{value(x["value"])}' + (f' {x["unit"]}' if x["unit"] else "") for x in p["filled"] if x["status"] == "已填写")
    notes = [p["mappingNote"]] if p["mappingStatus"] != "末级已挂载" else []
    notes += [f'{name}存在资料冲突' for name in p["conflicts"]]
    assert equal(mount[13], summary)
    assert equal(mount[14], "；".join(notes))
    assert equal(mount[15], "；".join(f'{f["name"]}：{f["value"]}' for f in p["supplemental"]))
    for definition, a in zip(p["attributes"], p["filled"], strict=True):
        actual = attrs[attribute_row]
        expected = [p["row"], p["sku"], p["title"], " > ".join(path), a["name"], required(definition), value(a["value"]), a["unit"], a["quote"]]
        assert all(equal(x, y) for x, y in zip(actual[:9], expected, strict=True)), (attribute_row+1, actual, expected)
        assert equal(actual[10], a["templateUnit"])
        note = a["note"] + (f'；适用条件：{a["condition"]}' if a["condition"] and a["status"] == "已填写" else "")
        assert equal(actual[9], note), (p["row"],a["name"],actual[9],clean(note))
        attribute_row += 1

assert "信息来源" not in attrs[0] and "填写状态" not in attrs[0]
with zipfile.ZipFile(root / "比赛结果-1000商品.xlsx") as z:
    assert not any(re.search(rb"codex",z.read(n),re.I) for n in z.namelist() if n.endswith(".xml")), "工作簿存在禁止字样"

by_row = {p["row"]: p for p in products}
def a(row, name):
    return next(x for x in by_row[row]["filled"] if x["name"] == name)
assert a(83, "额定功率")["value"] == 5 and a(83, "额定功率")["unit"] == "kW"
assert a(263, "传输距离")["value"] == 2000
assert a(2, "净含量")["value"] == 2100
assert a(2, "保质期")["unit"] == "月" and a(2, "保质期")["templateUnit"] == "天"
assert a(75, "蒸盘数量")["value"] == 6
assert a(919, "是否带报警装置")["value"] is False
assert a(677, "视频分辨率")["source"].startswith("制造商官方")
assert a(3, "材质")["status"] == "资料冲突"
assert not by_row[525]["category"]["isLeaf"] and not by_row[734]["category"]["isLeaf"]
unchanged_count=None
if root != baseline_root:
    previous=json.loads((baseline_root / ".repro/resolved-products.json").read_text())
    unchanged_count=sum(a==b for a,b in zip(products,previous,strict=True))
    assert unchanged_count==705
    validation=json.loads((root / ".repro/validation.json").read_text())
    assert sha256((baseline_root / ".repro/resolved-products.json").read_bytes()).hexdigest()==validation["baselineHash"]
    expert=openpyxl.load_workbook(validation["templateSource"],read_only=True,data_only=False)
    definitions={}
    for row in list(expert["属性模板"].values)[1:]:
        key=tuple(str(x).strip() if x is not None else "" for x in row[:4])
        definitions.setdefault(key,[]).append(str(row[4]).strip())
    for p in products:
        if p["category"]["isLeaf"]:
            key=tuple(p["category"]["path"][1:])
            assert [a["name"] for a in p["attributes"]]==definitions[key],p["row"]
    expert.close()
report = {"unchangedProducts":unchanged_count,"sourceColumnRemoved":True,"statusColumnRemoved":True,"prohibitedTermAbsent":True,"products": len(products), "attributeRows": len(attrs)-1, "worksheets": wb.sheetnames, "allExportedValuesChecked": True, "originalFiveColumnsPreserved": True, "originalFileHashVerified": True, "skuEvidenceMatched": 1000, "issues": 0}
(root / ".repro/excel-verified.json").write_text(json.dumps(report, ensure_ascii=False))
print(json.dumps(report, ensure_ascii=False))
