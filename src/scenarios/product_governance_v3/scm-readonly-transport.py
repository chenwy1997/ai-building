"""Bounded read-only transport. Secrets arrive on stdin and are never printed."""
import json
import sys
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


try:
    data = json.load(sys.stdin)
    action, body = data["action"], data["body"]
    categories = {"9fda0128-630c-4756-b26f-248e8fdc3db5", "511563d5-477d-4730-852e-58f9805dc522"}
    if action == "getProductListByStdCategoryIds":
        assert set(body) == {"stdCategoryIds", "page", "pageSize"}
        assert len(body["stdCategoryIds"]) == 1 and body["stdCategoryIds"][0] in categories
        assert body["page"] == 1 and type(body["pageSize"]) is int and 1 <= body["pageSize"] <= 3
    elif action == "getProductInfo":
        assert set(body) == {"skus"} and 1 <= len(body["skus"]) <= 6
        assert len(set(body["skus"])) == len(body["skus"])
    else:
        raise ValueError("unregistered read")
    req = urllib.request.Request(
        "https://sc.sanheng.com/api/external/" + action,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": data["key"]},
        method="POST",
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(req, timeout=60) as response:
        result = response.read(8_000_001)
        assert len(result) <= 8_000_000
        parsed = json.loads(result)
    sys.stdout.write(json.dumps(parsed, ensure_ascii=False))
except Exception:
    # Avoid exception strings: HTTP headers/credentials/business content must not leak.
    sys.exit(1)
