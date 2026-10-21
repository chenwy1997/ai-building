# 商品治理 V2：DeepSeek 批量属性建模

- [Codex独立审核大纲](reviewers/codex/审核大纲.md)：与DeepSeek执行上下文分开；先程序检查和差异摘要，再审异常、公共定义及抽查，集中返修并明确停止条件。`reviewers/codex/prepare-review.mjs`只生成离线审核包，不调用模型、不自动判通过。

当前状态：**2026-10-21按业务反馈由官方DeepSeek修订清洁纸品21类，保留352条类目属性绑定，9条销售单位转SKU基础信息；保留103件小样本、1734条类目属性试填明细。交付23个Sheet的精简运营视图，完整建模和证据留在本地。**

- [属性边界与运营交付](standards/11-attribute-boundaries-and-delivery.md)：公共定义登记、全SKU、销售单位归基础信息、同义维度、行业常用名称和统一排版。
- 本轮输出：`outputs/product-governance-v2/clean-paper-review-layout-20261021/`。`ds-approved-cards.json`为DS产出及Codex异常裁定稿，`sku-base-fields.json`保留移出字段和45条原试填记录，`attribute-library.json`保留公共与类目定义。未改线上。
- 模型执行 `business-feedback-run --cards-from <final-cards.json> --output <新目录> --concurrency 32`：固定规范和公共定义前置，类目返回紧凑补丁、复核基于原卡加有效变更，成功项断点复用。自动结果为候选，异常和抽查通过后再由`apply-business-feedback.ts`投影交付字段。
- Excel使用`reports/export-business-review.mjs`与`review-layout.mjs`统一导出：15列属性卡、公共/特性紧跟属性名、分组浅色两级表头、15pt普通行；左侧冻结序号、完整类目路径、末级类目、属性ID、属性名，标准类目ID归入右侧“类目补充”。使用桌面捆绑artifact-tool；仅改排版不调用模型。
- 新批量的单位角色检查由冻结的`unitRoleProtocol=unit-role-v1`开启：DeepSeek逐项返回交易/内容计数/固定计量的角色、配套数量ID及理由，程序检查覆盖和引用。关键词只提名候选，不决定删除；必要的内容计数单位保留。旧冻结批次不因新协议而重复调用。

- [第一版架构基线与实施顺序](docs/architecture-draft.md)
- [业务术语](GLOSSARY.md)
- [新批量入口与并发缓存实测](docs/batch-runbook.md)：`batch-plan / batch-run / batch-status`，公共定义先行、none思考、默认并发32、冻结版本恢复、可配置累计预算。已完成单类真实链路验证，自动产物仍需Codex裁定。
- [属性命名与语义一致性](standards/08-attribute-naming.md)：纳入固定标准上下文；DeepSeek提出名称，程序检查，Codex裁定异常。同名不强制共享，非公共属性按类目ID与属性ID联合定位。
- [属性产生顺序与任务交接](standards/09-generation-order.md)：公共定义优先、逐维度产生候选、关联规则与证据、定点修复。
- [完整性与规则一致性](standards/10-completeness-consistency.md)：六组覆盖说明、材质与计数遗漏、包装层级、枚举反例、换算和缺项条件检查；纳入新批次固定上下文。
- [效率实测与自动化能力审计](docs/runtime-efficiency-audit-20261020.md)：实际思考档、缓存命中、并发、当前入口限制和改进顺序；设计接口不冒充已实现命令。

命名复核记录位于当前run的 `revisions/closure-r3/naming-r1`：原339条绑定逐项复核、40处已有属性名修订，并对厨房纸巾、盒装抽纸、生活用纸的独立计量概念作结构调整。15件受影响商品的字段按原始证据迁移，其余商品不重新调用模型。该范围的属性库快照包含2份公共定义和304份类目限定定义，合计346条绑定；它不是全站生产属性库。原响应、旧卡、旧名称及迁移记录保留。

首期针对 `清洁用品 > 清洁纸品`，二级类目 ID：`8ee638a9-2cd7-4bf4-ac31-536b6a3a1f5d`，现有 V2 树下 21 个末级。

复用旧业务的建模结构与已识别问题，重新产生属性候选。旧 21 类属性答案只用于产出冻结后的对比，不作为生成或审核提示的输入。

首轮先验证软包抽纸、湿纸巾、纸巾盒，每类 10 件原始商品资料辅助建模。每类由 DeepSeek 完整复核一次，修改处定点重验，Codex 处理异常和抽查；之后铺满 21 类。初始累计预算为50元；按用户最新要求，预算可配置提高、保留完整账本，恢复任务不重置成本。当前运行以新批量手册为准，下文历史阶段数据保留。

旧业务代码保存于分支 `codex/product-governance-v1-checkpoint-20261020`，提交 `75dcefd4b`。此快照覆盖 `product_governance` 当前实现、相关测试与环境变量示例；历史输出仍在本地，其他业务目录的未提交修改保留原状。

## 本轮实际结果（2026-10-20）

| 末级 | 属性绑定 | ES随机在售参考样本 | 符合类目 |
|---|---:|---:|---:|
| 软包抽纸 | 18 | 10 | 9 |
| 湿纸巾 | 23 | 10 | 8 |
| 纸巾盒 | 14 | 10 | 2 |

本地参考复核后共55条绑定、51份定义（2份公共定义供三类共用，49份按类目限定）。
30件中10件错挂、1件待确认，仅作为辅助建模样本筛除，不用于推算全量错挂率。
累计费用按实际返回Token及高峰单价估算上界为2.80397640元，包含检索/抓取和不完整响应；此次本地参考复核新增0.48277504元，未取得供应商账单。
累计输入缓存命中53760/631773（8.5%），尚不能宣称已充分利用缓存。

输出目录：`outputs/product-governance-v2/clean-paper-20261020`。
最终文件：`清洁纸品V2属性建模_明细审核与成本.xlsx`。
旧三横属性答案未输入模型。首轮遗漏本地震坤行参考，r2已实际读取并完成复核；网页、本地模板、原始标题规格、模型提议和Codex裁定分别记录来源。

### 本地震坤行参考复核 r2

用户提供的来源是 `/Users/sanheng/Downloads/震坤行类目属性案例模板.xlsx`，应直接读取本地文件。登记见 `references/catalog.json`。
现已保存原件hash、快照和逐行索引，查到 `1295分类模板!4184:4195` 的 `M45112 清洁纸品`，共12个字段。
这属于外部参考模板，不属于禁止输入的三横旧21类答案。后续建模应按类目适用性引用本地行，网页只用于额外疑点补证。
首轮调用确实没有读取此文件，旧卡、旧标准与旧Excel保存在run的`revisions/zkh-r2`。此次三类各复核12行，合计36项判断：采纳3项、调整采纳17项、不采纳为类目属性16项。DS初步意见与Codex最终判断分别保留。
软包抽纸和湿纸巾各新增“是否异规格组合”“异规格组合明细”；已有层数、香型、包装等字段吸收来源依据，但不照搬上位模板的必填、单多选或枚举。新增字段尚待真实商品验证。
该模板层数有重复枚举、套装示例含洗护品，须经适用性判断。纸巾盒配件不能直接继承纸品的层数和香型。

## 可运行入口

```bash
bun src/scenarios/product_governance_v2/cli.ts run \
  --category-id 8ee638a9-2cd7-4bf4-ac31-536b6a3a1f5d \
  --phase pilot --concurrency auto --max-concurrency 32 \
  --run outputs/product-governance-v2/clean-paper-20261020
bun test ./src/scenarios/product_governance_v2/tests
bunx tsc --project src/scenarios/product_governance_v2/tsconfig.json --noEmit
```

凭据从环境读取。`prepare`、`collect`、`run`、`status`均要求类目ID。
已裁定结果优先复用，不能被旧模型阶段覆盖。原始API响应、输入hash、标准hash、修复过程和费用账本在同一run目录；切勿新建目录规避累计预算。
正式扩围需同一run的 `codex-pilot-gate.json` 明确批准，并固定标准和三张已裁定卡的hash。

`workflows/codex-repair.ts <run> <plan.json>`执行显式裁定的定点模型修正；
`workflows/finalize.ts <run> <manifest.json>`离线应用已审阅的最终修订，检验来源引用、共享定义和输入版本。
`reports/prepare.ts <run>`准备报告数据；`reports/export.mjs`须通过桌面捆绑的artifact-tool运行。

### 提示词、程序检查与审核的分工

提示词和可复用标准负责解释任务、业务边界和反例，不能保证事实正确。原表必填/类型/枚举由本地解析器提取；模型只提出适配判断，报告原始字段直接读取解析结果。
`domain/reference-checks.ts`检查全部来源行覆盖、不重复、目标字段存在、逐字原文引用；它不证明采纳理由正确。
`domain/shared-rules.ts`检查核心必填、SKU层级、unknown/其他、未声明的其他枚举、配件属性边界，并提供受限乘除执行器。`requiredByCategory`是最低保护集合，不是全部必填字段的白名单。
同一模型审核也会误读：此次曾因缺证建议降级必填、引用当前输入不存在的未决项；Codex驳回并记录理由。程序回归另查出湿巾酒精属性允许不存在的“其他”取值，两轮DS未指出。
语义合理性继续由DS审查、Codex处理分歧及运营抽检；23项自动测试验证代码约束，不代表商品准确率。旧响应和失败记录保留，不用覆盖历史的方式制造“全程通过”。

## 当前实现边界和下一步

- Responses结构化输出仍出现过多余字段、格式尾符和维度漏引用；本地校验与审计不能省略。
- 两次思考耗尽输出上限，保留原响应和费用，仅做一次无思考恢复；明确的网络未知不自动重试。
- 本轮只以固定流程读取已登记的上下文/来源；尚未让模型自主调用工具，也未实现任意代码公式执行。
- 程序检查类型、引用、枚举与公式契约；不能代替语义审核。安全算子只执行明示参数的乘除法。
- 必填不能因资料缺失降级、SKU包装层级、其他与未知区分等已固化为r2共享标准和专项检查，三卡通过结构回归。原始r1标准保留快照，当前发布卡使用r2。
- 原建模阶段纸巾盒仅2件有效样本；本次文本试填已补至11件。先处理试填暴露的共用规则/反例矛盾，再决定其余18类扩围。湿厕纸边界、软抽数量冲突、来源异常尺寸等保留待确认。
- 标准版本更新后的累计预算跨目录关联尚待实现；当前继续使用同一run和¥50账本，不重置预算。
- 本地参考已接入显式`workflows/review-local-reference.ts`复核入口；后续新类目首次生成的自动参考注入仍需接线，不能仅凭catalog登记声称已经输入模型。

## 三类文本试填（2026-10-20）

基于上述55条已发布属性绑定，不读取旧三横商品填写答案。官方DeepSeek负责并发归属筛选、初填、同品核对提议、补证填写、语义复核及定点修复；Codex核对异常、已填证据与规则解释。没有调用Kimi、GLM、Qwen，没有从任何图片（含HTML图片alt）提取信息，没有写入线上商品。

- 原30件继续保留；另从ES随机抽取60件纸巾盒候选，筛选补入9件（含1件非京东OEM样本）。39件明细中28件归属符合：软包抽纸9、湿纸巾8、纸巾盒11；10件错挂、1件边界待确认不计填充率。筛选后的样本不是总体随机估计量。
- 一商品×一属性，共676行；符合商品原有500属性槽，16项已确认不适用排除。226/484=46.7%总体填充率；固定必填加条件必填110/135=81.5%。条件未知保守计入分母，不通过改可选提高指标。
- 27件有京东详情，22件同品准入、5件规格/身份尚未确认；1件非京东商品检索未找到可核实同品。最终130项引用京东，49项相对三横初填候选为京东参与补出；初填候选不是独立验收基线，不能解释为京东的因果净贡献。
- 10项为枚举外真实候选，主要是纸巾兼容多值与风格复合词；不等于10个都应扩枚举。棉布→布艺、百花香→花香等现有上位枚举可覆盖，不计新缺口。
- 本次新增调用费用估算7.01947568元，同一run累计9.82345208元，未重置50元预算；非供应商账单。实际输入缓存命中仍低，不能宣称已实现高缓存收益。
- 曾出现多余JSON字段和同品状态交接缺失；保留失败与旧意见，补传`verifiedIdentity`并定点修复。28件均有实际DS语义复核，模型一致或程序通过不代表准确率。

最终文件：`outputs/product-governance-v2/clean-paper-20261020/清洁纸品V2三类属性卡与商品试填评估.xlsx`。每类独立sheet，一行一个属性，附原文、来源、公式、缺失主因、枚举、V2目标和运营审核列；同一本保留建模卡、震坤行采纳记录及调用成本。

入口按阶段执行，已经完成的输入哈希相同则复用缓存：

```bash
# root run目录沿用上面的路径；先读状态，不重复外部调用。
bun src/scenarios/product_governance_v2/trial/screen.ts <run>
bun src/scenarios/product_governance_v2/trial/initial-fill.ts <run>
bun src/scenarios/product_governance_v2/trial/enrich.ts <run>
bun src/scenarios/product_governance_v2/trial/supplement-and-review.ts <run>
# 本次上下文交接修复的受影响结果专用入口
bun src/scenarios/product_governance_v2/trial/repair-context.ts <run>
# 以下离线裁定及报表，不产生模型费用
bun src/scenarios/product_governance_v2/trial/finalize.ts <run>
bun src/scenarios/product_governance_v2/reports/prepare.ts <run>
bun src/scenarios/product_governance_v2/trial/report.ts <run>
# export-trial.mjs通过桌面捆绑artifact-tool运行
```

`trial/finalize.ts`的商品裁定是本次样本的显式记录，不可当作泛化分类规则。生成器与审核器之后应共用发布规则；本次仍保留r2卡快照，试填解释与修订建议单列在“试填口径与问题”，没有悄悄覆盖旧卡或宣称已发布下一标准版。需修正的重点：单包抽数错误反例、数量组合前提、兼容纸巾多值、印花/压花独立语义、上游参数对象错配。纸张尺寸展开口径仍需运营抽检。

## 缓存优化与小批验证（2026-10-20）

### 请求和调度

- `providers/prefix.ts`将固定候选类目、当前属性卡、执行口径置于商品资料之前。嵌套对象稳定排序、JSON无缩进，数组顺序和所有JSON业务值保留；商品证据仍是用户输入数据，不提升为系统指令。未向请求添加随机ID或时间戳。
- `DeepSeek.generate()`默认使用固定前缀；已有旧布局响应或请求回执优先复用，不因更换布局重复付费。`reuseLegacy:false`仅供显式小批对比，响应仍有本地断点。
- 初填、补填、审核、修复分别按类目分组；每组前两件真实待办顺序执行，再并发剩余待办。已完成项先排除，不用空请求预热，不用已缓存的本地结果冒充服务器预热。默认并发8，可传`--concurrency 1..64`。
- 修复返回字段补丁，包含原结果hash与目标属性ID。只提交受影响字段及数量/条件依赖；整张属性卡作为稳定上下文保留。合并前校验商品、版本、字段范围、重复项；合并后全量程序检查。类目/覆盖等无法定位到字段的问题转人工裁定，不偷偷重跑全商品。
- 依赖组集中在`trial/delta.ts`，包含包装数量、组合条件和尺寸关联；新增属性需要补充依赖，不能靠名字猜公式。支持规则输入显式`attributeId`依赖。
- 同品补填属于新增证据下的整体复核；本次缩减的是错误修复输出，不省略每件商品的整件语义审核。

依据：[DeepSeek上下文缓存说明](https://api-docs.deepseek.com/zh-cn/guides/kv_cache/)、[Responses支持范围](https://api-docs.deepseek.com/zh-cn/guides/responses_api/)。缓存由服务端按公共前缀尽力提供，不能承诺必命中；未使用不支持的`prompt_cache_key`或`prompt_cache_retention`。

### 实测结果

对6件软包抽纸重新发出一次初填验证，对2件纸巾盒发出小范围补丁；保留原明细/裁定/Excel。比较对象是同商品历史调用，非同时随机A/B；修复同时缩小了任务范围，因此不能把全部降费归因于缓存。

|验证阶段|历史输入缓存命中率|优化后输入缓存命中率|历史费用估算|优化费用估算|
|---|---:|---:|---:|---:|
|6件初填（含1件格式失败）|6.76%|76.41%|¥0.28210504|¥0.18384312|
|2件纸巾盒字段修复|6.09%|37.90%|¥0.10147968|¥0.03554504|

初填同类首件后，其余5次约90%命中；初填调用费用下降34.8%。两件纸巾盒修复输出从5,767降至888 Token，减少84.6%；所有非目标字段保留不变，合并检查通过。

质量不能由命中率推断：6件初填中1件返回不可安全修复的JSON，保留付费失败记录；2件出现程序检查错误（原历史结果也有对应错误），追加2次字段补丁共¥0.03747208，其中1处香型状态/缺失原因冲突仍需裁定。没有无限重试，也没有把失败响应移出成本和缓存统计。验证总计10次新请求，费用估算¥0.25686024，原run累计¥10.08031232，仍在¥50上限内。均为实际Token按既定高峰单价估算，不是账单。

恢复入口验证：初填跳过28件；上下文修复跳过28件；补填/复核无剩余待办，均未发起新请求。31项测试覆盖前缀无损、旧请求复用、分组并发、补丁越权/陈旧版本拒绝等；TypeScript检查通过。测试不等于商品准确率。

```bash
# 仅显式小批验证；重复执行复用同批调用，不新建预算
bun src/scenarios/product_governance_v2/trial/cache-benchmark.ts \
  outputs/product-governance-v2/clean-paper-20261020 --concurrency 4
# 日常待办仍走原入口，增加可选并发参数
bun src/scenarios/product_governance_v2/trial/initial-fill.ts <run> --concurrency 8
bun src/scenarios/product_governance_v2/trial/supplement-and-review.ts <run> --concurrency 8
```

原始响应、验证失败、补丁及统计保存在`<run>/trial/cache-validation-v1/`；`summary.json`为机器可读对比。验证隔离区不作为正式填写结果，格式失败和残留冲突必须经后续裁定后才能交付。

## 三类收口与21类属性建模（closure-r3）

本轮只完成已授权的两个阶段：先处理原3类共用规则和隔离实验问题，再补齐18类属性卡。没有重跑历史整批商品填写，也没有执行生产同步。

- `standards/07-trial-closure.md`固定单包/总量、独立计算输入、包装层级未知状态、多值选项、印花/压花、同品上下文与本地模板适用性规则。
- 原3类共56条绑定，13个合成规则案例均有实际DeepSeek响应并通过预期检查。这不是商品准确率。
- 新增18类各随机抽10件ES在售商品标题和规格用于建模。合并原30件参考快照，共210件。新旧真实商品试填仍保留在历史输出。
- 21类最终339条属性绑定；公共定义统一，但类目特性ID按类目作用域区分。每类完成DeepSeek完整语义复核；后续仅修改和复核受影响部分。Codex裁定包含采纳、澄清和驳回模型误报，不能将模型一致视为验收通过。
- 本地震坤行M45112上位模板12项×21类，共252项采纳判断，保留文件哈希、Sheet与行号。未向生成模型输入旧三横21类答案。
- 枕巾、生活用纸、卷纸配件随机样本中没有确认匹配；另有低覆盖类目。属性候选已整理，枚举仍需有效商品补证。一次性日杂、生活用纸、枕巾、坐垫纸存在运营边界确认项，均未改V2树。
- 本轮新增费用估算¥8.92636168，累计¥19.006674；原run的¥50账本不重置，包含失败与修复费用。新增输入缓存命中率38.87%，仅代表这一批实际请求。

修订输出在`<run>/revisions/closure-r3/`。旧run冻结文件、旧卡和旧Excel不覆盖。`pilot-gate.json`只允许后续属性建模，**不代表商品验证、运营验收或线上发布通过**。修订的`final-cards.json`及各类`final.json`是当前交付快照；`finalFieldChanges`保留最后裁定前后字段差异。

```bash
# 以下入口按已确认流程依次运行；已有请求和结果从断点复用
bun src/scenarios/product_governance_v2/workflows/close-pilot.ts <run>
bun src/scenarios/product_governance_v2/workflows/finalize-closure.ts <run>
bun src/scenarios/product_governance_v2/workflows/expand-attributes.ts <run> collect
bun src/scenarios/product_governance_v2/workflows/expand-attributes.ts <run> run
# 本轮隔离失败的修复与显式Codex裁定，不是通用自动业务裁判
bun src/scenarios/product_governance_v2/workflows/recover-expansion.ts <run>
bun src/scenarios/product_governance_v2/workflows/adjudicate-expansion.ts <run>
bun src/scenarios/product_governance_v2/workflows/recheck-expansion.ts <run>
bun src/scenarios/product_governance_v2/workflows/finalize-expansion.ts <run>
bun src/scenarios/product_governance_v2/reports/prepare-closure.ts <run>
# export-closure.mjs 通过桌面捆绑 @oai/artifact-tool 导出修订Excel
```

`domain/normalize-card.ts`只执行可追踪的格式修复：ID大小写、结构化引用、模型知识伪引文和已冻结公共规则。属性语义、必填与边界仍须显式裁定。不要将本轮人工裁定脚本直接套到未来不同类目或不同输入。

## 当前工作重心调整（2026-10-20）

用户明确要求暂不关注填写率。已发生的试填响应、费用、失败断点和裁定草稿保留；不自动恢复试填或导出未完成的填充率报告。当前阶段不要求每件样本填写所有属性。

已实现：属性生成前读取每类10件ES在售商品标题/规格，先判断归属，仅将matched样本交给属性生成及语义复核；同时使用本地震坤行参考。此机制支持样本辅助建模，但尚未独立形成可计数、可追溯的枚举候选聚合表，不能声称已覆盖全部在售商品的属性取值。

后续重点：按类目汇总符合归属的样本所体现的用途、形态、材质、计量层级和明确选项原文，记录代表商品与来源；据此发现缺失属性、枚举候选及口径冲突。只定点修改受影响属性卡，不重新逐商品填完整卡。仅因商品资料缺失，不取消有价值属性或降低核心必填；随机样本不能证明枚举穷尽。
# 已有属性卡的批量复核

已有卡走 `batch-audit-*`，不会调用属性重新生成阶段。默认并发上限32，关闭思考；
实际并发不超过尚待处理的类目数，同一类目的复核与修复按依赖顺序执行。

```sh
bun src/scenarios/product_governance_v2/cli.ts batch-audit-plan --revision remaining-review --category-ids <末级或父级ID列表> --concurrency 32
bun src/scenarios/product_governance_v2/cli.ts batch-audit-run --revision remaining-review --category-ids <相同ID列表> --phase all --concurrency 32
bun src/scenarios/product_governance_v2/cli.ts batch-audit-repair --audit-dir <审核批次目录> --decisions <裁定方向JSON> --concurrency 32
```

- DeepSeek负责每类完整语义复核、提出遗漏和矛盾；程序检查类型、公式和六组覆盖记录。
- 修复命令读取明确的允许修改ID和允许新增ID，只返回字段差异；禁止删除原属性、修改公共定义和降低核心必填。
- Codex裁定异常、必要新增与模型分歧；运营仍负责业务抽检。模型一致或程序通过均不代表准确率。
- 每个阶段保存请求、原始响应及断点。重复执行跳过已有结果；失败只处理失败项。
- 新建批次采用 `batch-v3-concepts`，已有卡审核采用 `existing-audit-v2-concepts`：六组覆盖之外逐项判断12个独立概念，已覆盖、不适用或待补属性均给理由。不是每类强制新增12项。
- 常规 `--phase all` 自动串联DeepSeek复核、范围受限的首修和变更重验，普通合格项进入抽检；残留异常才交Codex。`--phase review` 仅供明确要停在诊断结果时使用。`batch-audit-repair` 是异常裁定后的可选定点工具，不是每类的必经人工步骤。
- 概念表并入原有请求，复用固定上下文；不为每个概念单独调用模型。新协议启用新增检查，历史冻结批次保持原协议与断点，不为标准升级重跑。
- Excel同步只更新受影响属性及试填字段，保留其他类目、商品证据和运营意见；新增无证字段不伪填。

