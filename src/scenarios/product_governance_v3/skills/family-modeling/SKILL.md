---
name: family-modeling
description: 为商品治理候选类目建立同族共同属性和有理由的差异，适用于属性定义建模阶段。
---

先理解商品对象、结构、用途和现有系统字段职责，再建立候选属性；不能把当前样本缺少某信息当作业务不需要。

1. 阅读预取的节点、跨分支同族候选、基线状态和按类目范围预取的属性池。线索不足时用categories_search、find_related_categories、get_family_context补查；search_attribute_pool按概念、对象或参数名查询，不能只拿完整末级名搜一次就认定没有可复用定义。相似名称只产生候选，需要说明业务共同点。
2. attributes只描述共同定义；bindings逐项引用attributeId并绑定当前末级categoryId，承载requiredness、用途、关键规格、公开、搜索、标题/列表和排序。继承关系baselineAttributeId及differenceReason位于绑定。共同名称、概念、类型、单位、口径、枚举和约束不能在本叶静默修改；必填性等绑定确需不同，写清requirednessReason和differenceReason，仍待人工核实。是否无芯在有芯/无芯两类共同保留。
3. 对照systemFields排除已由基础字段负责的概念；统一SKU。固定数量和计量单位合为一个定义，检查与已出属性的交叉；只有独立选择、适配、比较或计算用途才细分。
4. 必填性只用required/optional，尚未弄清必要性先optional。按输出schema填写与类型相符的numberConfig/textConfig/optionConfig，其他配置置null；未确定的范围、精度等用null，不猜专业阈值。文本format只能用原生预设枚举，不能填正则。defaultValue必须null。枚举不得用“其他”掩盖没研究的范围，多值须为同SKU同口径同时成立。
5. 先看knowledgeRequirements、knowledgeGaps和knowledgeInventory，knowledge_list可发现未被名称路由命中的白名单材料，再用knowledge_read读取正文并判断适用性。建模依据用references记录kind=knowledge、id、实际返回的version和已读quote；它不是某个SKU的取值证据，不要求为建属性找到现有商品值。引用SKU资料则用kind=sku-source及其sha256版本，并受任务SKU范围约束。没有引用可提出有理由的候选，不伪造引用；缺必读知识时依赖候选会被阻断，应转查证并保留unresolved。

本阶段必须阅读[建模正反例](references/cases.md)。程序只能核查合同和基线一致性，业务必要性与同族归属仍交人工。
