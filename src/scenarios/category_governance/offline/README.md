# 原类目属性编制：离线工作记录

## 交付候选版 agent-delivery-v3

```sh
bun run category-governance:offline --delivery --edition=agent-delivery-v3
bun run src/scenarios/category_governance/offline/verify-output.ts --edition=agent-delivery-v3
bun run category-governance:preview --edition=agent-delivery-v3 --port=4321
```

`--delivery` 在既有知识模板上应用本轮知识决定，不调用 DeepSeek 或京东 VOP。`delivery-knowledge.ts` 保存业务域的填写要求与同倍率单位记法，`delivery-decisions.ts` 保存逐项查看后的明确类目/字段绑定，`delivery.ts` 处理来源留痕、服务/成套商品缺项及少量语义纠正。自然语言条件是模板契约，不是商品录入端的自动推理器。

本版全量检查原类目身份、重复字段、填写要求冲突、数值示例及压缩往返，并保留 `.repro/delivery-audit.json`。校核覆盖不等于全量逐类制造商资料验收；字段原始来源不改成虚构的“京东官方模板”。本轮知识只决定模板结构和建档要求，不编造商品值。

文件在 `workspace/output/v1/agent-delivery-v3/`。Excel保持单sheet、12列，不把长篇判断理由塞进商品填写流程；理由可在查看页和结构化记录中追溯。同一命令直接复用校验过的产物；更改知识后请另建edition。以下章节保留前两版的历史口径。

## 必填要求修订版

`agent-draft-v2-required` 使用与 v1 完全相同的输入快照。生成和查看：

```sh
bun run category-governance:offline --edition=agent-draft-v2-required
bun run src/scenarios/category_governance/offline/compare-requirements.ts
bun run src/scenarios/category_governance/offline/verify-output.ts --edition=agent-draft-v2-required
bun run category-governance:preview --edition=agent-draft-v2-required --port=4320
```

`requirements.ts` 逐知识包记录关键字段及理由，修改规则后随知识版本一起保存。不按全量必填率设目标，不按同名字段跨类强制套用。`required=true` 表示完整建档必填；`requiredWhenApplicable=true` 必须同时提供 `condition`，表示适用时必填。二者不能混用。适用但缺资料属于待补商品信息，不据此将模板字段降为选填。

品牌必填允许确认无品牌时填写“无品牌”，未知不能冒充无品牌。型号对有厂家型号/货号的商品条件必填，手机等明确按型号区分的整机必填；散件仍用尺寸、材料等字段识别。颜色、材质、功率等按类目分别决定，不全局必填。

网页和 Excel 的填写要求只显示“必填”“选填”及条件要求，不附加审定状态。来源仍保存在独立的 provenance 字段与知识快照。本轮修订 45 个已有知识包，没有将全部历史字段包装为逐项复核结果。共用定义归一化保留输入候选的 required 值，取消品牌、型号一律降级的代码。

`requirements-comparison.md` 是代表类目变化，`.repro/requirements-comparison.json` 保留完整前后明细。核查同时要求原类目与属性集合不变。既有 v1 产物保留；当前代码复现修订版请显式使用以上 edition，避免用最新知识重新生成旧版目录。

Excel 由现有导出函数在 Codex 自带 Node 与 artifact-tool 下执行，支持 `ARTIFACT_NODE`、`ARTIFACT_TOOL_MODULE` 覆盖路径。条件为自然语言模板要求；本流程没有新增商品录入端的自动条件判定器。

这条路径用于先把“属性从哪里来、适用于哪个类目、为什么保留”做成可查看成果。没有模型调用、数据库写入或京东采集。类目处理与属性处理通过带版本的树交换数据；本次比赛直接使用原三横 v1 树。

## 使用

```sh
bun run category-governance:offline
# 读取同一输入快照、同一知识版本，重复执行直接复用校验过的输出。

bun run category-governance:inspect "手机" --evidence
# 查看原类目和已采集京东字段，不调用接口。

bun run category-governance:preview
# 本机打开 http://127.0.0.1:4319/，Ctrl+C 停止查看服务。

bun run src/scenarios/category_governance/offline/verify-output.ts
# 校验原类目、来源哈希、全量属性结构与各独立分片，结果保存在 .repro/verification.json。
```

结果在 `workspace/output/v1/agent-draft-v1/`：`view.html` 为入口，`attributes.xlsx` 为单 sheet 比赛格式，`templates.std.json` 为可还原的全部结果。`context/` 是按原一级类目切分的模型可读上下文。`.repro/` 是输入快照、来源路径、知识与明确类目映射；不需要逐文件查看。

## 架构与职责

1. 输入契约是原 `CategoryTreeDocument`：类目 ID、父 ID、名称和层级有版本与哈希。编制不会改写它。未来类目治理流程输出同一契约，属性流程读取新版本。
2. `knowledge.ts` 是本次 Codex 的语义工作成果：商品族定义、属性含义、计量单位、条件适用、建档要求和参考来源。属性来自领域知识、制造商资料和已有商品样本。历史候选只属于候选，不能充当外部证据。
3. 语义判断属于作者。作者阅读原类目、候选、相邻类目和商品证据，然后写显式路径/末级名称映射、排除项与原因。`build.ts` 只做严格绑定，不靠关键词猜测商品类别，也不会用低信息占位模板填满覆盖率。
4. 对需要明确比较的商品族编制完整模板；对已有特殊属性较多的族补充核心属性。剩余候选可以查看，但逐类标明未逐项业务核验。没有自动宣布全部合格的状态。
5. 选项需要定义适用范围与完整性。历史单选/多选转为开放文本，旧选项保存在 `suggestedValues` 中供作者研究，不冒充经证实的枚举。京东样本出现率不会自动设置必填。
6. `codec.ts` 将重复属性、来源、描述与类目路径做字典引用；`toStdText/fromStdText` 对完整结果做往返验证。这是可读结构压缩；本地输入 gzip 只是归档，不是模型缓存。
7. 查看页、Excel 与上下文来自同一结果。`manifest.json` 记录输入、知识、实现和产物哈希，复跑可以判断是否真的相同。保持旧基线和正式模板文件不变。

## 已确认的重要边界

- “螺栓”下有“平垫”；“耳罩”下有“保暖耳罩”；“离心泵”下有“离心式雾化工业加湿机”。这说明父类只提供上下文，不能直接当属性继承的事实。
- RAM 与存储容量不是同一属性；DN 与实际内径不是同一数值；额定流量与额定扬程应在同一工况配对。
- 同一属性名出现在京东只能证明存在一个同名观测，不能证明单位、必填、闭集枚举或适用范围完全一致。
- 默认值缺失不等于 0/false。复合结构用结构化填写约定或条件属性，不要求所有商品具有全部配置。
- 本次离线输出是草稿版本。编制范围与原候选范围分开记录，防止重演“程序完成 = 业务定稿”。

## 工程师如何复用

对一个新商品族，先用 inspect 读取相关叶类和本地证据。确认商品对象，再整理一个最小充分模板，明确核心字段和不适用条件。在 knowledge 中写实际映射及来源，执行离线命令看结果。新增知识有独立版本，字段定义可以在多个明确对象中共用。不要为了覆盖更多类目放宽匹配成模糊关键词。

有新类目输入时建立新 edition，并提供覆盖该树的候选和证据文件：

```sh
bun run category-governance:offline --version=v2 --edition=agent-draft-v2 \
  --tree=/absolute/path/category-tree.json \
  --candidates=/absolute/path/candidates.json \
  --evidence=/absolute/path/jd-evidence.json
```

旧版同名类目不自动继承身份；路径或 ID 有变化时需要重新检查映射。缺少候选会报告缺失，不自动调用模型。

## 这次留下的可执行能力

- 读取和按语义对象检索现有类目/京东证据：`inspect.ts`。
- 纯函数编制、严格绑定、来源记录及不改类目校验：`build.ts`。
- 可独立分片的无损结构文本：`codec.ts`。
- 全量离线查询页：`view.ts`。
- 12 列、单结果 sheet Excel：`excel.ts`（使用本机 Codex 自带 artifact-tool，可用 `ARTIFACT_TOOL_MODULE` 指定路径）。
- 输入归档、版本哈希、可重复执行入口：上级 `offline-entry.ts`。

执行顺序是先形成知识与样板，验证其实际业务价值，再考虑让便宜模型完成限定任务；本入口本身没有接入外部模型的开关。
