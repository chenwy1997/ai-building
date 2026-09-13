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

治理入口实际读取固定的 `context/v1/category-tree.json`，再根据目标类目生成本批次的精简文本，不会扫描目录中所有 `.std.txt`。`.std.txt` 是便于人工检查和复用的压缩导出；真正发送给模型的完整 system/user 输入保存在每个 `attempt-*.request.json`。启动日志会显示输入路径、导入记录 ID 和原始文件 SHA-256，运行 manifest 还记录归一化上下文的 SHA-256。`--attempts=3` 表示一个批次最多尝试三次，失败时会把校验原因反馈给下一次请求；只有最终成功的那一份写入结果表。

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

# 采样前 100 个末级类目
bun run category-governance:jd-evidence --limit=100 --skus-per-category=8 --concurrency=4 --direct

# 明确允许全量采样（京东 VOP 请求量较大）
bun run category-governance:jd-evidence --all --skus-per-category=8 --concurrency=4 --direct
```

采样器默认从 `/Users/sanheng/Project/sanheng/ai-core/.env` 读取京东配置，并更新稳定文件 `context/<version>/jd-attribute-evidence.json`；每次运行还会在 `output/<version>/jd-evidence/run-<时间戳>/` 保存完整快照和 `manifest.json`。可用 `--jd-project`、`--out` 覆盖稳定文件路径。重复运行同一输出路径会按目标类目更新证据，不会把重复类目无限追加。

导入会写入独立库 `ai-building-category_governance` 的 `category_nodes_v1`；导入、运行、结果分别写入 `category_imports_v1`、`governance_runs_v1`、`attribute_templates_v1`。新的不可变版本可以使用 `--version=v2`，并通过新的迁移增加对应 `_v2` 表，不覆盖已完成的 `_v1` 记录。

## 上下文格式

`toStdText` 用缩进表达父子关系：`+` 是非末级、`*` 是末级、`!` 是停用类目，`i=` 是可回填的短 ID。每个分片只写一次共同父路径，真实 ID 和原始 payload 保存在 `category-tree.json`、`id-index.json`，所以压缩不会损失信息。

## 属性模板输出

提示词以领导示例的字段为基准：属性名称、说明、类型、必填、单位、选项、格式、示例。模型直接返回紧凑的 `a/c` 字典：`a` 保存本批次唯一属性十元组，`c` 只保存每个类目对属性的引用，`*` 表示必填。解析器同时兼容旧的 `items` 普通 JSON，因此历史结果仍可合并；紧凑输出会降低输出 token 和截断导致的 JSON 不完整概率。

完整目录优先使用项目已有的无筛选接口 `/manage/product/product-hub/api/searchStdCategory`，在登录页面会话中 POST `{ "name": null }`，返回 13,647 个节点，并直接提供接口层级 `level`（根为 0，四级类目为 4）。导出文件应保留接口原始字段和根节点 `51fae85e-d76e-45c1-bd10-d3d75e45545d`（标准类目）。重新导入同一版本会替换 `category_nodes_v1` 当前快照，避免不完整抓取的旧节点残留。

旧页面没有该接口时，脚本会回退到登录态 Next Server Action：action `5b7ad81b023bb2bae7938740d4aa3b662c2b0868`，请求体为 `[{"bucket":"source","fatherId":"<父类目实例 ID>"}]`，解析响应中 `1:` 行的 `data.data`；只继续请求 `children` 非空的节点即可避免对末级类目重复请求。

可直接把 [browser-export.js](./browser-export.js) 粘贴到该页面的 DevTools Console 执行，下载 `sanheng-standard-category.raw.json` 后再运行上面的 `import` 命令。
