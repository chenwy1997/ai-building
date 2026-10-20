# 21 类商品复核：审核包与汇总

从仓库根目录执行，默认 run 为 `outputs/product-governance/clean-paper-all21-validation-20261019`。

```sh
bun run src/scenarios/product_governance/validation21/prepare-review.ts
bun run src/scenarios/product_governance/validation21/assemble.ts
```

两命令支持 `--run /绝对目录 --standard /绝对标准.json --tree /完整V2树.json`。不调用模型、不写商品裁定、不生成 Excel。

## 输入与审核包

- `design/standard.json`：冻结标准。`inputs/model-products.json`：纯商品及证据数组；禁止夹入旧 fields/category/models 答案。
- `manifests/historical.json`、`manifests/new13.json`：独立冻结 cohort，校验标准哈希、商品数量和商品哈希。实际样本按 manifest，不能硬凑计划 1050；本批小总体类目可全取。
- `normalized/*.json`：仅接收 `stage=validate21-*` 的四模型 invoke 响应。所有重试均保留；最近返回仅作为展示候选，不是终审。`productsWithResponse`表示收到商品行，不宣称模型每字段都正确。
- `inputs/verified-visual-evidence.json`：由采集/独立审证流程提供。历史视觉授权逐条核 productId/evidenceId、文本哈希、原图 SHA256 和 sourceRef；模型自称已核验无效。
- `analysis/review-packages/Cxx/overview.json`：类目卡、绑定、条件和审核批索引；每 5 件一个 `.review.json`。`sources.json`保留完整原证据及所有模型尝试；preview仅为索引，不能代替精确引文。

`prepare-review`可在模型尚未齐全时重复生成审核包；它不会创建 `analysis/codex-reviews` 下的结论。

按类增量：`bun run src/scenarios/product_governance/validation21/prepare-review.ts --category C15,C18 --ready-only`。类目参数也可用真实ID或名称；只重写选中类，`--ready-only`只写四模型均已返回的5件审核批。全局 `analysis/review-progress.json` 每次都刷新，按类列 `fourModelsReady`、`readyBatches`、待齐商品与缺少模型；已齐批次可先审，不必等待全部1016。加 `--watch --interval 30000` 可在后台每30秒重读模型返回并增量刷新。四模型齐仅表示具备对照意见，并非裁定通过。

## Codex 裁定契约

每个商品只允许一条有效裁定，文件放 `analysis/codex-reviews/*.json`：

```json
{
  "schema": "validation21-codex-review-v1",
  "reviewer": "Codex",
  "standardHash": "冻结标准哈希",
  "products": [{
    "key": "C01-01",
    "category": {"status":"matched","targetId":"当前类目ID","targetName":"末级类目名","targetConfirmed":true,"reason":"逐件实证理由"},
    "fields": {"属性ID":{"value":null,"status":"needs_evidence","unit":null,"per":null,"evidenceId":null,"quote":null,"reason":"当前SKU未明确","calculation":null}},
    "conditionFacts": [],
    "evidence": [],
    "visualEvidence": [],
    "imageVerified": false,
    "ruleDecisions": [],
    "reviewNotes": ["实际阅读原证据和四模型意见后的独立裁定说明"],
    "modelReviewSources": {"deepseek":{"sourceFile":"normalized/原文件.json","opinionDigest":"审核包对应原意见摘要"},"kimi":"normalized/原文件.json","glm":"normalized/原文件.json","qwen":"normalized/原文件.json"}
  }]
}
```

matched须覆盖所有当前绑定；unknown仍明确写 needs_evidence。wrong/uncertain可 `fields:{}`，全部排除原类计率。字段还可带 `weightScope`、`originalValue/originalUnit`、`declarationEvidence`、`templateIssue` 等原规则元数据。分类目标ID均校验完整V2末级；ID确认后名称和路径从V2字典补齐，原category另存。

真实缺类须 `category.gapAssessment={status:'confirmed_missing_category',proposedName,reason,fullTreeChecked:true,treeHash,evidence:[{evidenceId,quote}]}`；不能把商品资料不足或只在21类中没找到当作确实缺类。未确认归属单列 needs_product_evidence。

商品组成已明确但跨类组套/主商品策略尚未定义时，可填 `category.categoryReasonCode='category_strategy_pending'`；仍为uncertain并排除计率，单列策略待决，不能伪装成资料不足或已确认缺类。

规则review可由Codex实证接受：`ruleDecisions:[{attributeId,code,decision:'accepted',reason,evidence:[{evidenceId,quote}]}]`。未单列evidence时只允许回指该字段现有合法引文，输出会标记 proofFrom。理由须具体；模型一致率不是理由。类型、非法引用、单位矛盾、未绑定/退休字段和非V2目标等结构error须修正。没有规则提示不代表可以跳过逐件阅读。

Codex新增 `visualEvidence` 须 kind=image_verified、当前productId、原图sourceRef，并明确 `imageVerified:true`；仅来自此独立裁定目录才可登记，绝不从模型响应拷入授权注册表。

已声明的四模型已读引用逐件校验同key/model和原意见内容digest。新文件仅重建外壳、原意见相同可沿用；意见内容不同则 `MODEL_OPINION_CHANGED_AFTER_REVIEW` 阻断，须实际重读并更新引用。也兼容 `modelReview.refs:[{model,file}]`。审核包提供opinionDigest，正式行保留modelReviewAudit；未给引用的旧裁定仍需人工审计阅读记录，系统不会补造已读声明。`modelIdentity`保留真实版本/供应通道，例如Kimi家族混合通道不能在报告中写成同一模型版本。

执行兼容层 `legacy-compat.ts` 处理确定的词面解析误报：原文ASCII型号与数量有空白时保留数字边界；已注册pcs/Pcs→PCS大小写别名须保存originalUnit。中文层数“单层/一层/双层/二层/三层/四层/五层/六层”仅在soft.layers的同SKU合法精确原词、对应数字和层单位一致时转为review，仍须读完整来源核定没有否定、包装层或规格混淆。兼容检查保留originalCheck和原文witness，仍需Codex逐字段实证接受。紧连型号不猜切，真实400248/80等差异继续报冲突；抽/张/片等不作单位转换。冻结标准、证据和旧rules均不改写。

## 正式出数门禁与指标

`assemble`默认要求两个cohort都冻结、四模型覆盖所有实际样本、每件Codex裁定完整且规则问题均有明确处理，才写 `analysis/final.json`。否则仅写 `analysis/readiness.json`，退出码2，不输出字段填充率。报告必须确认 readiness.status=ready，并核对 productsHash；旧final文件不能作为本次未通过运行的结果。

2026-10-20 本批交付采用用户确认的现有意见方案：`analysis/delivery-policy.json` 将 `available-opinions-20261020` 精确绑定本批标准与商品哈希，要求已有 DeepSeek、GLM 全覆盖，允许 Kimi、Qwen 真实缺项。该例外不改变默认四模型流程。每件缺项商品必须声明 `reviewPolicy`、准确的 `missingModelReviews`，并保留所有实际已读意见的文件与摘要；少读已有意见或伪造缺失意见仍阻断。Codex逐件证据、字段规则和目标类目门禁全部保留。结果中的 `pendingCrossReviews` 与真实版本/通道逐件公开，不得称四模型全齐；已完成意见不重复调用，不自动恢复限额通道。模型覆盖率也不是业务准确率。

三个率分开，rate均为0..1，分母0为null：

1. `metrics.overallFields`：matched且目标已确认商品；绑定适用true/unknown进入总槽，确认false才剔除。unknown不因字段自称NA消失，候选/冲突不算已填。
2. `metrics.independentRequiredFields`：只算组外独立核心/条件必填。必填或适用unknown保留保守分母，未确认状态不计必填达标。`confirmedSlots/unknownSlots`分别列示。OR组成员不重复当作同时独立必填。
3. `metrics.orGroups`：每个适用true/unknown的OR组一项义务。组适用true且一路成员均适用true、有效filled才完成；未选路线unknown仍留字段缺项，不否定已完整路径。

Codex原value/status完整保留。接受review后用原值重新跑conditions，不沿用semantic guard内部的保守降级副本；未接受提示会阻止正式出数。纯可选适用unknown不阻断必填完整，但进入总槽及unknown统计。

`missingReasons`每槽只选一个主原因，含 count、shareOfMissingSlots、shareOfAllSlots；`independentRequiredMissingReasons`用独立必填槽单独计算。完整 reason 原文仍在 fieldRecords。所有指标仅描述本批分层样本，绝不外推21类商品总量。

## 导出 JSON

正式文件：`{schema,status,runId,standardHash,sampling,metrics,byCategory,perAttribute,missingReasons,independentRequiredMissingReasons,rows,fieldRecords,ruleChecks,modelCoverage,inputHashes}`。

`fieldRecords`含 key/oldKey/productId/categoryId/category/categoryPath/categoryStatus、attributeId/name、原字段对象、source/sourceRef、requirednessMode/applicabilityState/requirednessState、inRate/filledForMetric、independentRequiredInRate/independentRequiredFilled、missingReasonCode/missingReason、reviewSource/acceptedRuleDecisions，以及四模型 Value/Status/Unit/Per/Quote。`perAttribute`按标准类目和绑定顺序输出，供导出器保持同类连续。

测试：`bun test src/scenarios/product_governance/validation21/metrics.test.ts src/scenarios/product_governance/validation21/legacy-compat.test.ts`。

## CommandCode 与 OpenCode 续审通道

本地 `COMMANDCODE_API_KEY` 与 `OPENCODE_API_KEY` 分别保存。CommandCode 已核实 Qwen/Qwen3.8-Flash、z-ai/glm-5.3-flash、moonshotai/Kimi-K3；DeepSeek 保持官方通道。

用 `recover-missing MODEL --round=独立轮次 --route=commandcode --call-limit=上限` 选择 CommandCode；省略 route 则沿用原通道（Qwen/GLM 为 OpenCode、Kimi 为原 CLI），`--route=go-kimi-k3` 是 OpenCode Kimi K3。轮次只计划未形成完整有效意见且无在途请求的商品；通道切换不重新审核已有意见、不改动语义错误来伪造一致。每份记录保留真实 provider、adapter、请求模型及原始响应。轮换按实际缺项逐轮选择，遇到配额停止派发，遵守 Retry-After 后才能再用该通道；不自动购买额度或变更套餐。

CommandCode 使用官方流式 Chat Completions，完整接收后验证模型身份、stop 状态与 JSON 合约。终止流、工具调用、错模型、HTTP 错误不能作为有效审核。每次失败仍保留请求与错误断点；长响应从传输方式调整，不删改模型已经给出的商品判断。

长响应反复中断时，可在下一轮追加 `--products-per-call=2`。仅拆分当时尚缺意见的商品集合；冻结属性卡、证据及原始批引用不变，子请求另有唯一阶段名，已有意见不重复。当前已派发队列不会被该选项中途改写。

执行兼容另支持 `roll.sales_count` 的显式整箱表达式乘倍数，例如 `27卷（整箱销售）*5`：记录27卷与无量纲倍数5、同源scopeEvidence及135卷计算式；不伪造原文“5箱”。仅在同SKU、可信同源、正安全整数、精确公式及显式闭合包装表达式均成立时转人工review，保留旧检查并须Codex接受。裸多重相乘、错数/错公式、未核OCR不放行。
