"""Supplement Artifact Tool's missing native hyperlink API with standard OOXML only."""
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlparse, unquote

S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
P = "http://schemas.openxmlformats.org/package/2006/relationships"
ET.register_namespace("", S)
ET.register_namespace("r", R)
path, manifest = sys.argv[1:]
links = json.loads(Path(manifest).read_text())
with zipfile.ZipFile(path) as archive:
    parts = {info.filename: (info, archive.read(info.filename)) for info in archive.infolist()}
for sheet in sorted({link["sheet"] for link in links}):
    sheet_path = f"xl/worksheets/sheet{sheet}.xml"
    root = ET.fromstring(parts[sheet_path][1])
    assert root.find(f"{{{S}}}hyperlinks") is None
    nodes = ET.Element(f"{{{S}}}hyperlinks")
    rel_path = f"xl/worksheets/_rels/sheet{sheet}.xml.rels"
    rels = ET.fromstring(parts[rel_path][1]) if rel_path in parts else ET.Element(f"{{{P}}}Relationships")
    for index, link in enumerate(link for link in links if link["sheet"] == sheet):
        assert re.fullmatch(r"[A-Z]+[1-9][0-9]*", link["cell"])
        cell = root.find(f".//{{{S}}}c[@r='{link['cell']}']")
        assert cell is not None and cell.find(f"{{{S}}}f") is None
        attrs = {"ref": link["cell"], "display": link["label"]}
        if "location" in link:
            assert re.fullmatch(r"'原文材料'!C[1-9][0-9]*", link["location"])
            attrs["location"] = link["location"]
        else:
            target = urlparse(link["target"])
            assert target.scheme == "file" and Path(unquote(target.path)).is_file()
            rid = "pgv3NativeLink" + str(index + 1)
            assert all(r.attrib.get("Id") != rid for r in rels)
            # WPS on macOS fails to resolve file:/// relationships here; a workbook-relative
            # target is portable with the review folder and is understood by its file opener.
            relative = Path(unquote(target.path)).resolve().relative_to(Path(path).resolve().parent)
            ET.SubElement(rels, f"{{{P}}}Relationship", {"Id": rid, "Type": R + "/hyperlink", "Target": relative.as_posix(), "TargetMode": "External"})
            attrs[f"{{{R}}}id"] = rid
        ET.SubElement(nodes, f"{{{S}}}hyperlink", attrs)
    # CT_Worksheet places hyperlinks after validation/merge/conditional nodes and before print/page/drawings.
    after = {"printOptions", "pageMargins", "pageSetup", "headerFooter", "rowBreaks", "colBreaks", "customProperties", "cellWatches", "ignoredErrors", "smartTags", "drawing", "legacyDrawing", "legacyDrawingHF", "picture", "oleObjects", "controls", "webPublishItems", "tableParts", "extLst"}
    position = next((i for i, child in enumerate(root) if child.tag.split("}")[-1] in after), len(root))
    root.insert(position, nodes)
    parts[sheet_path] = (parts[sheet_path][0], ET.tostring(root, encoding="utf-8", xml_declaration=True))
    if list(rels):
        parts[rel_path] = (parts.get(rel_path, (zipfile.ZipInfo(rel_path), b""))[0], ET.tostring(rels, encoding="utf-8", xml_declaration=True))
# Verify all cached error cells, including unsupported-function strings outside #NAME? patterns.
for filename, (_, data) in parts.items():
    if re.fullmatch(r"xl/worksheets/sheet[0-9]+\.xml", filename):
        root = ET.fromstring(data)
        assert not root.findall(f".//{{{S}}}c[@t='e']"), "export contains cached spreadsheet errors"
tmp = path + ".native-links.tmp"
with zipfile.ZipFile(tmp, "w") as archive:
    for info, data in parts.values():
        archive.writestr(info, data)
os.replace(tmp, path)
print(json.dumps({"nativeHyperlinks": len(links), "cachedErrors": 0}))
