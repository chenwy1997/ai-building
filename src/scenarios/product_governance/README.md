# 商品治理：架构方案与业务建模

**状态：首步试点已跑通（2026-10-18）。** 品牌和每包片数共2张属性卡、4条挂载；29条规则案例通过，35项代码测试通过。DeepSeek与Kimi真实提案及审核，15条问题裁定、1项案例分歧。6件历史样例的12字段中8项有规则值、1项品牌候选、3项待补证。这些数字不代表生产准确率。

[打开首步结果报告](../../../outputs/product-governance/step1-20261018/品牌与每包片数_首步治理结果.html)。本目录独立于既有治理实验，保存业务定义、受限规则、多模型流程与交付入口；运行记录保留失败调用，运营抽检尚未执行。

## 首步运行

从项目根目录执行。新试点传入新的运行目录。`prepare`和`rules`可用随代码保存的6条历史样例离线运行；`propose`和`review`需要项目模型目录、解密配置及Kimi CLI已有认证：

```bash
bun src/scenarios/product_governance/cli.ts prepare outputs/product-governance/new-pilot
bun src/scenarios/product_governance/cli.ts propose outputs/product-governance/new-pilot
bun src/scenarios/product_governance/cli.ts rules outputs/product-governance/new-pilot
bun src/scenarios/product_governance/cli.ts review outputs/product-governance/new-pilot
```

默认输出：`outputs/product-governance/step1-20261018`，该目录是本次已完成的历史运行。所有命令可追加运行目录及修订号，例如 `rules outputs/product-governance/step1-20261018 r2`。新任务按 `standards/current-pilot.json` 选择草案并冻结副本；局部运行修订号r1/r2与业务标准版本分别记录。修订时将新标准保存为 `standard-r2.json`，重新执行规则与审核。`repair-proposal`仅对失败提案做一次显式格式修复，保留原调用记录，计入原预算。

Codex查看各模型原始意见后填写 `codex-adjudication.json`，逐条说明采纳、拒绝、延后及案例分歧。文件须绑定当前标准与结果摘要。随后执行：

```bash
bun src/scenarios/product_governance/cli.ts report outputs/product-governance/step1-20261018 r2
bun test src/scenarios/product_governance/tests/pilot.test.ts
bunx tsc --project src/scenarios/product_governance/tsconfig.json
```

没有完整双模型评审、存在未裁定问题或版本不一致时，报告导出会失败。流程不会把两模型一致当作业务准确率。

## 可复用业务入口

```ts
import {ontology} from './domain/ontology.ts';
const governance = ontology(standard);
governance.attributes.definition('common.brand');
governance.attributes.bindings('common.brand');
governance.attributes.rules('wet_wipes.pieces_per_pack');
governance.attributes.reviewCriteria();
governance.attributes.evaluate('wet_wipes.pieces_per_pack', observedProduct);
governance.context(['common.brand', 'wet_wipes.pieces_per_pack']);
```

这些方法来自同一份标准。返回的定义可供模型理解，计算只调用注册算子，不执行模型生成代码。证据定位通过不等于语义正确，语义意见仍交给模型审核和Codex裁定。

## 文件职责

| 位置 | 职责 |
|---|---|
| `standards/pilot-v2.json` | 当前试点的属性定义、类目挂载、规则、来源、参考品牌字典、10项审核准则；v1保留历史 |
| `domain/ontology.ts` | 统一只读查询和规则执行接口 |
| `domain/engine.ts` | 品牌精确归一、受限单包数量计算 |
| `domain/review.ts` | 审核输出完整性检查和分歧检测 |
| `workflows/pilot-config.json` | 模型角色、渠道、次数、时限与预算 |
| `workflows/stages.json` | 当前阶段、产物和下一阶段 |
| `adapters/` | 模型调用与禁用工具的Kimi审核身份 |
| `fixtures/` | 合成案例与6条历史ES样例最小快照，保留原来源定位；离线复跑不依赖大缓存 |
| `runtime/` | 摘要、事件、版本记录和报告输出 |
| `tests/` | 规则边界及审核契约测试 |

当前提供DeepSeek目录适配器和Kimi CLI适配器；模型名、家族、调用上限均在配置中。增加其他渠道时注册适配器，业务定义及规则保持复用。API凭据只在调用时解密，不进入上下文、标准或结果。Kimi使用零工具、零子代理的审核配置。

## 首版代码基线与下一步（2026-10-19）

首版提交保存本业务目录和 `outputs/product-governance/step1-20261018` 的首轮记录。通过 `prepare`、`rules` 可以离线验证规则；通过 `report ... r2` 可以利用已存审核记录重新导出报告。模型阶段会产生实际调用，只有需要重新提案/审核时才运行。历史专用的修订、裁定脚本不是通用自动审批入口，裁定脚本仅接受已审阅快照。

后续建议按以下顺序推进，当前提交不自动启动这些步骤：

1. **三类属性卡完善**：复用已有稿，为软包抽纸、湿纸巾、纸巾盒补齐第一版属性卡；公共定义与特性定义分别维护，逐条说明来源、适用性、必填、层级、单位和规则。品牌先对齐正式字典，其他尚未核实的映射保留待定。
2. **真实取证与填写**：统一当前在售ES商品源口径，建议每类随机取50件，共150件；固定查询条件、时间、类目ID及抽样清单。已知混合包、错挂、品牌冲突等另做风险样例，单列统计。一个模型从标题、规格、详情提取带定位的观察，另一个独立复核；核心缺项再用同SKU图片或可靠同品资料补证，Codex裁定分歧。
3. **分类、分母与质量报告**：正确归属、建议迁移、缺类目、信息不足分开记录。待确认和错挂商品不进入原类目属性填充率分母；若转入已确认目标类目，则按目标模板另外统计。分别报告总体与必填填充率、缺失原因、候选/冲突数量和审核分歧；人工抽检后才报告实测准确率。
4. **运营抽检与小范围线上闭环**：运营随机抽检，错误回到具体定义、取证或规则修正并重验。三类通过后，以明确变更集、版本和回滚方案做少量线上同步及真实业务验收，再决定扩到21类的门槛与节奏。

## 首步边界

- V2类目ID来自既有映射；只挂载这两个属性，未完成3类的全属性治理。
- 品牌选项使用明确标识的参考ID，未核实为生产ID。
- 6条商品为历史缓存中选定样例，非随机样本；状态未经本轮刷新。
- 此步采用受限证据抽取演示，不等于已完成大规模模型填写；图片、上游补证、自动分类与线上同步留到后续步骤。
- 合成规则案例通过率用于回归检查，不代表生产准确率；人工随机抽检仍未执行。
- 每个请求保存输入摘要、原始返回和结果；输出不合约会失败。请求已有记录但结果未知时，禁止自动重发，先核对状态。当前按本地运行锁串行编排阶段，不是分布式调度器。

## 阅读入口

- [架构方案v0.1](./docs/商品治理架构讨论稿.md)：已确认原则、属性模型、工作流、多模型分工、上下文、试点步骤及后续配置事项。
- [业务术语](./GLOSSARY.md)：本业务统一使用的概念。
- [标准版本决策](./docs/adr/0001-versioned-standards.md)：为什么统一标准不直接覆盖在途任务。

## 已确认方向

1. 固定V2类目基线；二级“清洁纸品”21个末级为总范围，先以软包抽纸、湿纸巾、纸巾盒3个代表类目跑通。
2. 属性同时包含公共属性和类目特性属性；属性定义、类目适用性、填写规则和审核依据都需要明确建模。
3. 属性定义采用两个模型独立提案、交叉评审；商品填写采用一个模型产出、另一个模型独立复核。
4. Codex负责统筹和最终裁定，保留证据、分歧和裁定理由；模型执行与评审角色可替换。
5. 新任务使用最新已发布标准；在途任务固定版本，受变更影响的结果可追溯重验。
6. 核心属性必填；其他有价值的属性可选保留。数据难取不是删除核心属性的理由。
7. 已核实字段可先交付；仍缺必填值的商品标记治理未完整，不计入完整达标率。
8. 架构设计已收口，当前以脚本和可查看结果推进首步试点。
9. 首期业务用途为正确归类、参数展示、搜索和筛选；核心必填的选择围绕这些用途给出理由。
10. 优先完成多模型审核及Codex裁定，再由陈文宇和运营随机抽样审核；人工抽检结果可沉淀为后续回归样本。
11. 首轮优先为核心属性的缺失或冲突补充同品上游、厂商等证据；可选属性先利用已有资料填写并保留缺项。
12. 先以3类取得真实效果和业务抽检结果，再确定扩到21类的质量阈值；共用规则错误先修复并重验。

## 架构主线

统一标准与版本 → 公共属性和类目特性属性建模 → 多模型评审与Codex裁定 → 商品归属确认 → 按规则取证填写与独立复核 → 业务抽检 → 已核实字段交付与线上验证 → 受影响结果重验。

## 已确认的实施切入点

以“品牌”公共属性与“每包片数”类目特性属性做完整属性卡，明确来源、类目挂载、字段类型、层级、取值口径、规则和评判依据。以同一份业务定义生成AI读取结构与可审明细，先验证这条最小链。

3个代表类目为软包抽纸、湿纸巾、纸巾盒。具体模型、样本量、重试次数与费用上限在首次实际运行前写入运行配置；质量扩围阈值在首轮效果测量后确定。它们作为可更换参数管理。

## 历史输入

- V2类目映射：`scratch-category-baseline-20261010/mapped-tree.json`。
- 清洁纸品21类、152条属性定义草稿：`outputs/clean-paper-remaining-20261016/attribute-model-all21.json`。
- 同批完整Excel：`outputs/clean-paper-remaining-20261016/清洁纸品21类完整属性模板_已有14类与新增7类合并_运营审核稿_20261016.xlsx`。

上述路径均相对于项目根目录。既有14类与新增7类合并，不等于全部已获运营确认。详细来源与局限见架构方案。
