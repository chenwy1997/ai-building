"""Remove unrequested OOXML sheet parts after artifact-tool authors the workbook.

Fallback only for worksheet removal, which this runtime does not document.
No cell values or formatting are authored here.
"""
import json
import posixpath
import zipfile
from pathlib import Path
from lxml import etree as E

ROOT = Path(__file__).resolve().parents[4]
rev = ROOT / "outputs/product-governance-v2/clean-paper-20261020/revisions/closure-r3"
file = rev / "清洁纸品21类完整属性卡与审核修订版.xlsx"
keep = json.loads((rev / "small-trial-five/pagination/delivery-keep-sheets.json").read_text())
with zipfile.ZipFile(file) as z:
    parts = {n: z.read(n) for n in z.namelist()}
ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
rel_ns = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
w = E.fromstring(parts["xl/workbook.xml"])
sheets = w.find(f"{{{ns}}}sheets")
names = [s.get("name") for s in sheets]
assert set(keep).issubset(names)
removed_ids, index_map = set(), {}
for old_index, s in enumerate(list(sheets)):
    if s.get("name") not in keep:
        removed_ids.add(s.get(f"{{{rel_ns}}}id"))
        sheets.remove(s)
    else:
        index_map[old_index] = len(index_map)
assert [s.get("name") for s in sheets] == keep
for v in w.findall(f".//{{{ns}}}workbookView"):
    v.set("activeTab", "0")
    v.set("firstSheet", "0")
defined = w.find(f"{{{ns}}}definedNames")
if defined is not None:
    for d in list(defined):
        index = d.get("localSheetId")
        if index is not None:
            if int(index) not in index_map:
                defined.remove(d)
            else:
                d.set("localSheetId", str(index_map[int(index)]))
parts["xl/workbook.xml"] = E.tostring(w, encoding="UTF-8", xml_declaration=True)
rels = E.fromstring(parts["xl/_rels/workbook.xml.rels"])
for r in list(rels):
    if r.get("Id") in removed_ids or r.get("Type", "").endswith("/calcChain"):
        rels.remove(r)
parts["xl/_rels/workbook.xml.rels"] = E.tostring(rels, encoding="UTF-8", xml_declaration=True)

# Retain package parts reachable from root relationships; removed sheet tables
# and other owned parts disappear, shared styles/media remain if still used.
reachable = {"[Content_Types].xml"}
queue = [""]
while queue:
    source = queue.pop()
    relpath = "_rels/.rels" if not source else posixpath.join(posixpath.dirname(source), "_rels", posixpath.basename(source) + ".rels")
    if relpath not in parts or relpath in reachable:
        continue
    reachable.add(relpath)
    for r in E.fromstring(parts[relpath]):
        if r.get("TargetMode") == "External":
            continue
        target = r.get("Target", "")
        target = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join(posixpath.dirname(source), target))
        assert target in parts, target
        if target not in reachable:
            reachable.add(target)
            queue.append(target)
types = E.fromstring(parts["[Content_Types].xml"])
for item in list(types):
    if item.tag.endswith("Override") and item.get("PartName", "").lstrip("/") not in reachable:
        types.remove(item)
parts["[Content_Types].xml"] = E.tostring(types, encoding="UTF-8", xml_declaration=True)
if "docProps/app.xml" in reachable:
    app = E.fromstring(parts["docProps/app.xml"])
    vt = "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"
    ep = "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
    titles = app.find(f"{{{ep}}}TitlesOfParts/{{{vt}}}vector")
    if titles is not None:
        for c in list(titles):
            titles.remove(c)
        titles.set("size", str(len(keep)))
        for name in keep:
            E.SubElement(titles, f"{{{vt}}}lpstr").text = name
    pairs = app.find(f"{{{ep}}}HeadingPairs/{{{vt}}}vector")
    if pairs is not None:
        children = list(pairs)
        for i in range(len(children) - 1):
            if children[i].findtext(f"{{{vt}}}lpstr") == "Worksheets":
                count = children[i + 1].find(f"{{{vt}}}i4")
                if count is not None:
                    count.text = str(len(keep))
    parts["docProps/app.xml"] = E.tostring(app, encoding="UTF-8", xml_declaration=True)
temp = file.with_suffix(".pending.xlsx")
with zipfile.ZipFile(temp, "w", compression=zipfile.ZIP_DEFLATED) as z:
    for n, content in parts.items():
        if n in reachable:
            z.writestr(n, content)
temp.replace(file)
print(json.dumps({"retainedSheets": len(keep), "names": keep}, ensure_ascii=False))
