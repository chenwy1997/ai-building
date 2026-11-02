# ES 类目范围与 SPU 统计口径

适用于三横商品源采样和数量统计。2026-10-30 的清洁用品统计曾因混用类目体系得出错误范围；后续查询先按本文核身份和字段，再统计。以下 ID 和数量是该次核验案例，不作为其他类目的默认值。

## 1. 这次错在哪里

用户要求统计当前真实“清洁用品”目录下的 SPU。第一次却用标准映射树的 ID 查询 `standardCategory.idPath`，得到 699,878 个 SPU / 700,182 条 SKU 文档。这个查询有真实返回，但回答了另一套类目归属的问题，不能用于用户要求的范围。旧结论撤回。

经本地已核验树与 ES 的 `categoryInstance.name`、`categoryInstance.categoryId` 交叉核对：

| 对象 | ID | 子树查询字段 | 含义 |
| --- | --- | --- | --- |
| 当前真实清洁用品目录 | `8d67b123-c890-45e4-aafc-b138e296c722` | `categoryIds` | 商品实际目录层级，包含该目录及其下级挂载 |
| 清洁用品标准映射节点 | `164ccb7e-113e-40ce-be67-3e4dae86bb88` | `standardCategory.idPath` | 标准类目映射归属；不是上面真实目录的可互换 ID |

同名、路径相似、ID 是 UUID、查询有结果，都不能证明类目体系选对。不能把差异只解释为“货源库较大”或“SKU 当成 SPU”；这次首要错误是类目 ID 与 ES 字段的口径错配。

正确范围在 2026-10-30 11:52（北京时间）的 ES 快照中为 **15,324 个 SPU / 15,596 条 SKU 文档**，按 `spuProductId` 精确去重。此数包含查询范围内全部文档，未附加商品库/货源库、上下架、启用、删除状态筛选；不是“当前可售商品数”。数据会变化，下次应重新查询。

核验材料：

- [类目树与 ID 映射](../../../../outputs/category-id-refresh-20261021/mapped-tree.updated.json)：本次节点的 `id` / `mallCategoryId` 是真实目录 ID，`standardCategoryId` / `legacyV2Id` 是标准映射 ID。
- [ES 身份回读](../../../../outputs/product-governance-v4/cleaning-supplies-es-count-20261030/actual-category/identity-verification.json)：真实目录 ID 对应 `categoryInstance.name=清洁用品`。
- [正确范围的计数回执](../../../../outputs/product-governance-v4/cleaning-supplies-es-count-20261030/actual-category/spu-count.json)：查询、精确聚合方法、分页校验及时间。采用其中 `exactSpuCounts.all_indexed` 与 `skuDocumentCounts.all_indexed`。

## 2. ID、字段与统计对象必须分别说明

| 需要查询的对象 | 字段 / 做法 | 不可替代为 |
| --- | --- | --- |
| 真实目录整个子树 | `term categoryIds=<真实目录 ID>` | `standardCategory.idPath` |
| 真实目录直接挂载 | `term categoryInstance.categoryId=<真实目录 ID>` | 子树总量；只查父节点直挂会漏下级 |
| 标准映射树整个子树 | `term standardCategory.idPath=<标准映射 ID>` | 当前真实目录子树 |
| 标准映射节点直接归属 | `term standardCategory.id=<标准映射 ID>` | 真实目录直接挂载 |
| 目录实例版本 | 核 `CategoryInstance.id` 与其 `categoryId`、版本 | 稳定目录 ID；实例 ID 不能直接塞入上述类目过滤 |
| SPU 数 | 对命中范围的 `spuProductId` 去重 | ES 文档数、`productId` 数或商品名称数 |
| SKU 文档数 | `hits.total` 且 `relation=eq` | SPU 数；历史版本是否重复须按索引合同另核 |

查询字段应由业务范围与 ID 体系共同确定，不是全局禁用 `standardCategory.*`。只有任务明确要求标准类目映射范围，且已核实标准 ID 时，才使用这些字段。

当前真实清洁用品子树的查询条件：

```json
{
  "query": {
    "term": {
      "categoryIds": "8d67b123-c890-45e4-aafc-b138e296c722"
    }
  }
}
```

## 3. 查询前后必须完成的核对

1. **先定口径。** 记录类目全路径、真实 ID、映射 ID（若需要）、树版本；确认是整棵子树还是直接挂载，是全部商品还是指定库/状态。用户说当前类目时，采用真实目录范围，不自行换成标准映射范围。
2. **核身份。** 对照当前树/已核验映射，并回读白名单类目信息。名称仅用于定位，不能用关键词搜索结果冒充类目挂载量。没有直挂商品时回读类目资料或有证据的下级路径，不能以零命中证明 ID 错误或自动换字段。
3. **核过滤。** 在发请求前把 ID、ID 体系、ES 字段、索引及额外筛选写入回执。采样工具参数叫 `category-id` 不证明它接受真实目录 ID，须检查预检请求或实现。
4. **精确统计。** SPU 用 `spuProductId` 去重。要求准确总数时使用同一 PIT 内分页 composite 聚合，遍历所有桶，检查无超时/失败分片，核缺失/空 SPU ID及文档总量；不能把 cardinality 估算或截断的 terms 桶数当精确总数。
5. **核状态字段。** 核实索引中的字段覆盖与语义后再加 `isHead`、删除、启用和销售状态条件。字段缺失是未知，不是 false。此次真实范围的 `product.deleted` 全部缺失，旧回执中相关 `valid` 筛选的 0 不能解释成“有效商品为 0”。
6. **核统计边界。** 不同库/分组的 SPU 可能重叠，不能直接相加。挂在父目录的商品是否计入、无商品的末级类目如何呈现要明示。实际挂载也不证明商品分类正确。
7. **交付可复核依据。** 一起给出类目 ID、实际查询字段、子树/直挂口径、SPU 去重字段、SKU 文档数、筛选、时间和回执。数量异常先复核身份、字段与分组，不用“供应商多”推测解释。

## 4. 现有工具的明确限制

2026-11-02 新增 `scripts/count-sku-scope.py`：必须传真实根目录、已核验树、属性合同、上一轮抽样清单和结果；默认只预检，加 `--execute` 才只读 ES。在单一 PIT 内分页获取白名单标识，分别以 `productId`、`spuProductId` 精确去重。输出总范围、旧样本、原抽样类目剩余、新类目剩余、无对应属性合同挂载以及逐类数量。类别身份和商品状态边界沿用本文，不能把未筛状态的数量称为可售数。

该工具保存 ID 快照用于后续冻结范围，不含商品标题、参数、图片内容或全部上游对象。快照不等于已取得提取资料，后续按选定 SKU 读取资料并对账；父级和无合同目录单列，不按同名自动套用合同。历史已处理商品按 SKU ID 排除，不能仅因某类有过抽样就认定该类全部完成。

截至本次核验，`scripts/read-own-source.py --category-id` 实现仍查询 **`standardCategory.id`**，`--category-name` 查询 `standardCategory.name`。它是有上限的标准映射节点采样工具，**不是按真实目录 ID 查询的子树工具，也不是 SPU 总量统计工具**。其 `exact_id_query` 标记只说明做了 ID 精确匹配，不能证明 ID 体系正确。

因此，该工具现阶段只能传入已核验的标准映射 ID，并将结果标为标准映射样本；不能传入真实目录 ID 后，把零结果认定为无商品。真实目录采样/统计应按第 2 节构造只读查询。后续若改造工具，须显式区分 ID 体系和子树/直挂范围，并验收请求体与回执；不得静默尝试另一个字段兜底。

本次只补充口径规范和入口说明，未修改采样工具或线上数据。凭据只从环境配置读取，不写入文档、请求回执或日志；商品资料继续使用白名单，不读取整个 `upstream` 对象。
