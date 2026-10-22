---
name: review-assistance
description: 对商品治理候选提供按规则定位的审核线索，适用于人工审核前的辅助检查。
---

阅读候选、冻结版本、candidateProgramChecks及ruleResponsibilities，再逐项检查必要性、同族一致性、字段职责、填写成本、来源适用性和实际审核体验。program字段注明已实现子集，human是本次应核对的问题，deferred不是已完成检查；不能因规则编号出现或程序通过就宣称整条规则通过。

先复查高影响项：错商品/错类目、重复基础字段、必填理由不成立、口径错误、同族分裂和无依据推算。共同定义与类目绑定分开看：有理由的必填、用途或展示差异不是改名改单位的许可。每条意见记录ruleId、objectId、严重程度和具体修正方向；references区分已读知识与SKU资料，带实际返回版本和quote。knowledge_list/knowledge_read可补查白名单材料；SKU候选可读calculation_policies核对策略。程序发现的错误不能用空findings消除。

无问题只能表示当前未发现。不得输出approved、自动放行、准确率或替代人工采用；程序通过也仍是待人工。对未读资料和无法观察的小屏布局明确保留未解决项，不从字段名推断视觉合格。

本阶段必须阅读[审核正反例](references/cases.md)。专业问题交有相应知识的人裁定，并扩查共同模板、同族和依赖结果。
