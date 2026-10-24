# 商品治理v3文档导航

本轮规范重审形成的文档已从v2迁入本目录。文件写在v2时尚未决定实现边界，建立v3后曾暂用跨目录引用；现在规范、设计、决策和执行入口都归v3，每份正文只维护一处。迁移保持已确认的业务决定，历史讨论仍保留当时的状态。

## 阅读入口与权威关系

| 文档 | 用途与状态 | 如何进入执行 |
| --- | --- | --- |
| [low/high前三项质量修复](pilot-quality-fixes-20261024.md) | 当前：共享ID、必填冲突、数量职责、准入依据；226项离线测试＋五阶段模拟验收 | 新合同强制decisions，真实8份结果作回归，旧结果不自动补全；未新增付费请求；剩余预留100元 |
| [洗脸巾与抽纸同族小范围验证](small-scope-reasoning-pilot-20261023.md) | 历史：精确3类和1次同族共同方案；low/high两轮现已执行 | 用户执行`batch-rerun --category-ids ... --reasoning-effort low --execute`；同轮冻结范围/档位，所有组共用原累计预算，开发不启动付费请求 |
| [真实响应回归与修复](rerun-repair-20261023.md) | 当前：修复rules-20261023的参数纠错、引用漏接、误拦及空方案展示；210项离线回归通过 | 原始响应录制进入真实装配/工具循环/检查；未新增模型请求，历史status与预算不改；专业质量仍待研究、人审 |
| [按新规则全量重跑](full-rerun-20261023.md) / [验收记录](full-rerun-acceptance-20261023.json) | 已由用户执行的历史轮次，保留旧结果与累计费用 | `batch-rerun --round 固定名称`同名只支持同版恢复；当前规则已有修复，不能直接继续该历史轮次 |
| [配置说明一致性修复](configuration-explanations-20261023.md) | 真实DeepSeek说明与precision=3的矛盾、程序生成设置、业务疑点与配置依据分开 | 新上下文/skill/R08和离线专项复审；原响应及配置保留，跨业务版本付费续跑仍阻断 |
| [真实失败复盘与恢复](batch-recovery-20261023.md) / [验收摘要](batch-recovery-acceptance-20261023.json) | 用户首轮21类的实际响应、根因、离线复核和单类纠正 | 先`batch-recover`零请求复核；170项回归；指定一个失败末级并`--execute`才新增付费请求，沿用原累计费用 |
| [类目属性批处理](batch-runbook.md) / [验收记录](batch-entry-acceptance-20261023.json) | 2026-10-23用户授权新增的手动DeepSeek提案入口、并发/类目参数、同族屏障、恢复及费用 | 152项回归通过；`batch`默认预检，`--execute`才请求付费模型；没有试填或线上写入 |
| [规范基线](governance-standard-draft.md) | 已确认的业务规则；文件名中的draft保留以便追溯 | `release.ts`固定hash并按阶段提取正文，进入instructions |
| [整体设计与供应链合同](governance-design-v1-20261022.md) | 目标、阶段、字段映射、验收及未实现事项 | 第5节后台合同进入instructions；其余作为实施与人审依据 |
| [业务词汇表](../GLOSSARY.md) | 同族、属性池、证据、候选与确认状态等术语 | 供维护者理解统一含义；不将整份词表重复注入每个请求 |
| [五份架构决定](#已确认决定) | 记录已确认的取舍与适用边界 | 维护和评审依据；不等于五份额外生成规则 |
| [DeepSeek分层接入设计](deepseek-context-skill-tool-wiring.md) | 固定规则、skill、动态知识和工具的分工；含接线前v2事实 | 当前已实现范围以[代码使用说明](../README.md)和验收为准 |
| [同族检索与并发提案](family-context-tools-and-concurrency-proposal.md) | 说明检索、归族、候选复用及并发协调；部分已离线实现，原子发布未实现 | 指导后续实现；不是可直接执行的命令 |
| [讨论与事实记录](governance-design-session-20261021.md) | Q1—Q47、根因、只读核查、历史状态和决策来由 | 历史追溯资料，不作为模型指令加载 |
| [离线验收说明](offline-acceptance.md) / [机器报告](acceptance.json) | 当前实际验证范围；构造样例与业务准确率分开 | 验证接线，不能视为业务采用或上线批准 |
| [规范落地审计与下一步顺序](implementation-audit-20261022.md) | 对照S0—S9/R01—R26的实际状态、漏接、程序反例与实施门槛 | 63项既有测试通过之外，另有20项审计观测；不启动跑批 |
| [首两步实施与离线回归](implementation-phase12-20261022.md) | 第1、2步完成时的实施记录 | 当时79项v3＋18项v2回归、类型和skill校验通过；不跑批或写线上 |
| [第3步真实样板](implementation-phase3-20261022.md) / [机器摘要](phase3-acceptance.json) | 有芯/无芯6件真实SKU、字段盘点、专业研究、原文候选/人工核实和小屏审阅 | 117项v3＋18项v2；真实资料、录制候选离线回放，非真实DeepSeek能力验证 |
| [审阅对象纠正记录](review-object-correction-20261023.md) | 类目属性方案先审，SKU提取/试填另审；保留最初试排时状态 | 当前取舍以紧接的准入修订为准；无自动方案采用 |
| [业务准入、简明名称及卷纸修订](attribute-admission-refinement-20261023.md) | 通用准入/命名/语义核实、五阶段skill及独立扩展候选合同 | 当前7项共用选填定义+6项扩展候选，张/节/格口径待核实；离线回放与新版Excel |
| [Excel默认样式与冻结参数](excel-review-layout.md) | 全sheet共享已确认的第一页样式；列数、列名边界及特殊覆盖参数 | 已接属性方案新建/重排，单行高、全文备注与原生冻结；历史导出不自动改写 |
| [真实样板运行说明](roll-pilot-runbook.md) | 只读采集/本地盘点、离线准备/回放、工作簿及初次事实意见导入 | 显式固定小样本读取；无跑批、自动采用或生产写入 |

模型实际读取的是规范相关章节、后台合同、[阶段skill和判例](../skills/)、按范围选择的[知识资料](../knowledge/)及工具结果。迁移文档不意味着把所有讨论全文塞进提示词，也不意味着整体方案中的Excel、图片、并发发布和生产执行都已经实现。

## 已确认决定

- [0001 先对齐供应链后台能力](adr/0001-current-supply-chain-contract.md)
- [0002 先同族共同基线、后末级差异](adr/0002-family-baseline-before-category-variants.md)
- [0003 候选基线可用于本批待审草案](adr/0003-candidate-baselines-for-scoped-drafts.md)
- [0004 治理属性统一SKU](adr/0004-sku-only-governed-attributes.md)
- [0005 v3承载新合同、选择性复用v2](adr/0005-v3-contract-with-selected-v2-reuse.md)

## v2历史资料的保留位置

[v2文档入口](../../product_governance_v2/docs/README.md)保留原架构基线、批量运行手册和效率核查。它们描述旧实现及冻结运行，不作为v3规则。迁移前版本可通过Git历史追溯；业务正文不在两个目录重复维护。
