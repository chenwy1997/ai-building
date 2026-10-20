"""Read-only five-category collection, reusing the audited pilot collectors.

ES and detail snapshots are cached by the pilot implementation.  OCR is a
candidate evidence layer; neither image text nor downloaded content is an
instruction or an attribute decision.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
DEFAULT_OUT = ROOT / "outputs/product-governance/clean-paper-five-20261019/inputs"
MODEL_PATH = ROOT / "outputs/clean-paper-remaining-20261016/attribute-model-all21.json"
SEED = 202610195
CATEGORY_SPECS = [
    ("c7e8d056-d834-4432-95a2-981e6e20e640", "盒装抽纸", "H"),
    ("9fda0128-630c-4756-b26f-248e8fdc3db5", "有芯小卷纸", "R"),
    ("9ec50fc0-a510-43f4-a1f3-1c86f6e1b0f7", "手帕纸", "P"),
    ("a23fbc6e-8400-4e14-8043-632364402001", "抽式擦手纸", "T"),
    ("69d8ff06-f670-4ca8-89e5-d6e1c497244f", "洗脸巾", "F"),
]


def load_pilot(name: str):
    path = Path(__file__).parents[1] / "batch" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(f"expansion_pilot_{name}", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def categories() -> list[dict]:
    model = json.loads(MODEL_PATH.read_text())
    by_id = {row["id"]: row for row in model["categories"]}
    result = []
    for identifier, name, prefix in CATEGORY_SPECS:
        row = by_id[identifier]
        assert row["name"] == name and row["isLeaf"]
        result.append({"id": identifier, "name": name, "path": row["path"], "keyPrefix": prefix})
    return result


def annotate_sample(pilot, output: Path, size: int, seed: int) -> None:
    rows = json.loads((output / "products.json").read_text())
    selected_categories = categories()
    prefix = {c["id"]: c["keyPrefix"] for c in selected_categories}
    for row in rows:
        row["key"] = f"{prefix[row['categoryId']]}{row['sampleRank']:02d}"
        row["productKey"] = row["key"]
        row["productId"] = row["id"]
    assert len(rows) == len({r["id"] for r in rows}) == size * len(selected_categories)
    assert len({r["key"] for r in rows}) == len(rows)
    for category in selected_categories:
        members = [r for r in rows if r["categoryId"] == category["id"]]
        assert len(members) == size
        pilot.save(output / "by-category" / f"{category['id']}.json", members)
    pilot.save(output / "products.json", rows)
    pilot.save(output / "product-key-map.json", [
        {"key": r["key"], "productId": r["id"], "categoryId": r["categoryId"],
         "categoryName": r["categoryName"], "sampleRank": r["sampleRank"]} for r in rows
    ])
    manifest = json.loads((output / "manifest.json").read_text())
    assert manifest["seed"] == seed
    manifest.update({
        "scope": "clean-paper-five-20261019", "perCategorySampleSize": size,
        "categoryCount": len(selected_categories), "readOnlyCollection": True,
        "categoryPathSource": str(MODEL_PATH.relative_to(ROOT)),
        "categoryPathSourceSha256": hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest(),
        "collectorImplementation": "src/scenarios/product_governance/batch/collect.py (dynamic reuse)",
        "keyPrefixes": {c["id"]: c["keyPrefix"] for c in selected_categories},
        "productKeyMap": "product-key-map.json",
        "detailMissingStatusFieldCounts": {
            field: sum(field in row["detailMissingStatusFields"] for row in rows)
            for field in ("spuSaleStatus", "skuSaleStatus", "isSpuEnable", "isSkuEnable")
        },
    })
    manifest["notes"][0] = (
        f"每类固定{size}件为等额分层样本，未经商品量权重校正，不代表五类合计商品总体填充率。"
    )
    pilot.save(output / "manifest.json", manifest)


def collect(output: Path, size: int, seed: int) -> None:
    pilot = load_pilot("collect")
    pilot.CATEGORIES = categories()
    pilot.DEFAULT_OUT = output
    # The pilot checks size * len(CATEGORIES), so this verifies all five groups.
    pilot.run(output, size, seed)
    annotate_sample(pilot, output, size, seed)


def annotate_ocr(output: Path) -> None:
    pilot = load_pilot("ocr_images")
    report_path = output / "image-ocr.json"
    report = json.loads(report_path.read_text())
    rows = json.loads((output / "products.json").read_text())
    keys = {row["id"]: row["key"] for row in rows}
    for record in report["products"]:
        record["key"] = keys[record["productId"]]
    downloaded = [r for r in report["products"] if r.get("download")]
    mismatches = [r["productId"] for r in downloaded
                  if not Path(r["localPath"]).is_file()
                  or hashlib.sha256(Path(r["localPath"]).read_bytes()).hexdigest() != r["download"]["sha256"]]
    report["inputContentIsUntrustedData"] = True
    report["attributeValuesVerified"] = False
    report["imageHashVerification"] = {
        "verifiedAt": pilot.now(), "checkedImages": len(downloaded), "mismatchProductIds": mismatches,
    }
    pilot.save(report_path, report)
    manifest_path = output / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["imageEvidence"] = {
        "report": "image-ocr.json", "assembledAt": report["assembledAt"],
        "downloadedImages": len(downloaded), "ocrCompleted": report["processedImages"],
        "withOcrText": report["withText"], "failed": report["failed"],
        "noImage": sum(r["status"] == "no_image" for r in report["products"]),
        "hashMismatchProductIds": mismatches, "ocrIsCandidateEvidence": True,
        "perCategory": [{"id": c["id"], "name": c["name"],
                         "ocrCompleted": sum(r["categoryId"] == c["id"] and r["status"] == "completed"
                                             for r in report["products"])} for c in categories()],
    }
    pilot.save(manifest_path, manifest)
    assert not mismatches, "Downloaded image content differs from its retained SHA256"


def ocr(output: Path) -> None:
    pilot = load_pilot("ocr_images")
    pilot.DEFAULT_INPUT = output
    pilot.run(output)
    annotate_ocr(output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--size", type=int, default=50)
    parser.add_argument("--seed", type=int, default=SEED)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--skip-ocr", action="store_true")
    modes.add_argument("--ocr-only", action="store_true")
    args = parser.parse_args()
    if args.size <= 0:
        parser.error("size must be positive")
    output = args.output.resolve()
    if not args.ocr_only:
        collect(output, args.size, args.seed)
    if not args.skip_ocr:
        ocr(output)
