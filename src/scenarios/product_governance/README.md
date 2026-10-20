# 商品治理：架构方案与业务建模

## 当前范围与闭环计划（2026-10-19确认）

本阶段固定为二级“清洁纸品”的21个末级类目，先完善这21类的完整业务闭环。其他大类的属性治理暂不排期。机器可读的范围、步骤及验收条件见 `workflows/clean-paper-21-closure.json`。

已完成21类统一属性卡草案，以及最新5类250件ES在售商品的四模型审核与Codex裁定；运营抽检及线上验收尚未完成。既有结果属于可复核草案，不能据此宣布21类治理完成。

| 顺序 | 工作 | 完成依据 |
|---|---|---|
| 1 | 修订属性卡、相邻边界和共用规则；逐项核对震坤行资料 | 每个字段明确类型、必填、适用条件、层级、单位、枚举、规则、公式及来源；记录参考原表位置和采用/不采用理由 |
| 2 | 四模型独立审核修订卡，Codex逐项裁定 | 分歧均有证据和裁定；真实未知保留；发布新版本并保留历史冻结版本 |
| 3 | 重验受影响的已抽样商品 | 数量、重量、尺寸、形态、归属及条件必填按新版本重新校验；旧批次不直接覆盖，不混用分母 |
| 4 | 补齐21类内部的商品验证覆盖 | 每类明确已验证范围、样本和遗留问题；增加未参与修订的新样本，不能只用已见样本证明效果 |
| 5 | 运营随机抽检、问题修复与复验 | 分别检查类目、已填值、缺项、来源与规则；依据抽检确认准确率及业务可用性，不把填充率或模型一致率当准确率 |
| 6 | 小范围线上端到端验收 | 已审核变更集、目标ID、版本及回滚方案明确，验证同步、展示、搜索和筛选；生产执行前落实业务确认 |
| 7 | 21类闭环复盘 | 已知共用规则错误已修复并重验，遗留缺项有处理安排，运营与线上验收完成后再决定后续范围 |

优先处理：洗脸巾组织结构与取出动作拆分；标称重量与不含芯净纸重区分；节数/长度等条件必填及替代计量路径；折叠方式等枚举候选；数据缺失、口径不清、适用性未知和属性建模问题分别统计。核心必填依业务用途确定，不能为了提高填充率降级。

错挂商品仍给出V2已有目标类目及ID。目标位于这21类之外时记录建议与待办，不自动把目标类目加入本轮属性治理范围。错挂及归属待确认不计入原类填充率。

## 首步历史记录（2026-10-18）

品牌和每包片数共2张属性卡、4条挂载；29条规则案例通过，35项代码测试通过。DeepSeek与Kimi真实提案及审核，15条问题裁定、1项案例分歧。6件历史样例的12字段中8项有规则值、1项品牌候选、3项待补证。这些数字不代表生产准确率。

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

当前提供DeepSeek目录适配器、Kimi CLI适配器和OpenCode Go适配器；模型名、家族、调用上限均在配置中。业务定义及规则保持复用。凭据在调用时从本地环境或加密目录读取，不进入上下文、标准或结果。Kimi使用零工具、零子代理的审核配置。

## OpenCode Go 模型接入（2026-10-19）

项目根目录本地 `.env` 设置 `OPENCODE_API_KEY`，Git已忽略该文件。GLM与Qwen注册于 `adapters/opencode-models.ts`，只使用官方Go订阅路径；错误时保留失败记录，不切换按量付费通道。DeepSeek继续使用 `api.deepseek.com` 官方目录配置，Kimi继续使用已有CLI认证。

| 模型 | ID | 协议与路径 |
|---|---|---|
| GLM 5.3 Flash | `glm-5.3-flash` | Chat Completions：`/inference/go/openai/v1/chat/completions` |
| Qwen 3.8 Flash | `qwen3.8-flash` | Messages：`/inference/go/anthropic/v1/messages` |

```bash
# 每个模型一次合成案例连接验证；重复运行读取相同请求记录。
bun src/scenarios/product_governance/adapters/check-opencode.ts
# 冻结商品批次后按相同输入独立审核；不给其他模型答案。
bun src/scenarios/product_governance/expansion/process.ts glm
bun src/scenarios/product_governance/expansion/process.ts qwen
```

调用保留模型ID、响应模型、原始结果、使用量与请求摘要；订阅额度不等于零成本，报告不估造订阅现金费用。公开模型列表不证明账户剩余额度，以实际调用结果为准。参考：[Go模型与端点](https://opencode.ai/v2/docs/console/go/)、[Inference API](https://opencode.ai/v2/docs/console/api/inference/)。

## 首版代码基线与当时的推进顺序（历史记录）

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

本轮 GLM 批审中，服务端默认推理模式曾触及每请求 `max_tokens=14000` 长度上限（`finish_reason=length`），与订阅剩余额度无关。失败原文保留；后续修复阶段显式设置 `reasoningEffort: low` 并以5件为组，冻结标准和原始商品证据不变。参数依据： https://z.ai/blog/glm-5.3 。


## 2026-10-19：21类属性修订与独立审核

本轮固定清洁纸品21个V2末级。离线候选标准位于 `outputs/product-governance/clean-paper-21-revision-20261019/design/standard.json`：86个现用属性定义、344条绑定，另保留3个退役定义用于历史追溯。它尚未通过运营抽检或线上验收。

- 原始震坤行Excel逐行审计43条，保留文件哈希、工作表、行号和原值；15类为上位参考、4类为相邻参考、2类未找到对应参考，不声称21类有直接专表。
- DeepSeek官方、Kimi CLI、GLM/Qwen OpenCode Go各审21类，首轮71条意见；针对性复核12条，全部由Codex逐项裁定。补丁上下文节选曾导致4条“缺定义/绑定”的误判，完整标准核验予以纠正，不能用模型同意率当准确率。
- GLM两次原请求因原生thinking参数不兼容返回400；修正适配器后原输入补审成功。Qwen最终响应有4个字符串内未转义引号，仅做转义恢复，未改变意见内容；原失败和恢复记录均保留。
- `revision/conditions.ts` 执行有证据的三值条件与组级义务；`semantic-guards.ts` 执行绑定/枚举、数量三元、形态/动作与质量口径预检。它们不会自动造值或给图片自授信，也不代表人工准确率。
- 400个历史样本（8类）已列待重验清单，本轮未重新填写商品。原150/250样本及评估冻结；不能把旧填充率报成新版结果。

下一步按新标准重验受影响字段，再补21类内剩余13类的样本覆盖；错挂或未确认商品继续排除原类计率。随后运营随机抽检、修复复验，再准备小范围线上同步及回滚验收。项目范围不向21类外扩张。

离线导出入口为 `revision/prepare-regression.ts`、`revision/prepare-report.ts` 和 `revision/export-workbook.mjs`；独立审核及裁定输入/输出保存在本轮目录。裁定脚本受已审稿哈希约束，不能拿它自动批准其他版本。
