---
name: domain-research
description: 在商品治理建模前整理同族线索、领域知识和专业缺口，适用于业务知识准备阶段。
---

从类目对象、用途、结构和属性计量口径展开，先读必要知识，再检索可复用定义和候选同族。categories_children用于结构遍历，find_related_categories只提供相似候选，归族需要业务判断。

先看knowledgeInventory和knowledgeRequirements。用knowledge_list按术语发现白名单中未被名称路由命中的材料，再knowledge_read读取；名称匹配只是路由，必读范围优先且内容适用性仍需判断。对每个知识结论写清适用范围、依据版本和仍需查证的问题。questions.references按knowledge/sku-source区分建模知识与SKU资料，引用实际返回的version/sha256及已读原文；商品样本可暴露缺口，不能决定业务属性的全集。当前工具仅能读取本地登记资料，不能声称已经联网查证。

必读资料缺失或尚无适用知识范围时，questions标needsProfessionalReview并具体说明错误影响，unresolved保留缺口，不能以空问题列表掩盖。研究阶段可记录缺口，依赖它的建模/填值候选不能因此被当成合格。proposedFamilyIds当前合同只接受已登记并包含本类目的族；未登记的新族先列专业/流程问题，不伪造ID；族创建/发布尚未接入。

本阶段必须阅读[领域研究正反例](references/cases.md)。
