# 平台真实样本与 DeepSeek 首版对照

2026-10-28：用户选择先试清洁用品下一个末级，由 DeepSeek 取舍及定义，人工复核，Codex 不修改生成的业务内容。该选择允许本次单类真实试验，不扩为232类付费批次。

`market-sample-cli.ts` 读取已完成采样的 candidate-pools.json、治理类目树、原累计账本。模型固定 deepseek-flash / low。默认只预检，显式 `--execute` 发送请求；最多两个阶段、每阶段4轮。不会自动购买纠错循环或清零预算。

```bash
bun src/scenarios/product_governance_v3/market-sample-cli.ts \
  --pool <已采样的candidate-pools.json> \
  --category-id <目标末级ID> \
  --tree <完整类目树或batch.shared-snapshot.json> \
  --budget-dir <原累计预算目录> \
  --out <本次固定输出目录>
```

预检确认后，明确授权执行时追加 `--execute`。同一目录重复执行从请求回执精确回放；已产生付费请求后，输入、规则或宿主代码变动将阻止重跑，不能隐式重买。尚未发送请求的预检可以刷新，旧预检保存在 preflight-history。

## 接线与边界

- 公共业务规则取规范的第1—6节完整正文，专用 `market-sample-modeling` skill 实际加载。共享供应链字段职责、数量职责完整前置。旧建模的增量输出合同不用于此试验。
- 类目、同父候选、样本标题与规格、所有平台原始候选及完整去重值分布随后载入。明细证据不塞成重复长表；冻结原文由分页 `read_candidate_evidence` 和 `read_sample` 访问。`categories_search` 检索完整冻结树。
- 同名属性/父类不能授予复用；已有清洁纸品不作为垃圾袋的冻结共同基线。此次不建立整个垃圾袋族，也不填写SKU值。
- selection 逐项取舍，definition 接续整段对话定义纳入项。JSON合同和工具定义保持相同，全部响应、reasoning项、call_id与工具回传原样追加。固定前缀不包含轮次、时间戳或随机ID。
- 原始HTTP回执、输出原文、JSON、工具历史、完整材料及指纹分别存档。程序核对结构、覆盖、引用和阶段一致性；业务疑点旁存，不替模型修改，不等同于专业质量通过。
- 输出保持待审。空白不代表同意。导出只作中英文枚举标签显示、数组分行等无损呈现，保留业务文字及其顺序。

## 缓存统计

复用 ResponsesClient 与原预算。`localReplay` 是本地回执复用；`cacheHitTokens` 来自服务商usage，二者分列。命中率用累计命中输入token除以累计输入token，缺失usage为未知。首轮新前缀通常未命中；后续阶段在同一历史尾部追加，不重新改写前缀。缓存不保证命中，不额外发送预热请求。

供应商说明读取于2026-10-28：[Context Caching](https://api-docs.deepseek.com/guides/kv_cache/)。完整前缀匹配及落盘时机会影响实际命中率；不能用本地前缀字节率冒充服务商token统计。

## 首次真实结果（2026-10-28）

平口式垃圾袋按标题初筛200个SKU中的158个，按品牌轮换读取100个详情（49个京东SPU、39个品牌），归集26种来源字段，含16种平台参数原名。DeepSeek调用两次read_sample后完成候选取舍与定义，实际3次响应，生成9项定义。输入239965 token，命中150784（62.8%），未命中89181；输出16228（含思考6257）。逐轮命中0%、64.5%、95.9%，无自动预热。

首次网络尝试被Bun启动时继承的socks5h代理协议阻止；无密钥HEAD探针复现UnsupportedProxyProtocol，清理启动环境后HEAD返回401，验证直连可达。原失败回执与1.9元保守预留保留，单独直连试验沿用原累计账本，三个响应追加5.7元保守预留。预留不等于实际账单。入口现在在任何预留和认证请求之前以清洁环境重启自身，避免仅删除运行中变量无效。

定义阶段返回了5个缺失unit键，程序没有补null、改名、降低必填或追加付费纠错。原始响应已保存，旁存的离线审阅记录保留原始JSON字段集合，并记录结构问题及阶段差异。模型将尺寸拆成袋宽/袋长、将3项设为必填等业务决定由用户判断。本次没有已核实的垃圾袋专业知识包，也没有建立跨垃圾袋族的继承范围；平台样本不是专业标准。

读取已保存输出并导出（无模型请求，保留已有审阅文件）：

```bash
bun src/scenarios/product_governance_v3/market-sample-inspect.ts <本次固定输出目录>
# 使用load_workspace_dependencies返回的Node执行：
node src/scenarios/product_governance_v3/scripts/export-market-review.mjs <本次固定输出目录>
```

`raw-review.json`核对provider回执和原文、两阶段完整前缀及usage。Excel遵循统一10pt/22px布局，左侧冻结可用`--freeze-left`或`--freeze-through`配置。原型采样暂调用outputs中已验证的配置驱动VOP采集器和字面提取器；尚未合成任意大类一键采样跑批入口，也未自动发现同族专业包。

## 验证

```bash
bun test src/scenarios/product_governance_v3/market-sample.test.ts
```

检查跨阶段输入前缀、reasoning及工具往返保留、候选值不丢失、非法结构拦截、检查不改变输出，以及真实服务商缓存统计口径。模拟测试不证明模型业务质量，后者由真实首版及人工审阅判断。
