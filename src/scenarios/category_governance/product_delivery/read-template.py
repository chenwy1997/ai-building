"""Read-only XLSX/CSV extraction. Never executes formulas or changes a workbook."""
import csv
import json
import sys
from pathlib import Path
import openpyxl

workbook, changes, output = map(Path, sys.argv[1:4])
wb = openpyxl.load_workbook(workbook, read_only=True, data_only=False)
sheet = wb["属性模板"]
rows = []
for cells in sheet:
    if any(c.data_type == "f" for c in cells):
        raise ValueError("模板中含公式，请提供明确的属性定义值")
    values = ["" if c.value is None else str(c.value).strip() for c in cells]
    if any(values):
        rows.append(values)
with changes.open(encoding="utf-8-sig", newline="") as f:
    listed = list(csv.reader(f))
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps({"headers": rows[0], "rows": rows[1:], "changeHeaders": listed[0], "listedPaths": listed[1:]}, ensure_ascii=False))
