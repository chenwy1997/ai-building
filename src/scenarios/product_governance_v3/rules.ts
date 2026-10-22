import { STAGES, type Stage } from "./core.ts";

export interface Rule {
  id: string;
  title: string;
  sections: string[];
  stages: Stage[];
  program: {
    checkId: string;
    entry: string;
    status: "partial" | "implemented";
    evidence: string;
  }[];
  human: string[];
  deferred: string[];
  artifacts: string[];
  examples: { positive: string; negative: string };
}
const modeling: Stage[] = [
  "family-modeling",
  "review-assistance",
  "domain-research",
];
const filling: Stage[] = ["sku-filling", "review-assistance"];
const check = (
  checkId: string,
  entry: string,
  evidence: string,
  status: "partial" | "implemented" = "partial",
) => ({ checkId, entry, status, evidence });
function rule(
  id: string,
  title: string,
  sections: string[],
  stages: Stage[],
  program: Rule["program"],
  human: string[],
  deferred: string[],
  artifacts: string[],
  positive: string,
  negative: string,
): Rule {
  return {
    id,
    title,
    sections,
    stages,
    program,
    human,
    deferred,
    artifacts,
    examples: { positive, negative },
  };
}
// Executable responsibility mapping. "partial" never means the whole business rule passed.
// Evidence points to development regression suites, not human held-out accuracy evaluation.
export const RULE_REGISTRY: Rule[] = [
  rule(
    "R01",
    "基础字段职责排除",
    ["## 1. 用途和落地边界"],
    STAGES,
    [
      check(
        "snapshot-coverage",
        "snapshot.ts:DataSnapshot",
        "contracts-regression.test.ts:system ownership",
      ),
      check(
        "definitions",
        "checks.ts:checkDefinitions",
        "wiring.test.ts:system ownership",
      ),
    ],
    ["职责表是否覆盖实际入口的所有基础字段？同义概念是否已有业务承载？"],
    ["真实系统职责清单采集与完整性人审", "执行时基础字段保护"],
    ["systemFieldCoverage", "definitions", "bindings"],
    "品牌由品牌库负责，适配器型号可作独立参数",
    "空表让品牌变成新属性",
  ),
  rule(
    "R02",
    "二元必填性",
    ["## 4. 必填性"],
    STAGES,
    [
      check(
        "output-contract",
        "contracts.ts:bindingSchema",
        "wiring.test.ts:binary requiredness",
        "implemented",
      ),
    ],
    ["必填理由是否明确影响关键选型？拿不准必要性是否先选填？"],
    [],
    ["bindings.requiredness", "bindings.requirednessReason"],
    "选填且理由待确认",
    "因样本有值就设必填或添加条件必填",
  ),
  rule(
    "R03",
    "同族共同标准",
    ["## 2. 同族与属性池"],
    modeling,
    [
      check(
        "family-contract",
        "checks.ts:checkResult",
        "contracts-regression.test.ts:binding differences",
      ),
    ],
    ["同族的共同定义和有理由的末级差异是否合理？"],
    ["真实同族共同方案生成与共享修订"],
    ["attributes", "bindings", "baselineVersion"],
    "共用是否无芯，必要性差异有业务理由",
    "同一参数在兄弟类目随意改名改单位",
  ),
  rule(
    "R04",
    "同族判断有正反例",
    ["## 2. 同族与属性池"],
    modeling,
    [
      check(
        "tools-provenance",
        "tools.ts:ToolRegistry",
        "wiring.test.ts:actual assembly",
      ),
    ],
    ["对象、结构和用途是否支持归族？相关但不同族反例是否排除？"],
    ["语义检索", "人工归族样板与误合并/漏发现评估"],
    ["related", "family", "attributePool"],
    "跨父节点检索到候选再判断",
    "仅因同父或同名就自动合并",
  ),
  rule(
    "R05",
    "候选、发布与变更",
    ["## 8. 候选、确认与并发"],
    STAGES,
    [
      check(
        "baseline-availability",
        "snapshot.ts:baseline",
        "wiring.test.ts:same-run candidates",
      ),
    ],
    ["候选采用范围和共享修改影响是否明确？"],
    ["注册表占用/创建/发布", "引用影响失效与调度"],
    ["baselineVersion", "family.availability"],
    "同批候选依赖仍待审",
    "其他批未审稿当确认标准",
  ),
  rule(
    "R06",
    "数值与单位口径",
    ["## 5. 数量和单位"],
    STAGES,
    [
      check(
        "definitions",
        "checks.ts:checkDefinitions",
        "wiring.test.ts:unit-only fields",
      ),
      check(
        "native-config",
        "native-contract.ts:definitionConfigErrors",
        "contracts-regression.test.ts:native configuration",
      ),
    ],
    ["数值、单位、范围是否同一个业务参数？抽与张是否有实际关系？"],
    ["真实审核组合展示"],
    ["numberConfig", "unit", "nativeProjection"],
    "5及张/包组合展示",
    "每包数量和其计数单位分成两项",
  ),
  rule(
    "R07",
    "拆分服务独立用途",
    ["## 6. 属性粒度与类型"],
    STAGES,
    [
      check(
        "definitions",
        "checks.ts:checkDefinitions",
        "wiring.test.ts:unit-only fields",
      ),
    ],
    ["每一拆分项是否具有独立选型、适配或计算用途？理由是否成立？"],
    ["跨定义的语义交叉识别"],
    ["attributes.rationale", "bindings.uses"],
    "长宽分别服务适配",
    "只为细分添加原文属性或重复属性",
  ),
  rule(
    "R08",
    "类型、枚举与多选",
    ["## 6. 属性粒度与类型"],
    STAGES,
    [
      check(
        "native-config",
        "native-contract.ts:definitionConfigErrors",
        "contracts-regression.test.ts:native configuration",
      ),
      check(
        "sku-values",
        "checks.ts:checkResult",
        "contracts-regression.test.ts:calendar and constraints",
      ),
    ],
    ["选项边界、同义词、互斥和同时多值是否符合业务？"],
    ["枚举扩充提案与确认流程"],
    ["attributes", "values"],
    "多选值真实同时成立且计数合规",
    "2月31日或重复选项被接受",
  ),
  rule(
    "R09",
    "未知、不适用、否和零",
    ["### 7.1 状态与默认值"],
    filling,
    [
      check(
        "sku-values",
        "checks.ts:checkResult",
        "wiring.test.ts:false and zero",
      ),
      check(
        "snapshot-facts",
        "snapshot.ts:DataSnapshot",
        "contracts-regression.test.ts:fact preparation",
      ),
    ],
    ["引文是否真正支持此值？不适用是否有依据？"],
    ["原文到事实提取/核实流程", "后台未知值无损承接"],
    ["values.status", "values.evidence", "factPreparation"],
    "缺证值null，明确否保留false",
    "原文否却把预设true当成已核实",
  ),
  rule(
    "R10",
    "默认与派生",
    ["### 7.1 状态与默认值"],
    filling,
    [
      check(
        "output-contract",
        "contracts.ts:attributeSchema",
        "contracts-regression.test.ts:native configuration",
      ),
    ],
    ["默认建议是否被误当具体商品事实？推导规则是否适用？"],
    ["类目已知特征的核实推导", "后台入口自动补值差异"],
    ["attributes.defaultValue", "values.derivation"],
    "默认null，派生有规则",
    "常见值代替事实",
  ),
  rule(
    "R11",
    "建模与取值依据分开",
    ["## 3. 生成前的业务知识"],
    STAGES,
    [
      check(
        "knowledge-coverage",
        "tools.ts:knowledgeGaps",
        "contracts-regression.test.ts:knowledge discovery",
      ),
      check(
        "tools-provenance",
        "tools.ts:referenceError",
        "contracts-regression.test.ts:knowledge citations",
      ),
    ],
    ["业务必要性是否独立于商品样本？依据是否真的适用并支持该结论？"],
    ["真实知识内容准备和专业审核"],
    ["references", "knowledgeRequirements", "values.evidence"],
    "已读知识可作建模依据，SKU值另取证",
    "样本没写参数就删掉必要定义",
  ),
  rule(
    "R12",
    "证据冲突",
    ["### 7.2 来源冲突"],
    filling,
    [
      check(
        "sku-values",
        "checks.ts:checkResult",
        "wiring.test.ts:a derived value cannot overwrite",
      ),
      check(
        "calculation",
        "calculation.ts:calculate",
        "contracts-regression.test.ts:calculation assumptions",
      ),
    ],
    ["同SKU、组合、版本和口径冲突能否解释？未排除的双方是否保留？"],
    ["版本/参数准入与人工裁定记录"],
    ["values.status", "values.evidence"],
    "冲突留空并保留双方",
    "只选有利前提忽略有赠品证据",
  ),
  rule(
    "R13",
    "参数级外部复用",
    ["### 7.4 外部补证"],
    filling,
    [],
    ["外部身份、本体版本和每个参数的复用范围是否有据？"],
    ["外部资料工具与逐参数准入"],
    ["parameter evidence admission (deferred)"],
    "同型号异包装只复用已核实本体参数",
    "整页照搬包装数",
  ),
  rule(
    "R14",
    "计算证据链",
    ["### 7.3 计算与换算"],
    filling,
    [
      check(
        "calculation",
        "calculation.ts:calculate",
        "contracts-regression.test.ts:calculation factors",
      ),
    ],
    ["因子含义及适用前提是否由原文真正支持？"],
    ["真实因子提取核实", "多级派生依赖"],
    ["calculationPolicies", "values.derivation"],
    "固定策略版本及同范围因子10×4",
    "负计数相乘得正数或猜测因子",
  ),
  rule(
    "R15",
    "图片为补充",
    ["### 7.5 图片作为补充证据"],
    filling,
    [],
    ["目标商品、图中文字、位置和转写是否明确？"],
    ["图像载荷/区域/转写流程"],
    ["image evidence (deferred)"],
    "清晰标签补证",
    "凭外观猜材质或认证",
  ),
  rule(
    "R16",
    "归属与实际挂载",
    ["### 7.6 商品归属与重挂提案"],
    filling,
    [
      check(
        "tools-provenance",
        "tools.ts:ToolRegistry",
        "wiring.test.ts:model can search",
      ),
    ],
    ["目标末级是否适用？标准归属与实际挂载是否分别核对？"],
    ["双归属合同", "重挂及迁移提案"],
    ["category tree", "mount proposal (deferred)"],
    "现有末级目标先核实",
    "仅改标准分类就宣称完成重挂",
  ),
  rule(
    "R17",
    "专业知识与分流",
    ["### 3.1 专业疑点的查证与裁定"],
    STAGES,
    [
      check(
        "knowledge-coverage",
        "tools.ts:knowledgeGaps",
        "contracts-regression.test.ts:knowledge discovery",
      ),
      check(
        "research-references",
        "checks.ts:checkResult",
        "contracts-regression.test.ts:knowledge discovery",
      ),
    ],
    ["专业检查清单是否覆盖关键口径？未决项是否有具体裁定问题？"],
    ["真实专业包/专家裁定回填"],
    ["knowledgeGaps", "questions", "unresolved"],
    "缺必读材料阻断依赖并转查证",
    "只标选填来掩盖定义不清",
  ),
  rule(
    "R18",
    "人工主审",
    ["### 9.1 人工样板与审核能力"],
    STAGES,
    [
      check(
        "adoption-state",
        "runner.ts:runStage",
        "wiring.test.ts:program failure",
      ),
    ],
    ["人工是否确认采用范围？未见验收能否支持减少复核？"],
    ["人工采用记录与保留验收集"],
    ["adoption", "humanReviewRules"],
    "程序通过仍pending_human",
    "AI自审同意即批准",
  ),
  rule(
    "R19",
    "根因与能力验证",
    ["### 9.3 研发改进"],
    ["review-assistance"],
    [],
    ["是否沿同根因和依赖扩查？调优与保留验收是否隔离？"],
    ["真实错误模式/影响查询/保留集"],
    ["review findings", "evaluation (deferred)"],
    "正确反例检查误报",
    "调优题成绩当未见业务准确率",
  ),
  rule(
    "R20",
    "报告口径",
    ["### 9.4 质量报告口径"],
    ["review-assistance"],
    [],
    ["指标的对象、分子、分母和人工依据是否清楚？"],
    ["业务质量指标和人审统计"],
    ["quality report (deferred)"],
    "构造接线报告明确边界",
    "填充率等于准确率",
  ),
  rule(
    "R21",
    "小屏审核体验",
    ["### 10.1 审核视图", "### 10.3 小屏体验"],
    ["review-assistance"],
    [],
    ["目标小屏能否看清关键判断信息、审核入口并访问全文？"],
    ["v3导出与Mac/Windows实际任务验收"],
    ["review workbook (deferred)"],
    "短业务定位冻结、ID后置",
    "缩字让整表挤进屏幕即过关",
  ),
  rule(
    "R22",
    "意见与内容版本",
    ["### 10.2 意见保持与结论复用"],
    ["review-assistance"],
    [],
    ["意见是否对应稳定对象和审定内容？实质变化是否失效？"],
    ["意见导出回收/依赖失效"],
    ["review revision (deferred)"],
    "排序后意见仍跟对象",
    "按行号认领审核意见",
  ),
  rule(
    "R23",
    "同版规则真正加载",
    ["## 12. 规范发布与执行一致性"],
    STAGES,
    [
      check(
        "release-lock",
        "release.ts:loadRelease",
        "wiring.test.ts:material/code drift",
      ),
      check(
        "rule-registry",
        "release.ts:instructionsFor",
        "contracts-regression.test.ts:rule registry",
      ),
    ],
    ["执行证据是否只说明已实施的检查，而未夸大语义能力？"],
    ["知识撤销与影响重验"],
    ["manifest", "ruleResponsibilities"],
    "材料/合同/检查代码一起锁定",
    "只有文件hash就声称所有规则已实现",
  ),
  rule(
    "R24",
    "恢复、成本与轮次",
    [
      "### 11.1 参数化离线入口",
      "### 11.3 中断恢复与业务返修",
      "### 11.6 成本与迭代上限",
    ],
    STAGES,
    [
      check(
        "request-limits",
        "runner.ts:runStage",
        "wiring.test.ts:call count/round count",
      ),
      check(
        "request-recovery",
        "responses.ts:ResponsesClient",
        "wiring.test.ts:unknown response",
      ),
      check(
        "budget-reservations",
        "budget.ts:Budget",
        "wiring.test.ts:concurrent reservations",
      ),
    ],
    ["批次身份、跨阶段返修成本和允许重试范围是否明确？"],
    ["runId绑定唯一总账", "完整批次调度/恢复/返修"],
    ["receipts", "budget ledger", "limits"],
    "未知不重发、相同目录累计",
    "新目录重置同批成本",
  ),
  rule(
    "R25",
    "配置及独立执行",
    [
      "### 6.1 SKU填写与销售展示",
      "### 6.2 公开与搜索用途",
      "### 11.2 独立执行已确认变更",
    ],
    STAGES,
    [
      check(
        "native-config",
        "native-contract.ts:projectNative",
        "contracts-regression.test.ts:native configuration",
      ),
    ],
    ["关键规格、公开、标题/列表和检索用途是否分别成立？"],
    ["原生ID/有效实例映射", "审核变更提案与服务端原子前提保护"],
    ["bindings", "nativeProjection"],
    "asSpec统一SKU但不全开关键规格",
    "提示词有字段、输出合同却无法表达",
  ),
  rule(
    "R26",
    "采用、核验与回退",
    [
      "### 9.2 问题分级与结果采用",
      "### 9.5 本批交付的结束条件",
      "### 11.4 写后核验与生效状态",
      "### 11.5 部分成功与回退",
    ],
    ["review-assistance"],
    [],
    [
      "严重问题是否解决或隔离？采用范围和未完成项是否明确？",
      "请求、核心回读、搜索展示与部分成功是否分别核验？回退是否保护后续修改？",
    ],
    ["严重项隔离/人工采用", "逐项回读/异步生效核验/受保护回退"],
    ["adoption scope", "verification/rollback (deferred)"],
    "部分成功逐项报告并保留独立成功项",
    "旧版本存在等于整批一键回退",
  ),
];
export const STAGE_RULES = Object.fromEntries(
  STAGES.map((stage) => [
    stage,
    RULE_REGISTRY.filter((r) => r.stages.includes(stage)).map((r) => r.id),
  ]),
) as Record<Stage, string[]>;
// Historical tuple readers may identify a rule; execution uses the full registry above.
export const RULES = RULE_REGISTRY.map(
  (r) =>
    [
      r.id,
      r.sections[0]!,
      r.program.length ? (r.human.length ? "mixed" : "program") : "human",
    ] as const,
);
