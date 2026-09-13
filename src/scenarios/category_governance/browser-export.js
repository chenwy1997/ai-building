/*
 * 在已登录三横供应链“目录”页面的 DevTools Console 执行。
 * 优先调用项目已有的无筛选目录接口，不把凭据写入文件。
 */
(async () => {
  const catalogResponse = await fetch("/manage/product/product-hub/api/searchStdCategory", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: null }),
  });
  if (catalogResponse.ok) {
    const items = await catalogResponse.json();
    if (Array.isArray(items) && items.length > 0) {
      const payload = {
        sourceUrl: location.origin + "/manage/product/product-hub/api/searchStdCategory",
        bucket: "source",
        fetchedAt: new Date().toISOString(),
        items,
      };
      const link = window.document.createElement("a");
      link.href = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: "application/json" }));
      link.download = "sanheng-standard-category.raw.json";
      link.click();
      console.log("category-import-finished", items.length, "level4", items.filter((item) => item.level === 4).length);
      return;
    }
  }

  // 兼容旧页面：如果完整接口不可用，再走页面 Server Action 递归。
  const root = "21080cb1-a57b-4c94-a8ec-9dfed84e9ac5";
  const action = "5b7ad81b023bb2bae7938740d4aa3b662c2b0868";
  const call = async (fatherId) => {
    const response = await fetch(location.pathname, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Next-Action": action,
        Accept: "text/x-component",
        "Content-Type": "text/plain;charset=UTF-8",
      },
      body: JSON.stringify([{ bucket: "source", fatherId }]),
    });
    const text = await response.text();
    const position = text.indexOf("1:");
    if (!response.ok || position < 0) throw new Error(`分类接口失败：HTTP ${response.status}`);
    const payload = JSON.parse(text.slice(position + 2));
    return payload.data?.data ?? [];
  };

  const items = [{ id: root, name: "标准类目", fatherId: null, categoryId: null, isEnable: true }];
  const seen = new Set([root]);
  const queue = [root];
  let requests = 0;
  while (queue.length > 0) {
    const fatherId = queue.shift();
    const rows = await call(fatherId);
    requests += 1;
    for (const row of rows) {
      if (!row?.id || seen.has(row.id)) continue;
      seen.add(row.id);
      items.push(row);
      // 接口会在父节点返回 children 的 ID 占位数组；末级 children 为空。
      if (Array.isArray(row.children) && row.children.length > 0) queue.push(row.id);
    }
    if (requests % 50 === 0) console.log("category-import", requests, items.length, queue.length);
  }

  const payload = {
    sourceUrl: location.origin + location.pathname,
    bucket: "source",
    fetchedAt: new Date().toISOString(),
    items,
  };
  const link = window.document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: "application/json" }));
  link.download = "sanheng-standard-category.raw.json";
  link.click();
  console.log("category-import-finished", items.length, "requests", requests);
})();
