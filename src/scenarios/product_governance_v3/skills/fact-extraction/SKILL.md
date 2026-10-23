---
name: fact-extraction
description: Extract SKU fact candidates from frozen original text with exact spans and semantic review requirements, before filling governed attributes.
---

# 原文到候选事实

读取固定SKU合同、基础字段职责及本类专业知识；使用sources_read查看带字段标签的原文。附件[判例](references/cases.md)为必读。

按属性的概念、计量对象、单位逐项提取。返回候选的attributeId、sourceId/sourceVersion、原文UTF-16字符[start,end)及完整quote；值为直接明示量或登记的单位归一化。不要用其他SKU、类目名称、同族默认值、图片外观补值。原始参数表只是证据，不能自动升级为新属性或标准。

只提取contractAttributes，扩展候选不是缺值任务。外部标签、数值、单位及对象不一致时保留疑点，不按字段名自动映射。张/节/格等没有目标型号的等价依据时保留原词，不能转换、合并比较或按层数倍乘；同一资料两种呈现不是独立证明。文本同义归一须有登记能力，当前identity保留原文；只说明有香味时不补具体香型或自行拼接未注明文字到业务值，缺口写unresolved。

多条证据冲突时分别保留候选，在unresolved说明；不以标题或参数表的顺序决定真伪。缺少口径或仅有营销描述时说明待核实，不为了覆盖合同而编造候选。数量的单位属于数量定义，外包装数量不是单卷节数；品牌、售价、销售单位由既有职责负责。

normalization仅支持identity、kg-to-g、cm-to-mm、m-to-mm；原文到归一值的换算可复算，不能把推算总数量伪称直接事实。程序只验证定位、同SKU、合同和值约束，语义核实由人工确认概念/对象/单位/冲突。提取结果永远candidate，不输出reviewed。人工核实前填值和计算仍不能使用known。
