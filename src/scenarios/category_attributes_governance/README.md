> 五金30类属性包已生成：`bun run category-attributes-governance:hardware-pack`。参见[构建、对照与验收边界](dictionary/hardware/README.md)，属于开发参考，尚未独立验收。

> 当前新增离线[属性知识库与验收方法](dictionary/方法与验收.md)：`bun run category-attributes-governance:dictionary build`。来源记录与标准定义分层管理；尚未将新字典自动接入下面的付费试验入口。

> 标准属性字典已判 3 批（129 条属性，覆盖 59% 的属性名×末级类目配对），挂载已在四个形态不同的分支上跑通：法兰 16 末级、压力测量 11 末级、防寒服 12 末级、塑料润滑脂 8 末级，四份运营验收 Excel 累计计费 1.27 元（含全部调试与重跑；干净跑一个分支 0.12~0.17 元）。命令是 `bun run category-attributes-governance:branch plan --branch=法兰` 先本地估价，确认后 `run`。
>
> 挂载给出了继续投入的方向判据：同样三批字典之后，法兰缺 6 条属性而防寒服缺 20 条——**按全量频次切批会系统性地饿死词汇分散的领域**，所以第 4 批（+3.1% 覆盖）不如按挂载暴露的需求补字典。为什么停在第 3 批转去跑挂载，见[标准属性字典](dictionary/canonical/README.md)；挂载的设计、四个分支的发现与已知的不确定性见[分支属性挂载](dictionary/canonical/branch/README.md)。

> 当前多轮试验入口与结果见 [流程说明-v3.md](流程说明-v3.md)。[v2对照说明](流程说明-v2.md)及以下内容保留历史记录；新流程尚未全量发布。

# 类目属性治理：证据驱动的有限多轮流程

本场景保持三横类目ID、名称、父子关系不变，只产生类目属性模板。与类目治理分开；未来类目治理的结果可通过 `--source` 输入。本版只读复用旧场景的原始类目快照、SKU详情提取器和京东客户端加载器，不调用旧的生成、共识或复审流水线，也不改写旧交付。

## 执行

```sh
# 准备整个五金工具上下文，显示试点清单，无API调用
bun run category-attributes-governance --plan

# 首轮6类真实验证，累计预算2元，关闭思考
bun run category-attributes-governance --pilot --budget=2 --concurrency=2 --direct

# 中断/失败后恢复同一次运行，预算指整个运行累计上限
bun run category-attributes-governance --resume=run-实际运行名 --budget=2 --direct

# 复用既有证据与模板，仅做增量修订和验收（不重走京东搜索）
bun run category-attributes-governance --refine-from=run-实际运行名 --budget=1 --concurrency=2 --direct

# 离线重建已校准的6类参考样板，API费用为0
bun run src/scenarios/category_attributes_governance/calibration/build.ts

# 单类验证
bun run category-attributes-governance --category=充电式热风枪 --all --budget=1 --direct

# 试点验收之后，才考虑大品类全量（此命令会付费，达到预算自动停止新请求）
bun run category-attributes-governance --category=五金工具 --all --budget=30 --concurrency=16 --jd-concurrency=2 --direct
```

试点包含充电式热风枪、插电式热风枪、充电式电钻、六角套筒、防爆六角套筒、热风枪发热芯。五金工具原快照共2,258个末级。6类不是统计意义上的全量质量验收，只用于发现整机/配件/特殊用途混淆、资料适用性和成本问题。

AI配置在 `src/ai/deepseek-runtime.ts`：优先 `DEEPSEEK_API_KEY`，否则读取公共库已有加密密钥。用官方当前模型名 `deepseek-flash`，所有请求显式 `thinking: {type:"disabled"}`，出现思考token则停止该类目。`--direct`只影响当前进程，无法绕过操作系统透明代理/TUN或京东IP白名单。

## 为什么这样分轮

1. 固定规则：任务边界、属性协议、类型单位原则、证据等级；不存在随运行变化的时间或批次号。
2. 固定分支：发送目标三级类目及其子类的压缩树，父路径只出现一次。同分支兄弟类目可复用前缀。
3. 单叶研究：模型决定查询词、挑选SKU和参考资料。100是搜索候选上限，不是详情数；一次20候选，先选2~4SKU，需要时补到最多6详情。最多5轮研究、18工具调用。可以改词、翻页，也可以弃用所有不合适证据。
4. 核心模板：一次生成能够选型的核心字段集合，不强行每次只给三个。
5. 增量补充：最多2轮，只输出新增、替换、删除，不重写整个模板；无变化或done结束。检查缺失、冗余、适用性，不能“为了继续而继续”。
6. 独立验收：新对话只看类目、候选模板、选中的原始证据，不带生成者自评。发现实质问题最多修订1次再验收；仍有问题保留待审，不无限循环。
7. 人工抽查与采用：`accepted`表示独立模型验收通过且取得外部证据，不等于人类定稿。无需从第一轮再全量生成；修正原理与提示词后用相同试点比较。

这个流程采用AI做语义匹配与属性选择。程序只做层级压缩、工具边界、SKU身份核验、JSON契约、引用存在性、预算与落盘；不以硬编码行业规则或字符串打分自动决定商品属于哪个类目。

## 缓存的三个层次

- 本地事实缓存：同一京东搜索/详情、已读网页复用，旧1000SKU详情也可使用。原始详情不直接全部发给模型；提取字段带稳定引用ID，原响应保留于cache。
- 本地请求重放：`responses.json`按完整请求哈希存原始响应。恢复同一次运行时已验收类目跳过，其他类目重放相同请求，无需再次付费。协议、类目、模型参数或资料库变化时禁止假装恢复原运行。
- 服务端KV缓存：保持固定system、工具定义、分支文本在前；同叶会话原样追加assistant/tool/user消息。不要改写前轮回答、插入时间戳或不断排序历史。兄弟类目共享前缀，后面的历史各自分叉。

缓存默认开启，不存在提示词“打开缓存”。最新官方规则以完整落盘前缀单元匹配，共享前缀检测也会落盘；因此首次请求和紧接着的高并发冷启动不能保证高命中。缓存命中是尽力而为，过期后可能消失。压缩减少token，稳定前缀提高可复用性，两者相关但不等同。

不做无业务价值的“请记住这些类目”暖缓存调用。首个类目的实际工作承担预热；需要评估预热策略时比较实际费用和延时。多轮的旧输出会作为后续输入，输出本身仍按输出价格收费；所以命中率上升并不保证总费用下降。应看每个可验收类目的费用、有效属性增量和人工缺陷率。

研究阶段使用工具调用，不强行叠加JSON输出模式；结束研究后，生成和验收使用 `response_format: {type:"json_object"}` + 短键对象 + 本地校验。程序将短键对象无损转换为固定10列元组，比要求模型直接输出大量位置敏感的元组更稳定。JSON模式不等于严格JSON Schema或行业正确性；空content和截断仍要显式处理。Beta strict function calling是另一种能力，初版不混入以免增加变量。

参考：
- [DeepSeek KV缓存](https://api-docs.deepseek.com/zh-cn/guides/kv_cache/)
- [JSON Output](https://api-docs.deepseek.com/zh-cn/guides/json_mode/)
- [工具调用及strict Beta](https://api-docs.deepseek.com/zh-cn/guides/tool_calls/)
- [思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/)
- [模型价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)，核对日期2026-09-15；按Flash高峰价预留：百万命中0.04元、未命中2元、输出8元。价格变化需更新 `meter.ts` 后再运行；真实账单由平台决定。

## 证据与搜索工具

- `jd_search(query,page)`：复用现有VOP搜索接口，先看商品标题、品牌和京东类目路径。检索结果不自动当证据。
- `jd_detail(sku,reason)`：只能查本会话已召回SKU，必须说明适配理由；按SKU校验后提取字段。模型在研究结束选择可用证据，拒绝的字段不能被模板引用。
- `web_search(query)`：如果配置 `TAVILY_API_KEY`，调用Tavily真实搜索，返回摘要及URL；搜索费用另由该服务计费，不包含DeepSeek预算。未配置时仅检索 `knowledge/web-sources.json` 已核验资料，明确返回 `local-verified-library`，不会宣称已实时联网。当前种子库只收录热风枪官方技术资料，不是完整行业库。
- `web_read(url)`：仅允许搜索返回的公开HTTPS URL；HTML/文本抓取最多2MB，精炼给模型最多10,000字符。阻止本地/私网地址，逐次检查重定向。PDF暂需人工读取并精炼进资料库；不把摘要当作已读全文。

使用自己的搜索服务时可替换web_search适配器，继续遵循同一证据契约。DeepSeek工具调用是“模型提出调用→本程序执行→回传结果”，不是DeepSeek自动拥有互联网。参考 [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search)。

证据引用 `K` 表示模型行业知识，其他ref明确关联SKU参数或网页段落。高频出现并不自动代表正确或必填，单型号的值不自动成为枚举全集。外部证据不能证明的内容允许保留为K或待核验；不要伪造参考来源。

## 可追溯产物

`workspace/context/<hash>/`：无损保留层级、ID、名称和状态的CAT1结构文本；原始API快照含payload另存gzip，避免把原始字段丢失误称全量无损。上下文恢复有往返测试。

`workspace/cache/`：共享工具结果。缓存按内容/请求键固定；本版没有自动过期，类目知识库刷新时应明确换快照或移除对应缓存后新开运行，不自动悄悄替换正在用的证据。

`workspace/output/run-*/`：
- `查看结果.md`：逐类模板和待核验问题，供人工评审。
- `templates.std.json`：字典+索引，属性含类型、必填、单位、枚举、条件、格式、引用。
- `results.json`：完整属性、原类目和选中证据，状态分开。
- `trace.jsonl`：请求、原始响应、工具调用和增量记录，集中记录，不按每个attempt拆碎文件。
- `usage.json`、`summary.json`、`tool-usage.json`：每次调用的计量、预算与统计。
- `manifest.json`、`responses.json`：冻结清单/协议/参数指纹与同请求恢复。

并发预算先预留后请求，成功取得usage再据实按保守费率结算；未知超时保留预留额，失败/格式不合法产生的tokens也计费。预算用完不强行继续，不自动充值。新场景目前采用文件版本管理，未覆盖旧数据库/正式模板。

## 验收与下一轮改进

先人工检查：核心规格是否齐全；普通/防爆、充电/插电、整机/发热芯有没有混用；必填是否能在真实SKU上填写；单位/范围是否清楚；每个外部引用是否真正支持该字段。再比较“单轮核心稿”和“有限多轮结果”的有效变化。只有补充轮带来可用增量或消除实质缺陷，才值得保留。

测试：`bun test tests/category-attributes-governance.test.ts`，覆盖压缩往返、JSON契约、无效引用、并发预算、未知请求费用、恢复重放和独立验收边界。

## 本次试点结论（2026-09-15）

6类已完成真实京东取证与有限多轮生成，最终候选没有请求/格式失败，但6类自动验收仍标记待审，其中既有实质问题，也有审阅误报。没有把待审状态改成通过。三轮实验按高峰价保守计量合计0.93993144元，思考token为0；详细对比见 [试点记录](PILOT_FINDINGS.md)。

已用取得的证据逐类校准成84项属性参考样板，查看 `workspace/reference/pilot-v1/查看样板.md`。校准补丁保存于 `calibration/pilot-decisions.json`，绑定来源文件哈希；离线构建会校验类目覆盖、属性契约和引用。状态为 `architect_reference`，保留原模型判定，不覆盖旧交付。它是下一轮评估的参考，不代表自动流水线已验收通过。

下一步先用这6类对齐实质缺陷与审阅标准。京东商品只用于提炼属性维度、定义、单位、枚举边界和适用条件，不进行商品挂载、上架或逐SKU属性填写，也不将商品填写率作为类目模板验收指标。自动验收误报尚未解决前，不建议全量铺开2,258类。不要为了缓存命中率而重复付费生成。

## 四阶段拆分实验（attribute-stages-v1.3）

```sh
bun run src/scenarios/category_attributes_governance/staged-entry.ts \
  --category=热风枪发热芯 \
  --evidence-from=run-2026-09-15T02-54-03-942Z \
  --budget=0.3 --direct
```

一次一个末级类目；来源运行必须有该类目的原始证据。不把旧候选或架构师样板输入模型。实验复用取证结果，不重新调用京东；此前工具取证入口保留。

1. **身份与维度规划**：只看原类目，逐项考虑自身身份、适配对象、性能、结构和交付所需维度。自身品牌/型号用明确key记录，省略必须说明理由；不能悄悄用适配品牌/型号替代。
2. **证据支持度判断**：只看维度计划和原始证据，区分直接支持维度、仅样本值、跨对象类比、不相关和不确定。每条判断引用字段原文，外部依据不足仍可保留为K行业知识。程序不以关键词规则判断行业适配。
3. **字段规范**：保持每个维度，定义类型、单位、条件、格式。每个key只能引用第二阶段判定直接支持的字段或K，不能跨用其他属性的证据；缺证据不能自动删维度。直接依据仅支持维度，不自动证明必填性或封闭枚举完备。
4. **内部一致性检查**：只看完整属性行，定位类型、单位、格式、条件和定义矛盾，问题必须指向当前key、列及其原文。不重新评估商品值，不因有知识缺口就否决整个模板。

模型引用R0、R1等短ID，程序按evidence-reference-map.json恢复原始字段引用，错误定位的引用进入rejectedLinks隔离记录，不猜测替换，不进入白名单；其余有效引用继续处理。引用存在与原文吻合只证明可定位；支持关系仍由模型判断，可能误判，不能当事实证明。

输出后缀为-staged的目录：01-dimensions.json、02-evidence-support.json、03-schema.json、04-consistency.json，以及完整请求/响应与usage。历史v1.1三阶段目录保留。阶段共享固定system和类目前缀，只传必要上游结果；不为提高缓存命中率填充无用历史。

每阶段JSON契约失败最多重答一次。规范之后增加独立填写要求判断（03a-requirements）：只看维度，不看旧必填结论；将结果应用到03b-applied-schema。存在审阅意见时，再调用05-review-resolution逐条裁决；confirmed与uncertain均保留待审，dismissed意见仍存档，不以关键词过滤。语义问题不无限修订。accepted表示本次阶段检查没有报告阻断问题，**不表示行业完整性或所有证据判断已通过最终验收**。此前审阅有误报与漏报，因此必须保留阶段原始记录与外部评估。

验证：`bun test tests/category-attribute-stages.test.ts`，覆盖身份省略说明、维度覆盖、证据白名单、逐字引用、短引用恢复、阶段输入隔离和关闭思考。

## 五金工具30类分层试跑

```sh
# 只生成清单，无API费用
bun run src/scenarios/category_attributes_governance/batch-entry.ts --plan

# 30个原二级分支各一个末级，统一预算、并发
bun run src/scenarios/category_attributes_governance/batch-entry.ts \
  --run --budget=5 --concurrency=4 --direct

# 恢复尚未完成的类目；预算为原运行累计上限，不是额外增加5元
bun run src/scenarios/category_attributes_governance/batch-entry.ts \
  --resume=run-实际名称 --budget=5 --concurrency=4 --direct
```

清单在workspace/plans/hardware-30。抽样跨越全部30个二级分支，是代表性探索，不是随机统计抽样；不能据样本通过率推算2,258类总体合格率。已批准本次30类试跑上限5元，后续命令亦需按实际预算设置。

命中已有类目的原始证据直接复用，其他类目由模型选择京东候选并读取详情。京东并发独立限制2，模型默认并发4；保留原类目，不写商品属性，不改旧交付。缺外部证据仍可生成K知识候选，但标待审。

每类阶段产物在categories/<原类目ID>/，总结果在查看结果.md、results.json、summary.json、batch-status.json。模型调用计量和原响应集中保存。预算不足时保留已完成类目和当前部分结果，不强行越额；resume复用同请求缓存，并跳过所有已有终态结果（含failed），不会暗中重复收费修失败类。代码/范围改变时禁止恢复旧运行。

语义对照入口：`bun run src/scenarios/category_attributes_governance/semantic-regression.ts`（调用DeepSeek，当前上限0.08元），覆盖3个错误证据、2个有效证据及2条错误审阅/1条真实矛盾。预期答案只在模型响应后比较，不发给模型；通过不等于全行业已验收。
### 30类验证的断网补跑

```sh
bun run src/scenarios/category_attributes_governance/retry-network-entry.ts \
  --from=run-2026-09-15T03-35-45-455Z-hardware30 \
  --concurrency=2 --direct
```

只补连接异常，不盲重跑格式失败。必须保持原运行协议和类目范围相同；成功响应按完整请求哈希在本地复用。补跑写新目录，合并保留全部类目的结果；原始结果不覆盖。费用台账和未知扣费预留从来源运行继承，累计沿用原预算，不能把补跑当作新的5元额度。继续补跑时用最新目录作为`--from`，避免重复使用旧预算台账。一次只运行一个补跑分支。

2026-09-15首次30类验证及断网补跑的评估在
`workspace/output/run-2026-09-15T03-48-48-537Z-hardware30-network-retry/试跑评估.md`。
合并18类内部检查通过、4类待审、8类契约失败；尚不适合全量无人值守定版。`accepted`不代表行业属性完整正确。
