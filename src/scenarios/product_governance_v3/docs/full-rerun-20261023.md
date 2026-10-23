# 按当前规则重新生成整批提案

2026-10-23，用户明确选择清洁纸品全量重跑。本次新增`batch-rerun`，开发阶段仅离线验收；实际DeepSeek由用户手动执行。机器验收见[验收记录](full-rerun-acceptance-20261023.json)。

## 直接执行

在项目根目录运行，先预览，不读取模型密钥：

```sh
bun src/scenarios/product_governance_v3/cli.ts batch-rerun \
  --out outputs/product-governance-v3/clean-paper-batch-20261023 \
  --round rules-20261023 \
  --category-id 77e31cf2-8331-4c73-ab10-823d2d1d7ab0 \
  --concurrency 32
```

同一命令追加`--execute`才请求DeepSeek。使用本地已配置的`DEEPSEEK_API_KEY`，不把密钥写入命令或提交。

```sh
bun src/scenarios/product_governance_v3/cli.ts batch-rerun \
  --out outputs/product-governance-v3/clean-paper-batch-20261023 \
  --round rules-20261023 \
  --category-id 77e31cf2-8331-4c73-ab10-823d2d1d7ab0 \
  --concurrency 32 \
  --execute
```

清洁纸品本轮为21个末级及2次同族共同方案。已审阅的小卷纸共同输入仍是7项定义、6项扩展候选；其两类末级也重新请求DeepSeek。原批次及旧纠正中的提案不会被当成本轮结果。原始类目树、字段职责和已审阅输入保持可追溯，全部请求装入当前release对应的规则、skill、知识和工具。新增的配置说明投影及R08检查正常执行；R03/R07/R11继续执行。

## 参数和恢复

| 参数 | 行为 |
| --- | --- |
| `--out` | 原批次根目录，始终保持一致，不传review或corrections目录 |
| `--round` | 必填的轮次名，1—64位字母、数字、下划线、连字符；同一轮始终使用同名 |
| `--category-id` | 可选，默认整个原批次；可以缩小范围，但不能越出原批次末级范围，范围随轮次名固定 |
| `--concurrency` | 1—128，默认8；重复执行可修改并发，仍先同族共同方案、后末级 |
| `--execute` | 显式付费请求；省略只预览 |
| `--no-excel`、样式和冻结参数 | 继续复用原导出入口和紧凑默认样式 |
| `--log-format` | 默认human；正常进度stdout、真实阻断stderr，也支持json和quiet |

固定轮次名绑定release、范围、输入和模型/费用配置。代码或规则版本变化后同名命令会阻断，不静默变成另一批收费任务。新版本确实需要另一轮时，由用户显式使用新轮次名。普通失败不要换名；重试原命令会读取该轮持久响应、恢复未完成任务。已失败的完整纠错循环也只重放，不自动购买下一轮。结果未知的回执先核查，不能通过新命名绕过。

新结果位于`原根目录/reruns/rules-20261023/`。其中`rerun.plan.json`为预览，`rerun.identity.json`绑定轮次，`batch.summary.json`和`batch.review.json`为本轮状态及审阅数据，Excel在`review/`。全21类始终留在进度表，程序失败的提案不混入可审属性。旧审阅表和人工意见保留；旧Excel中单独填写的意见不自动迁入本轮。

单独重导本轮Excel，不调用模型：

```sh
bun src/scenarios/product_governance_v3/cli.ts batch-export \
  --out outputs/product-governance-v3/clean-paper-batch-20261023/reruns/rules-20261023
```

## 累计费用及执行边界

请求、响应、回执和`budget.json`继续保存在原根目录，所有轮次共用该目录的进程锁。新轮次不建立新账本，不改原上限或自动提额。预览中的`originalRequestCount`是当前根目录累计记录数，可能包含已经执行的新轮次；它不等于本次将新增的请求数。

本机原记录54次请求，累计保守预留70.20元，上限200元，剩余129.80元。单请求1.30元为原冻结的本地保守预留，非实际收费。全轮最坏138次请求、179.40元新增预留，超过现有余额时`fullWorstCaseFitsRemainingBudget=false`会明示；实际执行仍按每次请求预留并在触顶时停止。不会为满足最坏上界擅自加钱；真实账单以供应商为准。

执行退出码沿用原入口：0表示本轮程序无阻断且导出成功，2表示程序阻断或导出失败，1表示前置/参数问题。程序通过仍待人工采用，无商品试填和生产写入。

## 验收范围

回归使用模拟HTTP，通过实际装配、工具调用/回传、同族屏障、并发调度、程序检查及持久请求链验证。覆盖全部23个任务重新生成、旧文件保留、跨轮累计预算、同轮重放、结果未知、命名/范围/版本漂移、冻结定义及说明冲突。模拟通过不代表真实模型质量。

本机只做真实原批次的离线预览；未启动付费重跑。重量3位精度的专业依据、张/节/格口径仍待研究，现有冻结输入没有被静默修改。
