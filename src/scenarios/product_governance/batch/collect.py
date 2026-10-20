"""Read-only, reproducible ES-source sampling for the three-category pilot.

Credentials are read locally and never included in requests saved to disk.
The ES snapshot and the independent product-detail response are both retained.
Images are linked, not interpreted by this collector.
"""

from __future__ import annotations

import argparse
import base64
import concurrent.futures
import datetime as dt
import hashlib
import html
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import time
import urllib.error
import urllib.request


ROOT = Path(__file__).resolve().parents[4]
DEFAULT_OUT = ROOT / "outputs/product-governance/three-category-20261019/inputs"
INDEX = "uece-prod-sc_current"
DETAIL_ENDPOINT = "https://sc.sanheng.com/api/external/getProductInfo"
CATEGORIES = [
    {"id": "fd7a6576-b4bb-4ef0-a273-9de18cf571a2", "name": "软包抽纸", "path": "清洁用品>清洁纸品>卫生纸>软包抽纸"},
    {"id": "433be34e-e1cc-4b5f-b955-df3d802ed2ec", "name": "湿纸巾", "path": "清洁用品>清洁纸品>卫生纸>湿纸巾"},
    {"id": "1f96cac3-8498-4c32-936c-7a6a54b9320b", "name": "纸巾盒", "path": "清洁用品>清洁纸品>纸品配件>纸巾盒"},
]
SOURCE_FIELDS = [
    "id", "productId", "shortProductId", "productInstanceId", "title", "rawTitle",
    "standardCategory", "brand.id", "brand.name", "brand.alias", "brand.internationalName",
    "product.upstreamSku", "product.upstreamSpu", "product.deleted", "upstream.id", "upstream.name",
    "isStdProduct", "isSpuEnable", "isSkuEnable", "spuSaleStatus", "skuSaleStatus",
    "categoryInstance.category.bucket", "updatedAt", "docUpdatedAt",
]


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def save(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def env_values(path: Path) -> dict[str, str]:
    values = {}
    if path.exists():
        for line in path.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                name, value = line.split("=", 1)
                values[name.strip()] = value.strip().strip("\"'")
    return values


def configuration() -> tuple[str, str, str]:
    local = env_values(ROOT / ".env")
    core = env_values(Path("/Users/sanheng/Project/sanheng/ai-core/.env"))
    def require(name: str) -> str:
        value = os.environ.get(name) or local.get(name) or core.get(name)
        if not value:
            raise RuntimeError(f"Missing local configuration: {name}")
        return value
    auth = "Basic " + base64.b64encode(f"{require('ES_USERNAME')}:{require('ES_PASSWORD')}".encode()).decode()
    return require("ES_NODE").rstrip("/"), auth, require("SANHENG_API_KEY")


def post(url: str, payload: object, authorization: str) -> object:
    request = urllib.request.Request(url, data=json.dumps(payload, ensure_ascii=False).encode(),
                                     headers={"Content-Type": "application/json", "Authorization": authorization}, method="POST")
    for attempt in range(3):
        try:
            with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=60) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            if exc.code < 500 or attempt == 2:
                raise RuntimeError(f"Read-only request failed: HTTP {exc.code}") from None
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            if attempt == 2:
                raise RuntimeError("Read-only request failed after 3 attempts") from None
        time.sleep(attempt + 1)
    raise AssertionError("unreachable")


def query(category_id: str, size: int, seed: int) -> dict:
    return {
        "size": size, "track_total_hits": True, "_source": SOURCE_FIELDS,
        "query": {"function_score": {
            "query": {"bool": {
                "filter": [
                    {"term": {"standardCategory.id": category_id}},
                    {"term": {"categoryInstance.category.bucket.keyword": "source:system"}},
                    {"term": {"product.deleted": False}},
                    {"term": {"isSpuEnable": True}}, {"term": {"isSkuEnable": True}},
                    {"term": {"spuSaleStatus": "ON_SALE"}}, {"term": {"skuSaleStatus": "ON_SALE"}},
                ], "must_not": [{"term": {"isStdProduct": True}}],
            }}, "random_score": {"seed": seed, "field": "id"}, "boost_mode": "replace",
        }}, "sort": [{"_score": "desc"}, {"id": "asc"}],
    }


def source_checks(source: dict, category_id: str) -> dict[str, bool]:
    return {
        "categoryMatches": (source.get("standardCategory") or {}).get("id") == category_id,
        "sourceBucket": ((source.get("categoryInstance") or {}).get("category") or {}).get("bucket") == "source:system",
        "notStandardProduct": source.get("isStdProduct") is not True,
        "notDeleted": (source.get("product") or {}).get("deleted") is False,
        "spuEnabled": source.get("isSpuEnable") is True,
        "skuEnabled": source.get("isSkuEnable") is True,
        "spuOnSale": source.get("spuSaleStatus") == "ON_SALE",
        "skuOnSale": source.get("skuSaleStatus") == "ON_SALE",
    }


class TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts: list[str] = []
        self.images: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.skip += 1
        if tag in ("br", "p", "div", "tr", "li"):
            self.parts.append("\n")
        if tag == "img":
            for key, value in attrs:
                if key in ("src", "data-src") and value:
                    self.images.append(value)

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self.skip:
            self.skip -= 1

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def text_and_images(value: object) -> tuple[str, list[str]]:
    raw = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    parser = TextExtractor()
    parser.feed(raw)
    text = html.unescape("".join(parser.parts))
    text = re.sub(r"[ \t\r\f]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n", text).strip()
    return text, parser.images


def image_urls(value: object) -> list[str]:
    if value is None:
        return []
    raw = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    return list(dict.fromkeys(re.findall(r"https?://[^\s\"'<>\[\],]+", raw)))


def redact_sensitive(value: object) -> object:
    if isinstance(value, dict):
        return {key: "[REDACTED]" if re.search(r"(?:token|password|secret|authorization|api.?key)", key, re.I)
                else redact_sensitive(item) for key, item in value.items()}
    if isinstance(value, list):
        return [redact_sensitive(item) for item in value]
    return value


def compact(source: dict, detail: dict, category: dict, sample_rank: int, es_time: str, detail_time: str) -> dict:
    product_id = source["id"]
    evidence = []
    images = []
    def add(field: str, kind: str, value: object, origin: str):
        if value is None or value == "" or value == [] or value == {}:
            return
        text, linked_images = text_and_images(value)
        images.extend({"url": url, "source": origin, "field": field, "interpreted": False} for url in linked_images)
        if text:
            evidence.append({"id": f"{product_id}:{origin}:{field}", "productId": product_id, "kind": kind,
                             "field": field, "text": text, "source": origin,
                             "sourceRef": f"{'es-raw/' + category['id'] if origin == 'es' else 'detail-raw/' + category['id']}.json#{product_id}/{field}"})
    add("title", "title", source.get("title"), "es")
    if source.get("rawTitle") != source.get("title"):
        add("rawTitle", "title", source.get("rawTitle"), "es")
    add("brand.name", "brand", (source.get("brand") or {}).get("name"), "es")
    add("title", "title", detail.get("title"), "sanheng_detail")
    add("brandName", "brand", detail.get("brandName"), "sanheng_detail")
    add("saleSpec", "sale_spec", detail.get("saleSpec"), "sanheng_detail")
    for key, value in detail.items():
        if re.search(r"(?:description|details?|content|parameter|attribute|propert|feature|intro|wareInfo)", key, re.I):
            add(key, "detail", value, "sanheng_detail")
        if re.search(r"(?:images?|pictures?|photos?)", key, re.I):
            images.extend({"url": url, "source": "sanheng_detail", "field": key, "interpreted": False} for url in image_urls(value))
    images = list({(r["url"], r["field"]): r for r in images}.values())
    detail_status = {k: detail.get(k) for k in ("spuSaleStatus", "skuSaleStatus", "isSpuEnable", "isSkuEnable")}
    expected = {"spuSaleStatus": "ON_SALE", "skuSaleStatus": "ON_SALE", "isSpuEnable": True, "isSkuEnable": True}
    return {
        "id": product_id, "shortProductId": source.get("shortProductId"), "categoryId": category["id"],
        "categoryName": category["name"], "categoryPath": category["path"], "sampleRank": sample_rank,
        "title": detail.get("title") or source.get("title"), "saleSpec": detail.get("saleSpec") or "",
        "brand": detail.get("brandName") or (source.get("brand") or {}).get("name"),
        "brandId": (source.get("brand") or {}).get("id"), "esBrand": source.get("brand"),
        "upstreamSku": (source.get("product") or {}).get("upstreamSku"),
        "upstream": source.get("upstream"), "evidence": evidence, "images": images,
        "esFetchedAt": es_time, "detailFetchedAt": detail_time,
        "esStatusChecks": source_checks(source, category["id"]), "detailStatus": detail_status,
        "detailMissingStatusFields": [k for k, v in detail_status.items() if v is None],
        "detailStatusConflicts": [k for k, v in detail_status.items() if v is not None and v != expected[k]],
        "evidenceNotes": ["图片仅保留链接，采集阶段未进行图像识别。", "类目为当前挂载类目，是否错挂需独立复核。"],
    }


def run(output: Path, size: int, seed: int) -> None:
    node, auth, detail_key = configuration()
    output.mkdir(parents=True, exist_ok=True)
    tree = json.loads((ROOT / "scratch-category-baseline-20261010/mapped-tree.json").read_text())
    by_id = {n["id"]: n for n in tree["nodes"]}
    for category in CATEGORIES:
        assert by_id[category["id"]]["name"] == category["name"]
        assert by_id[category["id"]]["isLeaf"]
    save(output / "categories.json", CATEGORIES)

    def collect_category(category: dict) -> tuple[dict, list[dict]]:
        identifier = category["id"]
        body = query(identifier, size, seed)
        es_file = output / "es-raw" / f"{identifier}.json"
        if es_file.exists():
            es = json.loads(es_file.read_text())
            assert es["query"] == body, "Existing cached query differs; use another output directory"
        else:
            fetched_at = now()
            response = post(f"{node}/{INDEX}/_search", body, auth)
            assert isinstance(response, dict)
            assert not response.get("timed_out") and not response["_shards"]["failed"]
            es = {"fetchedAt": fetched_at, "alias": INDEX, "query": body, "response": response}
            save(es_file, es)
        hits = es["response"]["hits"]["hits"]
        assert len(hits) == size, f"{category['name']}: fewer than {size} current on-sale ES hits"
        sources = [hit["_source"] for hit in hits]
        ids = [s["id"] for s in sources]
        assert len(set(ids)) == size
        assert all(all(source_checks(s, identifier).values()) for s in sources)
        detail_file = output / "detail-raw" / f"{identifier}.json"
        if detail_file.exists():
            detail = json.loads(detail_file.read_text())
            assert detail["requestedIds"] == ids
        else:
            fetched_at = now()
            response = post(DETAIL_ENDPOINT, {"skus": ids}, detail_key)
            assert isinstance(response, list), "Product detail response must be a list"
            detail = {"fetchedAt": fetched_at, "endpoint": DETAIL_ENDPOINT, "requestedIds": ids,
                      "response": redact_sensitive(response)}
            save(detail_file, detail)
        details = {row["sku"]: row for row in detail["response"]}
        assert set(ids).issubset(details), f"{category['name']}: details missing for selected IDs"
        rows = [compact(s, details[s["id"]], category, i + 1, es["fetchedAt"], detail["fetchedAt"])
                for i, s in enumerate(sources)]
        conflicts = [r["id"] for r in rows if r["detailStatusConflicts"]]
        summary = {
            **category, "population": es["response"]["hits"]["total"], "sampleSize": len(rows),
            "esFetchedAt": es["fetchedAt"], "detailFetchedAt": detail["fetchedAt"],
            "resolvedIndices": sorted({hit["_index"] for hit in hits}),
            "allEsStatusChecksPass": True, "detailReturned": len(details), "detailStatusConflictIds": conflicts,
            "withTitle": sum(bool(r["title"]) for r in rows), "withSaleSpec": sum(bool(r["saleSpec"]) for r in rows),
            "withImages": sum(bool(r["images"]) for r in rows),
            "withDetailText": sum(any(e["kind"] == "detail" for e in r["evidence"]) for r in rows),
            "withUpstreamSku": sum(bool(r["upstreamSku"]) for r in rows),
            "detailResponseFields": sorted({k for row in detail["response"] for k in row}),
        }
        save(output / "by-category" / f"{identifier}.json", rows)
        print(json.dumps({"category": category["name"], "population": summary["population"], "sample": len(rows),
                          "detailStatusConflicts": len(conflicts)}, ensure_ascii=False), flush=True)
        return summary, rows

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        collected = list(pool.map(collect_category, CATEGORIES))
    all_rows = [r for _, rows in collected for r in rows]
    all_ids = [r["id"] for r in all_rows]
    assert len(all_ids) == len(set(all_ids)) == size * len(CATEGORIES)
    save(output / "products.json", all_rows)
    fingerprint = hashlib.sha256("\n".join(all_ids).encode()).hexdigest()
    manifest = {
        "schema": "product-governance-live-sample-v1", "assembledAt": now(), "seed": seed,
        "samplingMethod": "ES function_score random_score(seed, field=id), score DESC/id ASC, per-category equal allocation",
        "sampleSize": len(all_rows), "uniqueProducts": len(set(all_ids)), "orderedIdsSha256": fingerprint,
        "categories": [summary for summary, _ in collected], "sourceAlias": INDEX,
        "populationDefinition": "商品源 source:system，非 isStdProduct，product.deleted=false，SPU/SKU 均启用且均 ON_SALE；按当前 standardCategory.id 精确挂载。",
        "statusDefinition": "ES 查询时点严格校验；三横详情返回的状态另行交叉验证，缺失字段不伪造。",
        "imageInterpretationPerformed": False,
        "allEsStatusChecksPass": all(all(r["esStatusChecks"].values()) for r in all_rows),
        "detailStatusConflictIds": [r["id"] for r in all_rows if r["detailStatusConflicts"]],
        "notes": ["每类固定50件为等额分层试点样本，未经商品量权重校正，不代表三类合计商品总体填充率。",
                  "ES随机评分与索引/分片状态相关；保留原始响应、排序和ID指纹确保本次样本可追溯。",
                  "接口原始响应中如出现凭证字段，会写入[REDACTED]；未保存连接凭证。"],
    }
    save(output / "manifest.json", manifest)
    assert not manifest["detailStatusConflictIds"], "Some fresh detail statuses contradict ES; inspect before running models"
    print(json.dumps({"output": str(output), "products": len(all_rows), "allEsStatusChecksPass": True,
                      "detailStatusConflicts": 0}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--size", type=int, default=50)
    parser.add_argument("--seed", type=int, default=20261019)
    args = parser.parse_args()
    if args.size <= 0:
        raise SystemExit("size must be positive")
    run(args.output.resolve(), args.size, args.seed)
