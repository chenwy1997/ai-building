"""Download the first same-SKU main image and run local Apple Vision OCR.

No image edits, external AI calls, or product-attribute decisions are made.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request


ROOT = Path(__file__).resolve().parents[4]
DEFAULT_INPUT = ROOT / "outputs/product-governance/three-category-20261019/inputs"
MAX_BYTES = 15 * 1024 * 1024


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def save(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    temporary.replace(path)


def image_download(url: str, path: Path) -> dict:
    metadata_path = path.with_suffix(path.suffix + ".download.json")
    metadata = json.loads(metadata_path.read_text()) if metadata_path.exists() else {}
    if path.exists() and metadata.get("sourceUrl") == url:
        data = path.read_bytes()
        return {**metadata, "status": "cached", "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    request = urllib.request.Request(url, headers={"User-Agent": "SanhengProductGovernanceReadOnly/1.0"})
    for attempt in range(2):
        try:
            with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=20) as response:
                content_type = response.headers.get_content_type()
                if not content_type.startswith("image/"):
                    raise ValueError(f"Unexpected content type: {content_type}")
                data = response.read(MAX_BYTES + 1)
                if len(data) > MAX_BYTES:
                    raise ValueError("Image exceeds 15 MiB limit")
                if not data:
                    raise ValueError("Empty image response")
                temporary = path.with_suffix(path.suffix + ".part")
                temporary.write_bytes(data)
                temporary.replace(path)
                metadata = {"status": "downloaded", "sourceUrl": url, "downloadedAt": now(), "bytes": len(data),
                            "contentType": content_type, "sha256": hashlib.sha256(data).hexdigest()}
                save(metadata_path, metadata)
                return metadata
        except urllib.error.HTTPError as exc:
            if exc.code < 500 or attempt == 1:
                raise RuntimeError(f"HTTP {exc.code}") from None
        except (urllib.error.URLError, TimeoutError):
            if attempt == 1:
                raise RuntimeError("Image download failed after 2 attempts") from None
        time.sleep(1)
    raise AssertionError("unreachable")


def run(inputs: Path) -> None:
    rows = json.loads((inputs / "products.json").read_text())
    images = inputs / "images"
    images.mkdir(exist_ok=True)
    source = Path(__file__).with_name("vision_ocr.swift")
    runtime = Path(tempfile.gettempdir()) / "sanheng-product-governance-vision-ocr"
    runtime.mkdir(exist_ok=True)
    binary = runtime / ("vision-ocr-" + hashlib.sha256(source.read_bytes()).hexdigest()[:16])
    if not binary.exists() or binary.stat().st_mtime < source.stat().st_mtime:
        compiled = subprocess.run(["swiftc", "-O", str(source), "-o", str(binary)], capture_output=True, text=True, timeout=90)
        if compiled.returncode:
            save(inputs / "image-ocr.json", {"status": "unavailable", "reason": "Local Swift/Vision compiler failed",
                                            "diagnostic": compiled.stderr[-2000:], "attemptedAt": now()})
            raise SystemExit("Local Swift/Vision compilation failed")

    def process(row: dict) -> dict:
        product_id = row["id"]
        record_path = images / f"{product_id}.ocr.json"
        source_image = next((i for i in row.get("images", []) if i.get("field") == "mainImages"), None)
        record = {"productId": product_id, "categoryId": row["categoryId"], "categoryName": row["categoryName"],
                  "evidenceTier": "ocr_candidate", "attributeValuesVerified": False,
                  "source": "sanheng_detail", "sourceField": "mainImages", "sourceUrl": source_image["url"] if source_image else None}
        if not source_image:
            return {**record, "status": "no_image"}
        url = source_image["url"]
        if record_path.exists():
            cached = json.loads(record_path.read_text())
            if cached.get("status") == "completed" and cached.get("sourceUrl") == url:
                return cached
        suffix = Path(urllib.parse.urlsplit(url).path).suffix.lower()
        if suffix not in (".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tiff", ".heic"):
            suffix = ".image"
        image_path = images / f"{product_id}{suffix}"
        record["localPath"] = str(image_path)
        record["startedAt"] = now()
        try:
            record["download"] = image_download(url, image_path)
            result = subprocess.run([str(binary), str(image_path)], capture_output=True, text=True, timeout=45)
            if result.returncode:
                raise RuntimeError("Vision failed: " + result.stderr[-1000:].strip())
            ocr = json.loads(result.stdout)
            record.update({"status": "completed", "completedAt": now(), "ocr": ocr})
        except Exception as error:
            record.update({"status": "failed", "completedAt": now(), "errorType": type(error).__name__, "error": str(error)[:1000]})
        save(record_path, record)
        return record

    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        futures = {pool.submit(process, row): row["id"] for row in rows}
        for future in concurrent.futures.as_completed(futures):
            results.append(future.result())
            if len(results) % 15 == 0 or len(results) == len(rows):
                print(json.dumps({"processed": len(results), "total": len(rows),
                                  "completed": sum(r["status"] == "completed" for r in results),
                                  "failed": sum(r["status"] == "failed" for r in results)}), flush=True)
    by_id = {r["productId"]: r for r in results}
    results = [by_id[r["id"]] for r in rows]
    output = {
        "schema": "product-governance-local-image-ocr-v1", "assembledAt": now(),
        "status": "completed", "engine": "Apple Vision VNRecognizeTextRequest revision 3",
        "sourceDocumentation": "https://developer.apple.com/documentation/vision/vnrecognizetextrequest",
        "concurrency": 2, "downloadTimeoutSeconds": 20, "ocrTimeoutSeconds": 45,
        "requestedProducts": len(rows), "processedImages": sum(r["status"] == "completed" for r in results),
        "withText": sum(bool((r.get("ocr") or {}).get("text")) for r in results),
        "failed": sum(r["status"] == "failed" for r in results), "products": results,
        "notes": ["每件最多读取一个来自同SKU详情接口的主图，图片未编辑。",
                  "OCR输出仅是候选证据；识别置信度不是属性正确率。品牌、数量、单位等重要新增值仍需查看原图核验。",
                  "原图可能展示多规格或包装示意；不能仅凭图片出现数值就认定对应本销售SKU。",
                  "未使用付费OCR/模型接口。"],
    }
    save(inputs / "image-ocr.json", output)
    print(json.dumps({k: output[k] for k in ("requestedProducts", "processedImages", "withText", "failed")}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--inputs", type=Path, default=DEFAULT_INPUT)
    args = parser.parse_args()
    run(args.inputs.resolve())
