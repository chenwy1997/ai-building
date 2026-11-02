# 供应链品类参数与 SKU 离线提取对齐

核查日期：2026-10-30。范围是用户指出的供应链 `/manage/category-attribute` 品类参数页面、供应链本机 `uece-base` 仓库，以及 v4 的属性类型合同和 SKU 资料核验。源码取自 `daily` 分支、提交 `e20298b7e331dab7ba07dfb6d7f2857871233ca5`；页面截图与源码均出现单选、多选、单行文本、多行文本及搜索、筛选、必填、自定义等配置，但**未核对线上部署提交**，不能把源码等同线上已验证的能力。本文没有写入供应链，也没有调用商品保存接口。

本轮先按 v4 属性合同及冻结后可用的已认可属性定义离线提取 SKU 值；本地 `number` 继续保留数值和单位，未来若接入该后台可研究投影为单行文本，**不在本轮改类型**。本次源码核查尚未建立任何目标类目或参数 ID 的实际对应关系。可运行的导入与写回不是本文交付。

## 两套模型和身份必须分开

页面源码定义的是 `StdCategory` → `StdCategoryAttribute` → `StdCategoryAttributeOption`，商品库的值为 `StdProductAttribute`。上一份资料核验所讨论的真实目录、`ProductInstance`、`PropertyInstance`、`PropertyValueInstance` 及 `CategoryKeyConfig` 属于商品源体系。它们可经商品库同步逻辑交互，但**不是同一套属性实体**。例如，商品源的 `optionValue` 换行表示方式不能直接套到新的快照值；也不能把该页面的标准类目 ID 默认当作真实目录 `categoryInstance.categoryId`。参见 [新模型](/Users/sanheng/Project/sanheng/uece-base/prisma/schema.prisma:8034)、[商品源资料核验](sku-extraction-readiness-20261030.md) 和 [类目 ID 口径](es-category-scope-and-counting.md)。

| 标识 | 源码中含义 | 离线提取及后续对齐 |
| --- | --- | --- |
| `StdCategory.id` / `StdProduct.stdCategoryId` | 标准类目 ID / 标准商品挂载的标准类目 | 保留目标标准类目全 ID，先核与采样真实末级的对应，不能只按名称匹配或代入旧 ID |
| `StdCategoryAttribute.id` | 每条目录参数定义的 ID | 保存时 `paramValues` 的键；在明确本末级、版本和语义后才能绑定，不用名字或可空 `key` 当稳定主键 |
| `sourceAttributeId` | 父级下发来源属性 ID，普通字符串 | 不能用父参数 ID 代替该 SKU 末级副本 ID；子级修改后可能清空，须读取当下的末级定义 |
| `StdCategoryAttributeOption.id` / `value` | 选项记录 ID / 选项文本 | SKU 输入值是 `value` 文本，选项 ID 记录于模板和选项快照；两者不得混同 |
| `StdProduct.id` / `sku` / `spu` | 标准商品记录 ID / 业务 SKU 编码 / 业务 SPU 编码 | 一条标准商品为一个 SKU；`spu` 分组，参数值按每个 SKU；记录 ID 与 SKU 编码也不同 |
| `StdProduct.rawProductId` / `rawProductInstanceId` | 指向原始商品及实例的兼容字段 | 用于建立证据链，但可为空；先逐 SKU 核唯一性、版本、规格和当前类目，不能假设旧 ID 自动等于标准商品 ID |
| `VendorSku.id` / `VendorProductAttribute` | 供应商 SKU 和独立的参数快照 | 与标准商品 SKU 快照不是同一记录；本轮未确认目标商品属于该路径 |

商品库详情中 `skus[].id`、`sku`、`rawProductId` 分别从标准商品记录回显，`paramValues` 从各 SKU 的参数快照还原；SPU 汇总对象不代表所有 SKU 共值。[商品详情转换](/Users/sanheng/Project/sanheng/uece-base/app/manage/product/product-hub/detail/service.ts:304)、[供应商快照模型](/Users/sanheng/Project/sanheng/uece-base/prisma/schema.prisma:7731)。

## 定义、继承和配置

| 页面字段 | 源码字段与边界 |
| --- | --- |
| 参数名称 | `name`；同标准类目下名称唯一，写入接口限制 1—100 字。名称本身不是跨目录的共享定义 ID。`key` 允许空；此页面新建将 `key` 设为 null，不作为该流程的主匹配键。 |
| 类型 | `SINGLE_SELECT`、`MULTI_SELECT`、`SINGLE_LINE`、`MULTI_LINE`，没有数值和布尔类型。 |
| 是否搜索、筛选、必填、自定义、启用 | 分别为 `isSearchable`、`isFilterable`、`isRequired`、`isAllowCustomValue`、`isEnabled`；自定义值只对选项类型有效。开关存在不证明线上搜索索引或筛选已经生效。 |
| 枚举值 | 选项是单独的 `StdCategoryAttributeOption` 记录，含 `id`、`value`、`sortIndex`、`isEnabled`；配置提交用字符串列表，去空、去重；删除选项通常是停用，历史选项可留存。 |
| 默认值、描述 | `defaultValue`、`description`，另有 `placeholder`、`sortIndex`。多选默认值存 JSON 数组字符串。商品库 UI 对空的单选/多选参数预填默认值；**默认值是配置，不是具体 SKU 的事实证据**。 |

证据：[参数模型](/Users/sanheng/Project/sanheng/uece-base/prisma/schema.prisma:8062)、[表单及输入合同](/Users/sanheng/Project/sanheng/uece-base/app/manage/category-attribute/entity.ts:13)、[选项变更](/Users/sanheng/Project/sanheng/uece-base/app/manage/category-attribute/service.attribute.ts:83)、[默认值预填](</Users/sanheng/Project/sanheng/uece-base/app/manage/product/product-hub/detail/(components)/ProductForm/SkuInfo.tsx:32>)。

源码把 4 级作为末级：在非末级创建参数时，向当前全部末级后代创建**独立参数和选项副本**，各副本以 `sourceAttributeId` 指回父参数；父定义编辑同步仍连接的副本，子定义编辑、启停或排序等可使副本脱离。末级模板 `attributeVersion` 随相关变更递增。因此继承不是查询时共用一条父定义，父级操作会波及整个当前子树；局部适用的离线建议不应扩大为父级下发。[下发](/Users/sanheng/Project/sanheng/uece-base/app/manage/category-attribute/service.attribute.ts:144)、[父改同步](/Users/sanheng/Project/sanheng/uece-base/app/manage/category-attribute/service.attribute.ts:221)、[子改脱离](/Users/sanheng/Project/sanheng/uece-base/app/manage/category-attribute/service.attribute.ts:440)。

## v4 类型到目标载体的候选映射

这里是未来对接时需要讨论的载体映射，不改变本轮属性定义，也不声称供应链当前已配置这些参数或值。必须同时核量纲、计量对象、允许值、类别绑定与版本。

| v4 类型 | 候选目标类型/值 | 待确认 |
| --- | --- | --- |
| `text` | 单行或多行文本，字符串 | 单/多行按内容选；目标参数是否存在且语义一致 |
| `number` | 本地仍为数值 + 单位；未来可投影到 `SINGLE_LINE` | 目标希望展示为纯数字还是带单位、规范精度、换算及格式；无结论前不生成可写 payload |
| `boolean` | 目标无原生布尔；待确认后可考虑单选“是/否”或文本 | 精确标签、语义及真实模板选项；未知不能转成“否” |
| `option`，single | `SINGLE_SELECT`，单个**选项文本** | 与实际启用选项及类目适用子集逐项匹配；值域外保留原文待审 |
| `option`，multiple | `MULTI_SELECT`，**选项文本数组** | 按实际启用选项和互斥/数量规则核对；不能把字符串拼接或 ID 列表冒充值 |

所有实际 SKU 输出保留 `definitionId/version`、对象、类型、单位、原始证据和取值状态；目标类别 ID、参数 ID、选项 ID/文本、目标模板版本以实际授权读取结果单独对照，未确认时为空并标 `unresolved`。这不是新增线上字段要求。

## 商品值的实际形状与保存风险

当前源码定义 `ParamValues = Record<string, string | string[]>`，键是**末级参数 ID**；单选、单行、多行用字符串，多选用字符串数组。商品库 UI 的选项 `label` 和 `value` 均来自 `option.value`。`StdProductAttribute.value` 实际落库为单选/文本字符串或多选 JSON 数组字符串；`optionValues` 则另存 `[{id,value,sortIndex}]` 供历史回显。以下仅是形状示意，示例参数 ID 和内容均不是本轮实际目标：

```json
{
  "skus": [{
    "paramValues": {
      "示例-单选参数ID": "示例选项文本",
      "示例-多选参数ID": ["示例选项甲", "示例选项乙"],
      "示例-文本参数ID": "示例文字"
    }
  }]
}
```

写入路径是商品库详情整体 `save`，不是本文建议执行的 API。源码在保存商品时按提交列表检查同一 SPU，**删除不在列表中的标准商品及其属性快照**；因此不完整的 SPU SKU 列表可能直接删除同组商品。参数侧再检查必填、值类型和启用选项，对涉及 SKU **先删除旧参数快照并按当前启用定义重建**；`paramValues` 缺项会生成空值，停用或不存在的参数静默丢弃，无类目/无参数会清除旧快照。表单 SKU 与保存结果按顺序对应，相关操作位于事务内。非空自定义枚举在允许时会加入或恢复公共选项池，并可能使子定义脱离父级、递增模板版本。这些副作用使稀疏离线结果不能直接当保存请求。[商品整体保存](/Users/sanheng/Project/sanheng/uece-base/app/manage/product/product-hub/detail/service.ts:843)、[参数保存](/Users/sanheng/Project/sanheng/uece-base/app/manage/product/product-hub/detail/service.attribute.ts:118)、[详情路由](/Users/sanheng/Project/sanheng/uece-base/app/manage/product/product-hub/detail/routes.ts:316)。

详情页“批量设置”仅对该 SPU 表单内勾选 SKU 行注入非空参数，随后仍需整体保存；不等于跨 SKU 的独立参数补丁接口。已检索的列表 `batchUpdateStdProduct` 使用 `StdProductModel.partial()` 处理商品字段，未发现其写入 `StdProductAttribute`；品类参数管理的 `importAttributes` 则是导入**定义**，不是给商品填值。不能将这些功能称为已核实的 SKU 值批量接口。[表单批量设置](</Users/sanheng/Project/sanheng/uece-base/app/manage/product/product-hub/detail/(components)/ProductForm/BatchSetBar.tsx:125>)、[列表批量接口](</Users/sanheng/Project/sanheng/uece-base/app/manage/product/product-hub/(list)/routes.ts:127>)、[定义导入](/Users/sanheng/Project/sanheng/uece-base/app/manage/category-attribute/routes.ts:149)。

同步也不是简单双向关系：源码正向同步把非空且未映射到商品源基础字段的快照拼成商品源 `parameter` 的“名称:值”行；反向同步按名称识别，来源含合法值时覆盖原快照，未携带或不合法时保留原值，多选仅取启用选项的合法子集。这是代码逻辑，实际触发条件和线上部署状态须另核；不要用反向同步当作可靠的 SKU 提取接口或默认可逆转换。[正向](/Users/sanheng/Project/sanheng/uece-base/tools/server/productTools/sync/forward/mapper.ts:630)、[反向](/Users/sanheng/Project/sanheng/uece-base/tools/server/productTools/sync/reverse/attribute.ts:31)。

## 授权只读入口与待证事项

本节只列源码中可供后续按正常权限评估的入口，**本次没有请求这些入口**；请求和返回仍应采用业务字段白名单，避免把整个商品或敏感配置落盘。

| 入口 | 代码用途与权限 | 本次边界 |
| --- | --- | --- |
| `POST /manage/category-attribute/api/getCategoryTree`，空对象；`getAttributes`，`{categoryId}` | 查询标准类目树及某目录的全部参数、全部选项（含停用）；走管理端认证 | 未验证线上响应及六类映射 |
| `POST /manage/product/product-hub/detail/api/getCategoryAttributes`，`{stdCategoryId}` | 查询该标准类目当前启用参数和选项，以及 `attributeVersion`；走管理端认证 | 未确认目标标准类目或属性定义 |
| `POST /manage/product/product-hub/detail/api/getDetail`，`{spu}` | 以标准商品业务 SPU 查询其 SKU 参数快照；认证并要求 `product:view` | 标准 SPU 不可直接用旧系统 `spuProductId` 代替；响应含较广业务字段，须投影白名单 |
| `POST /manage/product/product-hub/detail/api/getProductDetail`，`{productId}` | 旧商品源 SPU 详情；认证并要求 `product:view` | 与上面的新快照读取不是同一接口；本次未调用 |
| `POST /manage/product/api/getProduct_propertyArray`，`{productId}` | 单个旧商品属性数组；认证并要求 `product:view` | [已有核验](sku-extraction-readiness-20261030.md)中此入口独立调用返回 401；须使用正常有效授权，不导出浏览器凭据或绕过鉴权 |

证据：[参数管理路由](/Users/sanheng/Project/sanheng/uece-base/app/manage/category-attribute/routes.ts:15)、[商品详情路由](/Users/sanheng/Project/sanheng/uece-base/app/manage/product/product-hub/detail/routes.ts:377)、[管理端认证](/Users/sanheng/Project/sanheng/uece-base/app/manage/product/product-hub/detail/api/[action]/route.ts:1)、[标准商品详情](/Users/sanheng/Project/sanheng/uece-base/app/manage/product/product-hub/detail/service.ts:1042)。

本轮尚待证：线上实际部署版本；六个真实末级与标准类目及目标属性 ID 的映射；400 件各自与标准 SKU / SPU / 实例版本的对应及商品源权限；当前参数定义/启用选项/版本及既有值；数值、布尔等投影约定；读后并发保护、冲突处理、同步方向与回滚。未来若进入写回，应另行完成目标合同、权限、完整值保留、版本冲突和端到端回读验收；本轮仅准备离线数据和人工复核。
