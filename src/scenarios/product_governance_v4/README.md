# 商品类目治理 v4

平台与多源候选 → 同族适用性 → 明确取舍 → 属性定义 → 独立审校 → 人工复核。

本版使用 GPT-6.1 Terra / max 承担分组研究和建模，GPT-6 Astra / max 独立审校。模型工作由 Codex 的代理工具执行。下面的 Bun 入口负责准备资料、检索、检查和整合；不会假装普通 Bun 命令能直接启动这些 Codex 模型，也不会调用旧 DeepSeek 跑批。

## 当前规则

- [治理规范](docs/standard.md)：候选来源与值证据分离、同族适用性、短名、组合尺寸、SKU/选填、用户认可范围。
- [字段职责清单](docs/field-ownership-review.md)：全部 86 条历史映射；20 组业务归并、233 个底层字段盘点。表单按目录实例与继承配置动态产生，不能因数据库有列而全局排除。
- [字段恢复选择](docs/field-restoration-selection.md)：保质期、本体尺寸与重量恢复选填候选；包装尺寸、毛重/物流重量、保修期及其他历史排除项保持排除。程序区分候选资格与对象待核，不自动新增属性。
- [上下文清单](manifest.json)：固定规范和阶段 skill 在前，动态资料通过完整文件/分页工具检索。准备清单不等于模型实际阅读，作者另交 context-receipt。
- [迁移记录](migration-manifest.json)：v3 设计与规范档案、共享字段资料、排版与采样工具的来源。reference 仅供溯源，当前规则以 standard 为准。

## 离线入口

```sh
bun src/scenarios/product_governance_v4/cli.ts help
bun test src/scenarios/product_governance_v4/tests
bun src/scenarios/product_governance_v4/cli.ts prepare --stage model --inputs run-inputs.json --out outputs/my-run/context
bun src/scenarios/product_governance_v4/cli.ts query --file outputs/my-run/scope.json --kind category --text 擦拭 --limit 50
bun src/scenarios/product_governance_v4/cli.ts query --file outputs/my-run/candidate-pools.json --kind candidates --category-id CATEGORY_ID --offset 0 --limit 50
bun src/scenarios/product_governance_v4/cli.ts assemble --manifest outputs/my-run/final-input-selection.json --out outputs/my-run
```

`run-inputs.json` 格式为 `{"files":[{"path":"scope.json","role":"scope","sha256":"..."}]}`。动态文件不塞满一次提示，也不丢弃：通过 `query --kind category|candidates|evidence|family` 分页读取，返回总量及下一页。相对路径按输入清单位置解析。

整合清单包含：scope、baseline、baselineSources、每组 draft/pool/matrix 的 `path + sha256`，每组 categoryIds、preserveCategoryIds、preservedMatrix，以及人审认可来源。输入哈希变更即失败，不猜哪个文件最新。`check` 与 `assemble` 使用同一验收路径，都会输出离线 JSON，不发生模型/线上调用。全量集合由清单决定，无硬编码 232 或失败类目数。

## 真实样本工具

```sh
# profiles.json 决定类目、检索词、已启用京东目录和样本筛选；不带 execute 只预检。
bun src/scenarios/product_governance_v4/scripts/read-enabled-catalog.ts --out outputs/my-run/enabled-catalog.json
bun src/scenarios/product_governance_v4/scripts/collect-vop.ts --out outputs/my-run --phase search --concurrency 8 --limit 100
bun src/scenarios/product_governance_v4/scripts/collect-vop.ts --out outputs/my-run --phase search --concurrency 8 --limit 100 --execute
bun src/scenarios/product_governance_v4/scripts/collect-vop.ts --out outputs/my-run --phase details --concurrency 8 --limit 100 --execute
python3 src/scenarios/product_governance_v4/scripts/extract-candidates.py --manifest outputs/my-run/sampling-manifest.json --out outputs/my-run/candidate-pools.json

# 自有源仅读取白名单；类目名称搜索仅用于找ID，须核路径再按真实ID取证。
python3 src/scenarios/product_governance_v4/scripts/read-own-source.py --category-id CATEGORY_ID --out outputs/my-run/own-receipt.json
```

VOP 并发支持 1—32，单类上限 1—100；回执按请求哈希缓存，报告采集日期。SDK 位于配置的 `--jd-project`（本机默认 ai-core）且需该项目 JD_VOP 环境配置。自有源通过 ES_NODE/ES_USERNAME/ES_PASSWORD 或 `--env-file` 配置，确认预检后加 `--execute`。不打印密钥/上游对象；不覆盖既有回执。标题规则只是初筛，须核混挂和对象；采样频次不是市场份额或必填依据。

抽取器保留参数/HTML原词及通用数量单位片段，不把正则片段当已核实事实或行业属性全集。专业类目需补研究、处理混挂，并提交完整候选取舍。profiles 的 categoryId 必须来自启用的京东目录，内部目录映射不能只凭同名认定。

启用目录工具使用 DATABASE_URL 或 `--env-file`，只读事务查询 public.jdvop_categories；加 `--execute` 才读取，不打印连接信息。`profiles.json` 需要 catalogFiles、categories（id/name/scope/searches 等）和可选 cacheDirectories；沿用真实回执和明确的 profile，不按类目同名自动猜京东ID。

## Excel

使用 bundled Node 和 `@oai/artifact-tool`：

```sh
NODE_RUNTIME src/scenarios/product_governance_v4/scripts/build-review.mjs --out outputs/my-run --filename 属性方案_v4.xlsx --modules BUNDLED_NODE_MODULES --freeze-left 1
```

默认 10pt、22px 固定行高；长文保留原单元格及备注；冻结列与单表覆盖见 [排版默认值](scripts/review-layout.defaults.json)。文件已存在且用户编辑过时拒绝覆盖；另选文件名。导出含所有类目、既有认可/本轮新增状态、候选取舍、同族对照、字段职责及来源。不得把审校通过写成人工批准。

## 能力边界

已接通离线输入选择、上下文准备和查询、样本工具、作者输出检查、原认可内容保护与 Excel 导出。当前没有商品重挂/属性新增/填写的生产写入口；每个目录的动态字段、公开与搜索生效、版本兼容、数量载体映射仍须上线前逐项核实。本次 Codex 代理 token/缓存计数不可见，不冒报缓存命中率或用量。
