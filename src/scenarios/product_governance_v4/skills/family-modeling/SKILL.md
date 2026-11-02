---
name: family-modeling
description: 对照同族共同候选，逐类确认适用性并完成取舍与SKU属性定义，避免由采样差异造成不一致。
---

完整读 ../../docs/standard.md、../../docs/attribute-type-contract.md 以及任务包的字段职责、既有认可、原始池和同族资料。先共同候选集合，后逐成员适用矩阵，再取舍和定义；同父类仅作检索线索。

通用概念不能因某类没有观察值而消失。conditional 表示局部对象适用，仍选填，不创建条件必填枚举。工艺、材料及器具适配的真正差异明确说明，不能把纸、无纺布、织物全当同物。

每个原字段有一项 keep/merge/exclude/defer 决策，保留/归并必须有对应定义。先候选广度、再价值取舍；平台坏值不决定整项属性无用。原生去重按真实职责及目录版本确认，不按数据库列/字段类型硬排。warranty不能自动排除保质期。

遵循字段职责中的 restorationPolicy：保质期、本体尺寸和重量可作为选填候选；包装长宽高、毛重、物流重量、保修期及其他历史排除项保持排除，既有认可属性保留。原始测量对象未明时 defer，并标候选已开放/对象待核。恢复历史尺寸/重量候选为 keep/merge 时，提供 restorationScope.object=product_body 和 basis，说明来源支持哪个本体对象；包装字段不得改名归入尺寸/重量。单卷重量与整机重量同属本体重量，但定义不共用；已有尺寸无需重复新增。

沿用用户已认可的展示属性，实质改动给前后差异。短名、组合尺寸、数值单位一项，SKU维度、选填默认。定义要明确对象、口径、填写规则和具体用途；不把模型猜例值写成来源例值。

新增/修改稿根字段 attributeContractVersion=1，逐项提供 definitionId/definitionVersion、typing、valueExamples。开放信息留文本；固定计量对象用数值；真实二态用布尔；边界充分才采用单/多选枚举或字典，不追求枚举比例。数值精度/范围须有依据，观察值的最小最大不等于边界。多选先核同维度可并存，再写选择数与互斥组，不用多选掩盖维度混杂。

当前业务不使用字典引用类型，使用文本/数值/布尔/单选枚举/多选枚举。逐项复查可数值化概念，明确对象与单位；来源有范围或脏值不等于整个概念必须文本。审阅参考区间放 referenceRange 并标依据，不进入硬 min/max。尺寸保持有口径的组合文本。

同时执行 ../../docs/procurement-and-source-policy.md。采购问题先对照已有属性，缺口再新增。允许有维护机制的当前版本枚举，不要求已知全部未来规格：记录 enumPolicy 的依据类别、版本、来源家族与 review_new_version。数值枚举用 typing.choice.measurement 保留数值/固定单位/标签映射；不能把1.8L取整、组合相乘或直径改为容量。共享词库用 enumValues，类目子集用 typing.choice.allowedValues 和 applicabilityReferences（目录增量使用 bindings.allowedOptions/allowedOptionsReferences）。不同类目的适用值不能因定义相同自动继承；共用定义的复用用 reuseDefinitionId。新值保留原词待审，不自动判商品错误或扩充目录。平台设计类别混杂时分别映射已有含义，保持名称和规则简洁。

先写共用含义，再绑定类目；旧措辞不同不是拆 ID 的理由。同名异义须 splitReason，局部差异写 applicabilityNote。仅完整子树全部适用才建议父级继承。规则只写必要动作、换算或边界；文本“选项”留空。可维护粗分类枚举允许其他，但未知不能当其他，新值保留原词待维护。

任务包有字典时，使用 CLI query --kind dictionary --file 字典文件，按 ID/版本、词及分页读取；固定整项字典哈希和本类 allowedValueIds。来源原词、别名与规范值分开，构造例明确标 constructed，来源规范化例保留 rawValue/定位。引用候选字典不代表采用。不能拿上一类的允许子集直接套下一类，也不能因名字同叫容量就混用 L、GB、mAh。

同一 definitionId/版本核定义、类型、单位和必填一致性；同族共同概念的类型/单位/单多选不同，逐成员交 definitionDifferenceReason。既有属性升级类型也是实质变化，须列 proposedBaselineChanges 的旧哈希及原因，另待人审；没有 typing 的旧项只允许逐项原样沿用。提交前跑 check-types，再跑完整 check；程序通过不能替代专业复核。

提交完整组稿、候选池、逐类审查记录、同族矩阵和来源。保留首稿，修订另存文件。程序通过只说明结构，不代表专业核实或人工采用。
