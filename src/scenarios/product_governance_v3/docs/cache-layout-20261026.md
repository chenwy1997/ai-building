# 稳定请求前缀与离线验收

日期：2026-10-26。用户要求固定规则、skill和共享资料在前，类目/任务差异及每轮状态在后。本次完成实际请求装配、工具循环、回执恢复检查和回归测试；未运行付费批次、修改线上或改变思考档位。

## 请求实际顺序

1. `instructions`保留固定规范、后台合同、当前阶段skill正文及登记附件；启用纠错/收束时增加固定运行协议。同一循环各轮的instructions完全一致。
2. 第一条user消息仍是原来的完整JSON对象。先放资料边界，再放阶段规则职责、系统字段及数量职责、已选择的知识正文；随后放同族基线、属性池、类目/相似类目、知识适用性、版本、商品/证据和具体任务。
3. 后续按发生顺序保留模型响应（包括reasoning项）、每个function call对应的function output、合同纠错反馈。工具分组全部回传完毕后，才追加当前轮的`host_runtime_state`。

`host_runtime_state`给出round、maxRounds、toolCallsRemaining和finalOnly。它是追加消息，旧状态保留在历史里，固定协议明确最后一条宿主状态才代表当前预算。finalOnly仍由原来的程序条件决定，并继续发送`tool_choice: none`；程序仍独立检查轮数、工具数和纠错上限。

原来每轮的“第1/6轮、剩余16次”直接拼到instructions里，第二轮改动就出现在大段资料之前。现在运行状态位于末尾，每轮input完整保留上一轮input作为前缀。没有新增缓存开关、额外预热请求或自动等待付费流程。

知识目录里的`requiredForTask`和`routingMatch`属于类目差异，因此也排在知识正文之后。知识仍按原范围、原版本选择；不会为共享前缀加载不适用材料。

## 完整性、预算与恢复

- `request-layout.ts`仅重排JSON对象字段，不删减字段、概括正文、去重或更改数组顺序。未来新增但尚未登记排序的字段仍完整放入尾部。资料继续作为user数据，未提升成系统指令。
- 保留原语义`inputHash`，另记`requestLayout.version=stable-prefix-v1`及原始字符串的`inputWireHash`。恢复时同时核对语义和已登记的实际发送布局指纹；旧记录仍执行原来的业务/版本检查。
- 200,000字节上下文、350,000字节完整请求、工具输出和最多两次纠错等上限不变。超限继续阻断，不能静默截断。末尾状态消息同样计入完整请求预算。
- 同版本、同任务重复执行重放原始持久响应，重建相同工具读取记录，不新增HTTP请求或费用预留。结果未知仍阻断，禁止自动重发。
- 本次改变了冻结的运行材料，已更新release。历史low/high轮次、真实请求/响应及预算保持原样；原轮次名仍不能跨release续跑，不会自动创建或执行新轮次。

## 离线验证

`bun test ./src/scenarios/product_governance_v3`：235项通过，0失败；v3 TypeScript检查通过。

新增覆盖五个阶段的真实请求装配/模拟HTTP、完整JSON往返、同族共享前缀、资料边界、未知新增字段、多工具回传、原生reasoning项、工具错误、程序纠错、收束、字节上限及零请求恢复。既有真实low/high业务结果回归及版本/预算阻断继续通过。这里的“五阶段”使用构造响应，不能作为真实模型业务质量结论。

```sh
bun test ./src/scenarios/product_governance_v3
./node_modules/.bin/tsc -p src/scenarios/product_governance_v3/tsconfig.json --noEmit
bun src/scenarios/product_governance_v3/cli.ts offline-acceptance \
  --out outputs/product-governance-v3/offline-cache-layout-20261026
```

五阶段验收共10次注入模拟HTTP、5次模型工具调用，均核对上下文指纹、固定instructions和历史前缀。报告在上述目录的`acceptance.json`，精简记录见[验收摘要](cache-layout-acceptance-20261026.json)。

## 历史请求离线重排对照

读取原low/high共26份请求，对同一份旧业务上下文应用新布局，保留历史响应、所有tool outputs和纠错文本，比较重排前后相同文本前缀。仅用于隔离布局影响，未把旧业务输出重新认证为符合新合同，也未向DeepSeek发请求。

| 对照范围 | 旧前缀长度 | 重排后前缀长度 |
| --- | ---: | ---: |
| low的8组相邻轮次 | 24,525 | 120,703–156,619 |
| high的10组相邻轮次 | 24,525 | 120,704–172,707 |
| low：盒装/软包抽纸首轮 | 31,516 | 134,671 |
| high：盒装/软包抽纸首轮 | 31,645 | 139,032 |

单位是按instructions、顺序role/content拼接计算的UTF-16字符数，不是token数，也不是DeepSeek内部提示序列。18组相邻请求全部保留上一轮input作为精确前缀；26份原上下文及工具/纠错历史全部保留。重排后的请求仍全部低于原350,000字节上限，最大281,788字节。逐请求ID和指标保存在同目录`historical-prefix-audit.json`。

原139条请求的预算台账前后hash一致，剩余预留额度仍为100元。

## 能确认与仍需实测的事项

本次能确认固定内容不再被轮次数字提前打断、共享资料更靠前、工具与恢复接线保持完整。无法用离线字符前缀推算缓存命中token、节省金额或模型语义表现；请求顺序变化后的真实业务质量仍须小范围实测。[DeepSeek官方说明](https://api-docs.deepseek.com/zh-cn/guides/kv_cache/)表明缓存依赖相同前缀、落盘时机和服务端策略，命中不保证。

以后由用户执行已明确的新轮次时，再比较API usage中的缓存命中/总输入、纠错次数及业务质量。CLI的`cacheHits`仍表示本地整份响应重放次数，与provider token缓存不同。
