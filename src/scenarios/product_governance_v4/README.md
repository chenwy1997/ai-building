# 商品类目治理 v4

平台与多源候选 → 同族适用性 → 明确取舍 → 属性定义 → 独立审校 → 人工复核。

本版使用 GPT-6.1 Terra / max 承担分组研究和建模，GPT-6 Astra / max 独立审校。模型工作由 Codex 的代理工具执行。下面的 Bun 入口负责准备资料、检索、检查和整合；不会假装普通 Bun 命令能直接启动这些 Codex 模型，也不会调用旧 DeepSeek 跑批。

## 当前规则

SKU 试填采用 [提取与填写规范](docs/sku-extraction-standard.md)、[供应链目标对齐](docs/scm-category-attribute-value-alignment.md) 与 [可靠性研究](docs/sku-extraction-reliability-research.md)。固定属性合同，逐件核身份和原文；有值候选、口径待核、来源冲突、资料未读分开。当前仅离线建议，不调用生产保存。新的 `extract` / `value-review` 阶段按 manifest 加载对应规范和 skill。

[值规范化政策](knowledge/sku-value-policy.json)同步到填写合同：明确的每件重量不额外索要净重或含芯证明；本体组合尺寸不用另加“单片/展开”关键词；纯材质名称去掉单一成分100%，原比例仍留证据；每包数量不重复“/包”。混合材料、组合尺寸对象、多个销售规格和单位差异仍逐项核实。程序可校验确定性文字变换，语义由独立审校确认。

修订已有试填结果时，先生成新填写合同，再整理当前类目作者稿、真实目录路由和目标类目作者稿。路由只能指向已启用的真实末级ID，不能用标准映射ID；原类目始终保留。建议类目已有治理合同的，重新读取同SKU资料、完整提取目标属性，不能机械搬旧值。

```sh
bun src/scenarios/product_governance_v4/scripts/revise-sku-value-policy.ts --contract outputs/my-run/attribute-proposals.json --policy src/scenarios/product_governance_v4/knowledge/sku-value-policy.json --out outputs/my-revision/contract
bun src/scenarios/product_governance_v4/scripts/revise-sku-fill.ts --manifest outputs/my-revision/inputs.json --out outputs/my-revision/draft
```

修订清单 `version=1`，必填 `baseline/contract/tree/currentAuthor/routing/targetAuthor` 各自的 `path/sha256`。不传 `review/deltas` 时输出草稿及 `review-bindings.json`；独立审校对完整作者行和7项输入哈希签核后，将 `review/deltas` 加入新清单，另选输出目录生成正式待人审版本。变更需携带原行哈希，旧文件或用户稿不覆盖。样本数量与待改类SKU由输入计算，无固定450或固定类目名单；这两个命令均不调用模型或写线上。

[采购意图与专业来源规则](docs/procurement-and-source-policy.md)规定逐类采购问题、工业/生活来源排序、数值枚举清洗、局部选项子集及新值维护。已接入 `zkh-l5-specs`：长表为检索入口，宽表只作同源核对，不重复计票。规则、来源配置和阶段 skill 已加入 manifest 的固定上下文。

```sh
bun src/scenarios/product_governance_v4/cli.ts source-priority --profile industrial_mro
bun src/scenarios/product_governance_v4/cli.ts query --kind references --source zkh-l5-specs --category-text 分类垃圾桶 --attribute-text 容量
# inputs 固定基线、作者增量、来源文件的 path/sha256；不调用模型、不改线上。
bun src/scenarios/product_governance_v4/cli.ts refine-procurement --manifest outputs/my-run/refinement-inputs.json --out outputs/my-run/review
```

增量入口只更新作者明确提交的绑定，未改动内容原样保留。输入为 `baseline`、`patches`、`evidence` 和 `scopeComplete`；作者稿包含 `reviewedCategories`、`definitions`，绑定明确 `action=add/update`。复用旧定义用 `reuseDefinitionId`；数值枚举同义词库共用，局部适用值用 `allowedOptions` 和 `allowedOptionsReferences`，相应填写例可放绑定的 `example`。全流程离线检查通过后用现有 `build-shared-review.mjs` 导出同样三表，新增/修改着色并保留变更列。

- [治理规范](docs/standard.md)：候选来源与值证据分离、同族适用性、短名、组合尺寸、SKU/选填、用户认可范围。
- [ES 类目范围与 SPU 统计口径](docs/es-category-scope-and-counting.md)：真实目录 ID 与标准映射 ID 不可混用；查询字段、子树/直挂、精确去重及本次错查案例。ES 采样/统计前必读。
- [SKU 提取资料与接线核验](docs/sku-extraction-readiness-20261030.md)：36 件摘要与 6 件完整表单实查；详情读取缺口、真实冲突、V3 可复用边界及 400 件试填前的实施顺序。
- [属性类型与取值合同](docs/attribute-type-contract.md)：当前业务使用文本、数值、布尔、单/多选枚举；共享定义、规范示例、类型升级与历史兼容。字典引用为已有通用能力，本轮不启用。
- [字段职责清单](docs/field-ownership-review.md)：全部 86 条历史映射；20 组业务归并、233 个底层字段盘点。表单按目录实例与继承配置动态产生，不能因数据库有列而全局排除。
- [字段恢复选择](docs/field-restoration-selection.md)：保质期、本体尺寸与重量恢复选填候选；包装尺寸、毛重/物流重量、保修期及其他历史排除项保持排除。程序区分候选资格与对象待核，不自动新增属性。
- [属性候选来源库](knowledge/attribute-reference-library/README.md)：统一登记 VOP、震坤行模板、AI 比赛模板、立讯模板、网络和模型知识，并保留三横商品源。三份模板原件及索引在项目内，供未来任务按需检索，不回写本次已治理方案。
- [上下文清单](manifest.json)：固定规范和阶段 skill 在前，动态资料通过完整文件/分页工具检索。准备清单不等于模型实际阅读，作者另交 context-receipt。
- [迁移记录](migration-manifest.json)：v3 设计与规范档案、共享字段资料、排版与采样工具的来源。reference 仅供溯源，当前规则以 standard 为准。

## 离线入口

```sh
bun src/scenarios/product_governance_v4/cli.ts help
bun test src/scenarios/product_governance_v4/tests
bun src/scenarios/product_governance_v4/cli.ts prepare --stage model --inputs run-inputs.json --out outputs/my-run/context
bun src/scenarios/product_governance_v4/cli.ts query --file outputs/my-run/scope.json --kind category --text 擦拭 --limit 50
bun src/scenarios/product_governance_v4/cli.ts query --file outputs/my-run/candidate-pools.json --kind candidates --category-id CATEGORY_ID --offset 0 --limit 50
bun src/scenarios/product_governance_v4/cli.ts query --kind references --category-text 垃圾袋 --limit 10
bun src/scenarios/product_governance_v4/cli.ts query --kind dictionary --file outputs/my-run/dictionaries.json --text 颜色 --limit 50
bun src/scenarios/product_governance_v4/cli.ts check-types --file outputs/my-run/draft.json --dictionaries outputs/my-run/dictionaries.json --out outputs/my-run/type-checks.json
bun src/scenarios/product_governance_v4/cli.ts inspect-types --file outputs/historical-run/attribute-proposals.json --out outputs/my-run/legacy-types.json
bun src/scenarios/product_governance_v4/cli.ts assemble --manifest outputs/my-run/final-input-selection.json --out outputs/my-run
bun src/scenarios/product_governance_v4/cli.ts assemble-shared --manifest outputs/my-run/shared-catalog-inputs.json --out outputs/my-run
```

`run-inputs.json` 格式为 `{"files":[{"path":"scope.json","role":"scope","sha256":"..."}]}`。动态文件不塞满一次提示，也不丢弃：通过 `query --kind category|candidates|evidence|family` 分页读取，返回总量及下一页。相对路径按输入清单位置解析。

整合清单包含：scope、baseline、baselineSources、每组 draft/pool/matrix 的 `path + sha256`，每组 categoryIds、preserveCategoryIds、preservedMatrix，以及人审认可来源。输入哈希变更即失败，不猜哪个文件最新。`check` 与 `assemble` 使用同一验收路径，都会输出离线 JSON，不发生模型/线上调用。全量集合由清单决定，无硬编码 232 或失败类目数。

字典作为动态输入（role=dictionaries）登记，整合清单可给 dictionaries 的 path/sha256；不提供时继承选定基线的嵌入字典。新稿采用 attributeContractVersion=1。旧方案逐项不变才可沿用缺少 typing 的配置；只读 inspect-types 不代表新合同通过。实质修改须通过 proposedBaselineChanges 明确旧定义哈希及原因，输出“本轮修改待审”，保留原定义；详见类型合同。

`assemble-shared` 用于已认可属性集合的类型与共享定义重整，清单为 `{"baseline":{"path":"旧方案.json","sha256":"..."},"catalogs":[{"path":"共享定义.json","sha256":"..."}],"scopeComplete":true}`。相对路径按清单所在目录解析。必须完整覆盖原 categoryId/key，保持原名称，不新增删除；同名同义共用定义，异义拆分有理由。所有类型重新校验，新内容待审，旧定义和前后哈希保留。数值参考区间不成为硬限值；只有完整子树全适用才生成父级继承建议。不重新跑候选研究或代替人工采用。

## 真实样本工具

```sh
# profiles.json 决定类目、检索词、已启用京东目录和样本筛选；不带 execute 只预检。
bun src/scenarios/product_governance_v4/scripts/read-enabled-catalog.ts --out outputs/my-run/enabled-catalog.json
bun src/scenarios/product_governance_v4/scripts/collect-vop.ts --out outputs/my-run --phase search --concurrency 8 --limit 100
bun src/scenarios/product_governance_v4/scripts/collect-vop.ts --out outputs/my-run --phase search --concurrency 8 --limit 100 --execute
bun src/scenarios/product_governance_v4/scripts/collect-vop.ts --out outputs/my-run --phase details --concurrency 8 --limit 100 --execute
python3 src/scenarios/product_governance_v4/scripts/extract-candidates.py --manifest outputs/my-run/sampling-manifest.json --out outputs/my-run/candidate-pools.json

# 此工具目前仅按 standardCategory.id 采样；必须传已核验的标准映射 ID。
# 真实目录子树用 categoryIds 查询，见“ES 类目范围与 SPU 统计口径”；不要混用。
python3 src/scenarios/product_governance_v4/scripts/read-own-source.py --category-id STANDARD_CATEGORY_ID --out outputs/my-run/own-receipt.json
```

VOP 并发支持 1—32，单类上限 1—100；回执按请求哈希缓存，报告采集日期。SDK 位于配置的 `--jd-project`（本机默认 ai-core）且需该项目 JD_VOP 环境配置。自有源通过 ES_NODE/ES_USERNAME/ES_PASSWORD 或 `--env-file` 配置，确认预检后加 `--execute`。不打印密钥/上游对象；不覆盖既有回执。标题规则只是初筛，须核混挂和对象；采样频次不是市场份额或必填依据。

抽取器保留参数/HTML原词及通用数量单位片段，不把正则片段当已核实事实或行业属性全集。专业类目需补研究、处理混挂，并提交完整候选取舍。profiles 的 categoryId 必须来自启用的京东目录，内部目录映射不能只凭同名认定。

启用目录工具使用 DATABASE_URL 或 `--env-file`，只读事务查询 public.jdvop_categories；加 `--execute` 才读取，不打印连接信息。`profiles.json` 需要 catalogFiles、categories（id/name/scope/searches 等）和可选 cacheDirectories；沿用真实回执和明确的 profile，不按类目同名自动猜京东ID。

## Excel

SKU 试填不复用“类目属性方案已同意”作为值的同意。使用 `scripts/build-sku-fill-review.mjs` 从已核查的 `review/sku-fill-results.json` 导出商品总览、值与证据、范围与补证。首表按每个 SKU × 本轮属性类目逐行列全位置，未提取或待核的值留空；原类目、建议类目和类目核查在首屏展示，依据、目标属性所属类目与真实ID在后面。建议改类须人工确认，未定位的不编造目标。可通过 `--data` 指定结果；旧数据还可用 `--issues` 接入绑定结果哈希的问题分类，未核实的身份问题不能自动认定为错挂。提取值统一左对齐，数值保持数值类型；保留原文证据和人工空白审阅列，另存文件保护已编辑稿。具体可复现命令见该批输出中的验收记录。

使用 bundled Node 和 `@oai/artifact-tool`：

```sh
NODE_RUNTIME src/scenarios/product_governance_v4/scripts/build-review.mjs --out outputs/my-run --filename 属性方案_v4.xlsx --modules BUNDLED_NODE_MODULES --freeze-left 1
# 已完成共享定义重整的三表视图；与前一命令按交付需求择一使用。
NODE_RUNTIME src/scenarios/product_governance_v4/scripts/build-shared-review.mjs --out outputs/my-run --filename 属性方案_三表.xlsx --title 类目属性 --modules BUNDLED_NODE_MODULES --freeze-left 1
```

默认 10pt、22px 固定行高；长文保留原单元格及备注；冻结列与单表覆盖见 [排版默认值](scripts/review-layout.defaults.json)。文件已存在且用户编辑过时拒绝覆盖；另选文件名。导出含所有类目、既有认可/本轮新增状态、候选取舍、同族对照、字段职责及来源。新合同稿还按需提供“类型与取值”“取值字典”“本轮修改”。不得把审校通过写成人工批准。

`build-shared-review` 从 `assemble-shared` 的同一数据生成 03 类目横表、04 属性长表、05 共享定义库，支持多级表头及原有排版参数。“选项”按类型显示，不给文本堆叠重复套话；继承建议和拆义原因可在 05 查看。定义库不是字典引用类型。

## 能力边界

[立讯模板研读记录](docs/luxshare-template-study-20261029.md)保留当时六类表达、定义库与取值字典的学习结论。后续能力补齐以本目录的类型合同和离线验收为准；支持类型不等于现有 232 类已完成类型整理，也不代表参考字典已获采用。

已接通离线输入选择、上下文准备和查询、样本工具、作者输出检查、原认可内容保护与 Excel 导出。当前没有商品重挂/属性新增/填写的生产写入口；每个目录的动态字段、公开与搜索生效、版本兼容、数量载体映射仍须上线前逐项核实。本次 Codex 代理 token/缓存计数不可见，不冒报缓存命中率或用量。

### 品类知识与重复分析

品类提取规则在 `knowledge/sku-extraction-packs.json`，冻结进填写合同，extract/value-review 按 SKU 范围实际加载。原文提取与有依据的品类推断分别展示，尺寸按每个值带单位的 `155mm*120mm` 格式统一。新增枚举先形成待审离线合同，不自动写线上。

[重复候选分析](docs/sku-duplicate-analysis.md)放在属性规范化后，先分组、列匹配依据与统计，不真实去重，不阻塞现阶段。当前仅完成规则设计，未宣称已实现全量重复判定。
