# 跨类目适用性检查与三类新轮次

2026-10-26，针对 quality-cache 轮次中“定义未变但跨类适用性未核实”的问题完成离线修复。本次开发没有调用付费模型、修改思考档位或写线上；原轮次、原响应、原 Excel 和累计预算均保留。

## 实际约束

定义一致性与目标范围使用两个独立程序检查。R03 的 `shared-definition-identity` 继续约束完整定义；新增 `target-category-applicability` 核对这份定义是否已登记用于本次目标类目。属性池命中、专业就绪自述、有效引文、选填配置或保留原定义都不能替代范围登记。

可复用范围来自两种冻结输入：

1. 已有同族合同的成员范围。confirmed 或本批 candidate 可以作为待审输入；他批候选、失败和在途记录不能授予使用范围。同族共同基线任务必须覆盖全部目标成员，不只检查锚点。
2. `Snapshot.attributeApplicability` 中针对属性 ID、完整定义指纹及精确末级 ID 的核实记录。supported 才能支持复用；pending/not_applicable 会阻断对应范围。记录包含 reviewKind、reviewRecordId 和 reason，定义变更后旧指纹失效。父类目不会隐式授权所有子类目。

`attributeApplicability` 是可选的冻结输入字段，缺省表示没有额外核实记录，不表示全局适用。模型输出 schema 不允许新增该字段，现有只读工具也不能写入。fixture 记录仅可用于 fixture 快照。本次没有向真实资料新增任何 supported 记录，也没有把模型的“已确认”转成宿主核实记录。

不支持复用时，应保留扩展候选、对象/状态/口径的核实事项和共享范围修订建议。程序同时阻断换 ID/显示名后复制原定义或同概念同 scope 的参数。确实不同对象的独立定义仍可提案，不因缺少样本取值而删除必要参数。

范围登记的依据是否真实，以及新提案是否只是语义改写，仍需要专业与人工审阅。程序能核对已登记身份、范围和版本，不宣称完成专业语义判断；没有新增基于自然语言关键词的自动“适用性判断器”。所有通过结果仍待人工采用。

## 接线位置

- `attribute-applicability.ts`：统一目标成员解析、定义匹配、冻结范围核对；共同基线覆盖所有成员。
- `snapshot.ts`：核实记录的来源类型、精确目标、指纹与记录完整性检查；明确待核实/不适用的定义也不能被后续 SKU 填写合同消费。
- `tools.ts`：`search_attribute_pool` 在定义列表之外返回逐项 `reuseApplicability`。评估对象始终是宿主任务，查询其他类目不能扩大本次范围；分页只附带本页定义的评估。
- `context.ts`：预取结果包含范围信息，并提供 `modelingTargetCategoryIds`；共同定义、知识、引用和工具历史保持完整。
- `checks.ts`：最终准入属性必须经过范围检查；错误进入既有有限纠错循环及审核辅助上下文，不能被空审核意见抹掉。
- 规范第2节、R03职责映射、建模 skill及真实判例、审核辅助 skill 同步修订，进入冻结 release。

## 真实反例与验收

原始 `fixtures/pilot-quality-cache-20261026.json` 保持原样与来源 hash：

| 真实输出 | 定义一致性 | 新范围检查 |
| --- | --- | --- |
| 抽纸共同基线 | 通过 | 拦截 roll.fragrance、roll.layers、roll.sheet_size 从小卷纸直接跨类复用 |
| 洗脸巾 | 通过 | 拦截 facial.pack_count、roll.sheet_size 的未核实跨类复用 |

删除输出中的待核实说明、继续使用 professionalReadiness=defined 仍然被拦截。正例覆盖正常同族继承、显式目标范围核实；反例覆盖只支持一个同族成员、旧定义指纹、父级代替末级、他批/失败记录、改 ID/名称/scope 标签复制、模型伪造核实记录、审核辅助抹掉错误以及下游 SKU 合同绕过。

真实反例经过 `assemble → 模拟 Responses → 属性池工具回传 → 程序反馈 → 修订输出重检` 验证。修订输出将未核实项目移到候选，是明确标注的构造响应，不是 DeepSeek 新生成的业务结论。旧的体积回归仍保留全部真实基线字段；其正向循环另外使用明确标注的 fixture 核实记录，不冒充旧方案获得真实批准。

验收结果：

- **253 项 v3 测试通过，0失败；TypeScript 检查通过；五阶段离线模拟验收通过。**
- 两个修改过的 skill 的 YAML 元数据及引用路径使用 Bun 校验通过；系统 Python 缺少 PyYAML，未把未完成的 Python 校验器运行记作通过。
- 使用上一轮真实生成基线装配，洗脸巾为156,915字节、两个抽纸末级各196,634字节；200,000字节上限未提高，也没有截断规则或知识。未来生成内容体积仍可能不同，运行时继续检查并明确报告超限。
- 本次 release：`31ab39aed3fed17eb897207b56c709369441bdd2ab1b4686ec77eebc3d4e3e49`。
- [机器验收摘要](target-applicability-acceptance-20261026.json)；[行为回归](../attribute-applicability.test.ts)。

## 用户执行的新轮次

已对下面同名同范围命令做了不带 `--execute` 的预检：ready=true，恰好3个末级、1次抽纸共同基线，concurrency=3、deepseek-flash/low，联网次数0。预检表示当前输入与预算可执行，不保证尚未生成的业务方案全部通过。

在仓库根目录执行：

```sh
bun src/scenarios/product_governance_v3/cli.ts batch-rerun \
  --out outputs/product-governance-v3/clean-paper-batch-20261023 \
  --round pilot-wash-tissue-applicability-20261026 \
  --category-ids 7a1ea510-8777-46ba-bfa0-955b472a0d61,640b5b8b-9d6e-4784-a8e2-53c291f0b7f7,ce3a9f67-613c-4707-bf3a-95193edb8a2d \
  --reasoning-effort low \
  --concurrency 3 \
  --execute
```

继续使用原批次根目录中的 requests 与 budget.json，不清零、不提额。目前149条历史请求、累计预留193.70元、有效上限280.70元，剩余87.00元。本轮最多24次请求、保守追加预留最多31.20元，预算可覆盖；这不是实际账单估计。预检前后预算文件 hash 相同。

新结果目录是 `outputs/product-governance-v3/clean-paper-batch-20261023/reruns/pilot-wash-tissue-applicability-20261026`。正常中断或失败仍使用同一轮次名处理，不能换名静默购买一轮。执行完复核目标范围/候选分流、共同定义和数量职责、纠错次数、用量与 provider token 缓存命中率；原 quality-cache 轮次保留作对照。
