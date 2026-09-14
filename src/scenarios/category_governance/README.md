# 标准类目治理

这个场景把类目治理拆成四个可重复的步骤：导入类目、生成标准上下文、调用模型、合并多次结果。`toStdText`、`makeContextChunks`、`compactTemplates` 都是纯函数，可以被其他业务直接复用。

## 一次完整运行

类目已经导入并生成 v1 上下文后，可以直接用一个 Bun 命令跑全量治理；不传 `--category` 就会覆盖全部末级类目。默认并发为 64，可按 DeepSeek 账户限流提高到 128 或 256：

```bash
bun run category-governance --concurrency=128 --batch-size=12 --attempts=1
```

如果本机代理把 API 请求转成 `socks5h`，Bun 可能不支持该代理协议，可以只让本次治理直连 DeepSeek：

```bash
bun run category-governance --direct --concurrency=max --batch-size=8 --attempts=3
```

也可以只治理某个类目（支持完整 ID、短 ID、名称或完整路径）：

```bash
bun run category-governance --category="办公用品" --concurrency=64
```

入口会自动检查并迁移公共库和类目治理库；`--input=/path/to/category.raw.json` 可在治理前先替换当前 v1 类目快照。`--dry-run` 只生成请求文件，不调用模型。

先准备浏览器导出的原始 JSON（对象中放 `items` 数组，保留接口原始字段）：

```bash
bun run cli db:init public
bun run cli db:init category_governance
bun run cli scenario:run category_governance run import ./sanheng-standard-category.raw.json --version=v1 --group-depth=2
bun run cli scenario:run category_governance run govern --version=v1 --group-depth=2 --batch-size=12 --attempts=3 --concurrency=4
bun run cli scenario:run category_governance run merge --version=v1 --group-depth=2

# 或者用 pipeline 串起导入和治理；先用 dry-run 检查提示词与请求文件
bun run cli scenario:run category_governance run pipeline ./sanheng-standard-category.raw.json --version=v1 --group-depth=2 --dry-run
```

默认 `--group-depth=2` 会按接口的一级子类生成 23 个上下文分片（内部根节点深度为 1）；这里的 `level-1/level-2` 只存在于 `context` 下，是“输入分片边界”，不是重新定义类目层级。类目过大时可改成 `3` 或 `4`。每次重建 v1 上下文会清理旧的 `level-*` 分片，避免不同输入残留在同一目录。

短 ID 是由真实类目 ID 做 SHA-256 后截取的稳定指纹，并非随机数。真正的输入溯源以 `manifest.json` 的 `source.path`、`source.sha256`、`importId` 为准，`category-tree.json` 同样保留 `sourcePath`、`sourceSha256`、`importId`；每个治理请求和结果文件也会携带同样的输入指纹。每次治理运行直接写入 `output/v1/run-<runId>/`，不会与其他输入或批次配置混在一起；`merge` 默认合并最新 run，也可用 `--run-id=<id>` 指定。旧版本的 `output/v1/level-*` 结果仍可兼容读取。

治理入口实际读取固定的 `context/v1/category-tree.json`，再根据目标类目生成本批次的精简文本，不会扫描目录中所有 `.std.txt`。`.std.txt` 是便于人工检查和复用的压缩导出；真正发送给模型的完整 system/user 输入保存在每个 `attempt-*.request.json`。启动日志会显示输入路径、导入记录 ID 和原始文件 SHA-256，运行 manifest 还记录归一化上下文的 SHA-256。`--attempts=3` 表示一个批次最多尝试三次，失败时会把校验原因反馈给下一次请求；每个通过校验的类目立即写入结果表，同批其余失败类目单独重试。

为了利用 DeepSeek 的前缀缓存，批次请求会先放入同一类目组的固定压缩上下文，再放本批次变化的目标类目；运行开始时每个类目组先完成一个预热请求，缓存落盘后才并发发送剩余批次。运行结束会打印并在 manifest 的 `usage` 中保存输入、输出、总 token 以及 `promptCacheHitTokens` 和 `promptCacheMissTokens`，可以据此调整 `group-depth`、`batch-size` 和并发策略。DeepSeek 官方说明只有从输入起始位置完整匹配的前缀才会计入缓存命中，缓存本身是尽力而为。[上下文硬盘缓存说明](https://api-docs.deepseek.com/zh-cn/guides/kv_cache/)

## 京东参考证据

京东库里的类目树和商品详情属性不是三横类目的替代品，只作为候选字段证据。治理入口会自动查找 `workspace/context/v1/jd-attribute-evidence.json`，也可以显式指定：

```bash
bun run category-governance --jd-evidence=/absolute/path/jd-attribute-evidence.json --concurrency=max --batch-size=12
```

文件可以是以下紧凑结构；每个京东类目只保留经过采样统计的属性，不要把九千多个类目全部拼进每次请求：

```json
{"version":"jd-v1","source":"jd-vop-sampled","categories":[{"id":"655","path":["手机","手机通讯","手机"],"attributes":[{"name":"屏幕尺寸","type":"text","unit":"英寸","values":["6.1","6.7"],"observed":128},{"name":"运行内存","type":"number","unit":"GB","observed":120}]}]}
```

程序会按三横目标末级类目匹配最多两个相近京东类目、每个类目最多十六个属性，并把证据放在目标类目列表之后。这样固定的类目树前缀仍可命中 DeepSeek KV 缓存，京东证据只增加当前批次需要的少量输入；`--no-jd-evidence` 可关闭。京东证据缺失时流程照常运行，不会因为参考库不可用而中断。

可以用项目内置采样器从京东 VOP 生成证据文件。它先调用 `searchSku` 找候选 SKU，再调用 `getSkuDetailInfo` 聚合 `categoryAttrList` 和 `paramGroupAttrList`；默认只采样 10 个三横末级类目，避免误触发全量请求：

```bash
# 先采样一个类目，确认代理和字段质量
bun run category-governance:jd-evidence --category="手机" --skus-per-category=8 --concurrency=2 --direct

# 按三横一级类目分层抽样，每个一级类目取 2 个末级类目
bun run category-governance:jd-evidence --sample-per-group=2 --skus-per-category=5 --chunk-size=46 --concurrency=4 --attempts=2 --direct

# 采样前 100 个末级类目
bun run category-governance:jd-evidence --limit=100 --skus-per-category=8 --concurrency=4 --direct

# 明确允许全量采样（京东 VOP 请求量较大）
bun run category-governance:jd-evidence --all --indexed-only --skus-per-category=8 --chunk-size=100 --concurrency=4 --attempts=2 --resume --direct
```

采样器默认从 `/Users/sanheng/Project/sanheng/ai-core/.env` 读取京东配置，并更新稳定文件 `context/<version>/jd-attribute-evidence.json`；每次运行还会在 `output/<version>/jd-evidence/run-<时间戳>/` 保存完整快照和 `manifest.json`。可用 `--jd-project`、`--out` 覆盖稳定文件路径。重复运行同一输出路径会按目标类目更新证据，不会把重复类目无限追加。

全量采样按 `--chunk-size` 分块，每完成一块就原子写入稳定文件和快照；进程中断后重新执行同样的命令并保留 `--resume`，已有属性证据的类目会跳过。`--force` 可强制重采样。当前采集器对京东叶子类目采用保守匹配：要求叶子相同或与三横类目有明确包含关系并且 SKU 标题命中，明显的配件、保护壳、支架等不会仅因标题包含目标词而混入。

在扩大采证范围前，先生成三横到京东三级类目的离线映射。映射不会调用商品接口，结果会同时保存稳定文件和带时间戳的快照，保留每个类目的候选、分数和原因：

```bash
bun run category-governance:jd-mapping
```

映射状态分为 `auto_exact`、`auto_exact_path`、`auto_parent`、`review` 和 `unmatched`。只有前三种自动状态会进入采证；`review` 和 `unmatched` 不会被关键词强行召回。生成映射后，可以先跑一小批验证自动映射质量：

```bash
bun run category-governance:jd-evidence \
  --sample-per-group=2 --skus-per-category=8 --search-page-size=20 \
  --concurrency=4 --attempts=2 --chunk-size=50 --indexed-only \
  --resume --direct
```

确认日志中的“映射增强”类目和证据质量后，再继续全量断点采证：

```bash
bun run category-governance:jd-evidence \
  --all --indexed-only --skus-per-category=8 --search-page-size=20 \
  --concurrency=4 --attempts=2 --chunk-size=100 --resume --direct
```

映射文件是 `context/<version>/jd-category-mapping-v1.json`，采证运行的 `manifest.json` 会记录实际使用的 `jdMappingCount`。这样每条证据都能追溯到三横类目、京东类目 ID 和映射理由；后续人工确认 `review` 项时，只需把对应状态改为自动状态并保留新的映射版本。

原始京东证据会完整保存；发送给治理模型前只做轻量标注：`weak=1` 表示低频字段，`hint=platform_field` 表示可能是平台运营字段，`hint=placeholder_values` 表示值可能是占位符。代码不直接删除这些字段，由模型结合当前类目语义决定是否采用；需要时可在公共函数选项中显式设置最小观察次数。

## 多批次属性共识

模型每次返回的是候选结果，不直接覆盖正式模板。可以把多个治理运行汇总为属性候选和稳定决策：同一属性按规范化名称合并，统计出现批次、必填意见、公共属性意见和来源运行；默认至少两批且覆盖率达到 60% 才标记为 `confirmed`，覆盖率达到 30% 的保留为 `candidate`，其余进入 `review`。国补备案型号、上市时间等低价值字段会在决策层再次过滤。

```bash
# 汇总指定的多次运行；不传 --run-id 则读取 output/v1/run-* 全部运行
bun run category-governance:consensus --run-id=20,22

# 调整确认门槛
bun run category-governance:consensus \
  --run-id=20,21,22 \
  --confirmed-coverage=0.6 \
  --candidate-coverage=0.3 \
  --min-confirmed-runs=2
```

汇总结果写入 `output/<version>/consensus/attribute-candidates-v1.json` 和 `attribute-decisions-v1.json`；`attribute-templates-v1.json` 只保留 `confirmed` 属性，是统计候选视图，不能代替语义验收后的正式模板。每次汇总另有带时间戳的快照。历史运行中无法通过当前属性校验的结果会跳过并记录到快照 `manifest.json`，不会污染共识结果。

统计共识之后，使用同一个 Bun 入口执行属性增量治理。流程为：**已采用模板 → AI 修改提案 → 独立语义验收 → 通过后采用**。类目树保持只读。

```bash
# 本地汇总原始候选；补跑 27～31 按一个逻辑轮次统计，不重复加票
bun run category-governance:consensus --run-id=19,24,25,26,27,28,29,30,31

# 查看待处理范围，不调用模型
bun run category-governance:semantic-review --changed-only --sample=30 --plan

# 抽样验证新的输入/协议
bun run category-governance:semantic-review --changed-only --sample=30 --concurrency=8 --attempts=2 --direct

# 精确复测指定历史清单，不让已经成功的样本被另一批替代
bun run category-governance:semantic-review \
  --from-run=run-20260914T063111-388Z \
  --concurrency=8 --attempts=2 --direct

# 后续只处理尚未通过验收的类目，带入上一轮问题，避免从头猜测
bun run category-governance:semantic-review --failed-only --concurrency=8 --attempts=2 --direct
```

`--from-run` 从 manifest 读取准确类目 ID；可加 `--category` 选择清单中的某类目。它与 `--limit`、`--sample`、`--all`、`--changed-only` 互斥。不传范围时默认最多 10 个；大范围用 `--all` 或 `--changed-only`。`--limit`、`--sample`、`--all` 互斥。并发可用整数、auto（64）或 max（2500），实际工作数取选中类目数和配置的较小值。两阶段在同一工作任务内顺序执行，所以不会把并发乘二。

初次使用新流程时，从冻结的 `baseline/attribute-templates-v1.json` 初始化已采用模板。旧版仅通过 JSON 校验的工作文件会备份到本次运行的 `legacy-templates-before-migration.json`，不自动当成通过了新验收。没有冻结基线的新版本从空模板建立；禁止把候选统计票数直接当成定稿。

提案中不变的旧属性默认保留，删除旧属性必须明确给出 key 和理由。AI 只输出 `upsert/remove` 和一句不确定性说明；修改旧属性时只返回改变的字段对象，新属性才返回完整定义。输入用十元组压缩，输出使用普通对象，避免深层数组和多套引用表示互相矛盾。未采纳的新候选留在候选库，无需逐条生成 drop；历史补充属性也不会因候选缺失而消失。无效引用、重复修改、空枚举和基本计量问题会被本地校验挡住；业务适用性、同义合并、核心属性是否缺失由 AI 判断，没有添加行业关键词黑名单或属性数量上限。

验收是另一次独立 AI 请求，只看完整类目、证据、旧模板和拟采用模板，不看候选堆或提案者的自评理由。它可以纠正旧模板本身的问题。发现跨类目属性、同义项、无依据枚举、关键属性丢失时返回具体问题；这些问题回到下一轮提案。`--attempts=2` 最多两轮，每轮最多一次提案和一次验收，验收格式失败时仅重试验收。仍未通过则保存为 `needs_review`，正式模板保留原值。独立验收仍由模型执行，不等于人工或行业标准认证；应继续用固定样本检查语义质量。

稳定文件为 `output/<version>/semantic-review/attribute-governance-state-v1.json`，包含已采用模板和每类目的当前状态，是原子写入的正式状态。`attribute-templates-v1.json` 是兼容下游的模板视图。冻结基线不可覆盖。每次运行主要保存：

- `manifest.json`：准确范围、来源、通过/待改进/格式失败、所有响应 token；
- `trace.jsonl`：每次实际请求、原始响应与调用异常；
- `results.jsonl`：提案、独立验收结论、输入指纹及用量；每个类目完成即落盘；
- `attribute-templates-v1.json`：本次完成后的正式模板快照；
- `report.md`：属性数量变化、未通过原因与用量。

成功的新模板必须有与其内容指纹一致的验收结论才能写入。运行中断后，可用 `--resume-run=<新协议运行目录>` 从已落盘结果恢复已完成类目，再调用剩余部分。`--replay-run=<新协议运行目录>` 只使用输入完全匹配的已保存响应，API 请求为 0。旧协议没有独立验收，不能通过本地重新解析直接晋级；用 `--from-run` 对它的固定清单执行新流程。

候选、证据、协议及已采用模板都没变且已经验收通过时，默认直接跳过，**API 请求为 0**。仅重复生成相同属性定义、增加来源批次/频次，不算新知识。`--force` 才会重新请求已验收的相同输入，适合明确做模型比较；常规循环无需使用。待改进类目的具体反馈保留到下一次执行。新版本流程首次运行会重新验收选中的样本；历史旧记录不能冒充已通过新协议。

请求保持关闭思考。固定协议、类目、京东证据、已采用模板放在共同前缀；候选、拟采用模板和本轮反馈在后面。两个阶段尽可能共享前缀，但不会为了命中率向验收输入无用候选。[DeepSeek 官方缓存说明](https://api-docs.deepseek.com/zh-cn/guides/kv_cache/)明确缓存基于重复前缀、尽力命中，不能保证 100%。输入缓存只节省输入费用；减少重复请求、压缩修改输出同样必要。

原始生成批次的格式失败仍使用原入口补跑：

```bash
bun run category-governance --retry-run=28 --retry-batch-size=4 --concurrency=128 --attempts=2 --direct
```

该入口先读取本地历史响应，恢复已完整通过校验的类目，再调用剩余部分；补跑读取本地京东证据，不访问京东 VOP。生成批次只产出候选，需要汇总后进入上述增量治理流程。不要把原始生成批次的成功数等同于正式模板验收数。

详情接口成功但没有 `categoryAttrList`/`paramGroupAttrList` 的类目会记录到 `context/<version>/jd-attribute-evidence.empty.json`，这属于“空证据”而不是请求失败；`--resume` 会跳过它们，只有需要重试时才加 `--retry-empty`。

`--indexed-only` 只采集能通过京东三级 ID 映射的三横末级类目，适合作为第一阶段高精度证据；未生成映射文件时，当前原生同名唯一映射约 1,492 个；生成映射文件后，自动映射会扩展到同名路径消歧和有父路径证据的包含关系。未匹配类目不是接口失败，而是两套类目体系没有可靠映射，后续应单独做同义词/人工映射，再开启关键词补召回，避免用低置信度证据污染模板。

导入会写入独立库 `ai-building-category_governance` 的 `category_nodes_v1`；导入、运行、结果分别写入 `category_imports_v1`、`governance_runs_v1`、`attribute_templates_v1`。新的不可变版本可以使用 `--version=v2`，并通过新的迁移增加对应 `_v2` 表，不覆盖已完成的 `_v1` 记录。

## 上下文格式

`toStdText` 用缩进表达父子关系：`+` 是非末级、`*` 是末级、`!` 是停用类目，`i=` 是可回填的短 ID。每个分片只写一次共同父路径，真实 ID 和原始 payload 保存在 `category-tree.json`、`id-index.json`，所以压缩不会损失信息。

## 属性模板输出

提示词以领导示例的字段为基准：属性名称、说明、类型、必填、单位、选项、格式、示例。模型直接返回紧凑的 `a/c` 字典：`a` 保存本批次唯一属性十元组，`c` 只保存每个类目对属性的引用，`*` 表示必填。解析器同时兼容旧的 `items` 普通 JSON，因此历史结果仍可合并；紧凑输出会降低输出 token 和截断导致的 JSON 不完整概率。

完整目录优先使用项目已有的无筛选接口 `/manage/product/product-hub/api/searchStdCategory`，在登录页面会话中 POST `{ "name": null }`，返回 13,647 个节点，并直接提供接口层级 `level`（根为 0，四级类目为 4）。导出文件应保留接口原始字段和根节点 `51fae85e-d76e-45c1-bd10-d3d75e45545d`（标准类目）。重新导入同一版本会替换 `category_nodes_v1` 当前快照，避免不完整抓取的旧节点残留。

旧页面没有该接口时，脚本会回退到登录态 Next Server Action：action `5b7ad81b023bb2bae7938740d4aa3b662c2b0868`，请求体为 `[{"bucket":"source","fatherId":"<父类目实例 ID>"}]`，解析响应中 `1:` 行的 `data.data`；只继续请求 `children` 非空的节点即可避免对末级类目重复请求。

可直接把 [browser-export.js](./browser-export.js) 粘贴到该页面的 DevTools Console 执行，下载 `sanheng-standard-category.raw.json` 后再运行上面的 `import` 命令。
