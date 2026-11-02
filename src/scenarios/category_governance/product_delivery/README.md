# 1000 个京东商品的三横类目挂载与属性填写

这份交付固定使用比赛测试集和 `agent-delivery-v3` 属性模板，保留三横原类目 ID、名称与层级。归类与重点参数解释由 Codex 阅读商品后形成明确记录；重建命令重放这些记录，不调用模型重新猜测。

## 执行

在项目根目录运行：

```sh
bun run category-governance:products
```

默认完全离线，复用已有 1000 个 SKU 的京东详情和语义决策，输出到 `workspace/output/v1/product-delivery-v1/`。只需要 JSON 和浏览页面时加 `--json-only`。预览已有结果：

```sh
bun run category-governance:products --serve --port=4322
```

浏览器打开终端显示的本地地址。服务器仅绑定 `127.0.0.1`，不公开原始证据和凭证。

需要补取未缓存 SKU 时，显式运行：

```sh
bun run category-governance:products --refresh-evidence --direct --concurrency=8 --attempts=2
```

这会使用已有 `ai-core` 项目的京东 VOP 实现与配置。成功结果默认复用；仅在需要重取时附加 `--force`。`--direct` 只影响当前进程。刷新证据后，若选定规格或来源出现新冲突，应重新审阅对应语义决策，不能把旧人工判断视为对新证据的自动确认。

## 交付文件

- `比赛结果-1000商品.xlsx`：只有“商品挂载”和“商品属性”两个结果工作表；保留输入的五列，每个属性附来源和原始依据。
- `view.html`：离线可打开的商品检索与属性浏览页，可按缺必填、冲突或挂载范围筛选。
- `products.std.json`：类目和属性定义放入公共字典，商品引用索引；`legend` 说明每个位置的含义。
- `交付说明.md`：覆盖范围、来源边界与需确认的商品。
- `.repro/`：原表快照、压缩京东详情、归类决策、完整填写记录、核对报告与预览图片，供追溯使用。

数值记录同时保存实际单位和模板默认单位。比如保质期原文为月时，不按每月 30 天强行换算。未知布尔值保留空值，不能自动填“否”。区间、无单位数字和占位值不能作为精确规格。原表明示但模板没有对应字段的内容放在“补充规格”，不增加已填属性计数。

1000 个商品中，998 个挂原末级、2 个暂挂原上级；其中共 15 个存在类目范围待确认。缺失属性与资料冲突保留状态，不能把“全部有挂载记录”理解为“全部商品必填参数已齐”。

## 复用结构

1. `collect.ts` / `prepare.ts`：保留输入、按 SKU 取证、提取原始字段；缓存结果可重复使用。
2. `review.ts` / `query.ts`：生成紧凑分组与候选检索材料，帮助语义审阅。
3. `decisions.ts` / `mapping.ts`：保存固定测试集的具体挂载结论并核对原类目，检索分数不直接决定类别。
4. `facts.ts` / `semantic-facts.ts` / `low-coverage-facts.ts` / `official-facts.ts`：记录逐商品的语义解释、冲突处理和少量制造商核对。
5. `attributes.ts` / `explicit-facts.ts`：通用字段对齐、单位换算、选定规格读取与来源保留。
6. `build.ts` / `html.ts` / `excel.ts`：统一生成压缩数据、页面与 Excel；Excel 用项目宿主的 bundled artifact-tool 运行时生成。
7. `verify.py`：只读逐行核对导出的两个工作表、原始五列、SKU 证据关联、属性值与实际单位，输出 `.repro/excel-verified.json`。需要带 `openpyxl` 的 Python；不修改工作簿。

输入文件和属性模板均通过 SHA-256 锁定。替换测试集或模板时，应新建版本、重新做相应语义判断；不能把这份按行号锁定的决策直接应用到别的商品。通用取证、压缩、单位与导出函数可以复用，具体商品知识需要更新。

验证命令：

```sh
bun test tests/category-products.test.ts
python3 src/scenarios/category_governance/product_delivery/verify.py
```

单元测试和工作簿核对验证数据处理与导出一致性，不代替行业判断或制造商参数核验。本流程未调用 DeepSeek 或其他付费模型 API。
