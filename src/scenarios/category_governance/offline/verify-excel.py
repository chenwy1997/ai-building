"""Read-only check of the saved XLSX, including Chinese text across worker streams."""
import collections
import json
import pathlib
import sys
import xml.etree.ElementTree as ET
import zipfile

directory = pathlib.Path(sys.argv[1])
manifest = json.loads((directory / "manifest.json").read_text())
compact = json.loads((directory / "templates.std.json").read_text())
ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
with zipfile.ZipFile(directory / "attributes.xlsx") as archive:
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    assert [s.attrib["name"] for s in workbook.findall("s:sheets/s:sheet", ns)] == ["属性模板"]
    strings = []
    if "xl/sharedStrings.xml" in archive.namelist():
        strings = ["".join(n.itertext()) for n in ET.fromstring(archive.read("xl/sharedStrings.xml"))]
    def value(cell):
        if cell.attrib.get("t") == "inlineStr":
            return "".join(cell.find("s:is", ns).itertext())
        node = cell.find("s:v", ns)
        if node is None:
            return ""
        return strings[int(node.text)] if cell.attrib.get("t") == "s" else node.text or ""
    rows = []
    with archive.open("xl/worksheets/sheet1.xml") as stream:
        for _, row in ET.iterparse(stream, events=("end",)):
            if row.tag != "{" + ns["s"] + "}row":
                continue
            cells = {"".join(filter(str.isalpha, c.attrib["r"])): value(c) for c in row}
            rows.append(cells)
            row.clear()
    assert len(rows) == manifest["counts"]["properties"] + 1
    assert len(rows[0]) == 12 and rows[0]["H"] == "属性值填写要求"
    expected = []
    for category in compact["categories"]:
        node_index = category[0]
        path = []
        while node_index != -1:
            _, name, node_index = compact["nodes"][node_index]
            path.insert(0, name)
        assert path[0] == "标准类目" and len(path) == 5
        for index in category[1] + category[2]:
            p = compact["attributes"][index]
            label = ("条件必填" if p.get("requiredWhenApplicable") else "条件选填") if p.get("condition") else "必填" if p["required"] else "选填"
            expected.append(dict(zip(["A", "B", "C", "D", "E", "H", "I"], path[1:] + [p["name"], label, p.get("unit") or ""])))
    for number, (row, target) in enumerate(zip(rows[1:], expected), 2):
        assert all(row.get(k, "") == v for k, v in target.items()), (number, row, target)
        assert "待审定" not in row.get("H", ""), number
    labels = collections.Counter(r["H"] for r in rows[1:])
    result = {"rows": len(expected), "sheets": 1, "columns": 12, "labels": dict(labels), "taxonomyNamesUnitsAndRequirementsMatch": True}
    (directory / ".repro/excel-verification.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps(result, ensure_ascii=False))
