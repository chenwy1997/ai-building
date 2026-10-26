# 输出截断恢复与离线验收

本次只修运行容量和回执处理，保持业务规范、skill、知识包、模型low档及原累计账本。由用户执行付费请求，开发只做离线验证。

## 真实问题

`resumptions/clean-paper-full-20261026`包含全部21类：16类已有属性方案待审、4类零正式属性、1类抽式擦手纸输出截断。保留的9份原结果未改变；12个续跑目标中11个完成。零属性的四类是一次性日杂、手帕纸、生活用纸、餐巾纸，仍有对象边界或跨类适用性缺口。

截断回执HTTP200，status为incomplete，reason为max_output_tokens。上限24000，实际输出24001，其中思考19939。原来的通用catch将它记成outcome_unknown并漏记usage，导致后续账本校验也阻断。这不是代理错误或账号余额不足。

截至此轮账本234次请求，累计保守预留304.20元，有效上限1000元、剩余695.80元。原19次新请求的provider输入缓存命中率为97.53%；本地18次历史重放与provider缓存不是同一指标。

官方[模型规格](https://api-docs.deepseek.com/quick_start/pricing/)为1M上下文、384K最大输出；[Responses合同](https://api-docs.deepseek.com/api/create-response/)明确输出上限包含思考和正文。配置取65536，留出生成完整JSON的余量，不代表已实测本次重试一定成功。

## 通用实现

| 组件 | 行为 |
| --- | --- |
| response-capacity.ts | 校验输出上限1..393216；新任务默认65536；大于24000时超时600秒。以原保守预留叠加额外输出预算，不改变旧预留或补充余额 |
| response-outcome.ts / responses.ts | 区分completed、incomplete、failed和未知传输结果；已知终态保存原始响应、usage和状态；部分工具调用不执行 |
| request-journal.ts | 核对请求、原始HTTP响应hash和回执。旧宿主误记的明确截断可离线识别；执行重放时旁存outcome-resolution并恢复账本中的终态/usage，原回执保留 |
| runner.ts | 显式outputRecovery最多提高一次输出容量；历史截断计入原6轮，业务纠错仍最多2次；截断响应原件存档，完整旧输入/已完成工具结果继续携带，不拼接半份JSON |
| batch-resume-source.ts | 校验保存的resumption与源轮次、全部保留结果及付费历史。成功结果用正常工具循环离线重建对照，失败按实际终态筛选 |
| batch-resume.ts | 复用上述基础能力，只编排失败目标、原基线和完整汇总。无固定类目ID、数量或本轮名称 |

`batch`与显式新轮次`batch-rerun`接受`--max-output-tokens`，默认65536。旧冻结轮次不会因修改默认值而自动换容量或重买循环。`batch-resume --max-output-tokens`针对已保存resumption的明确输出截断；其他业务阻断保持待处理。

本轮一次新请求保守预留1.80元，超时10分钟；调高的是输出上限，不强制模型用满。模型、原输入快照、思考档位和1000元累计上限不变。

## 用户执行

在项目根目录运行以下命令。去掉`--execute`仅预检；不要改成batch-rerun或另起round。

```sh
bun src/scenarios/product_governance_v3/cli.ts batch-resume \
  --out outputs/product-governance-v3/clean-paper-batch-20261023 \
  --from-round clean-paper-full-20261026 \
  --max-output-tokens 65536 \
  --reasoning-effort low \
  --concurrency 32 \
  --execute
```

已用真实文件完成离线预检：动态选中抽式擦手纸1类，保留20类和全部基线；精确重放4次历史响应（包括截断回执），最多新增2次请求、3.60元保守预留。源码检查和模型质量检查仍执行。原账本及付费文件在离线预检中不修改。

新汇总和Excel写入：`resumptions/clean-paper-full-20261026/output-recovery/review/`。保留原Excel和已填人工意见，不将旧意见自动套用到新提案。重复相同命令只读取已有请求，不重复付费；改变已执行的扩容参数/版本或再次截断时会停止，不能靠换参数不断购买循环。

## 验收边界

回归fixture保留本次真实HTTP状态、用量及截断的可见JSON，删除思考正文；后续成功响应是离线构造数据。验证20份结果保留、只发目标新请求、完整输入/工具历史、次数不重置、同命令零新增、坏回执/未知传输继续阻断、content_filter不扩容、再次截断不无限重试。离线验收不等于新的DeepSeek结果已通过。

详见同目录`output-truncation-acceptance-20261026.json`。四个零属性类目的业务缺口仍需单独核实，不通过本次容量修复重新生成。
