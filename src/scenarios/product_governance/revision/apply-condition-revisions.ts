import type { Condition, ConditionalBinding, FactDefinition } from './conditions.ts';

export interface RevisionFactDefinition extends FactDefinition {
  definition?: string;
  trueEvidence?: string;
  falseEvidence?: string;
  notEvidence?: string;
  scope?: string;
  evidenceRequired?: boolean;
  unknownPolicy?: string;
  [key: string]: unknown;
}
export interface RevisionBinding extends ConditionalBinding {
  categoryId: string;
  applicability?: string;
  evidenceRequirements?: string[];
  [key: string]: unknown;
}
export interface ConditionRevisionStandard {
  categories: Array<{ id: string; name: string; [key: string]: unknown }>;
  bindings: RevisionBinding[];
  conditionFactDefinitions?: RevisionFactDefinition[];
  requirementGroups?: Array<{ id: string; categoryId?: string; paths?: Array<{ attributes: readonly string[] }>; atLeastOne?: readonly (readonly string[])[]; [key: string]: unknown }>;
  [key: string]: unknown;
}
export interface ConditionRevisionSource {
  triageFile: string;
  triagePointer: string;
  auditedDraftSha256: string;
  auditedDraftPointer?: string;
  bindingId?: string;
}
export interface AppliedConditionChange {
  kind: 'condition_fact_added' | 'condition_fact_completed' | 'binding_condition_revision' | 'binding_core_scope_revision' | 'binding_evidence_scope_revision';
  categoryId?: string;
  categoryName?: string;
  attributeId?: string;
  fact?: string;
  inputPointer: string;
  reason: string;
  source: ConditionRevisionSource;
  before: unknown;
  after: unknown;
}
interface BindingPatch {
  categoryId: string;
  categoryName: string;
  attributeId: string;
  mode: 'conditional' | 'core' | 'evidence';
  auditedApplicability: string;
  applicability: string;
  evidenceRequirement: string;
  condition?: Condition;
  source: ConditionRevisionSource;
}
interface FactPatch { definition: RevisionFactDefinition; source: ConditionRevisionSource }

// Audited data only. No file reads, clock, network, or draft writes occur in this module.
const BINDING_PATCHES: readonly BindingPatch[] = [
  {
    "categoryId": "1f96cac3-8498-4c32-936c-7a6a54b9320b",
    "categoryName": "纸巾盒",
    "attributeId": "fit.roll_diameter",
    "mode": "conditional",
    "auditedApplicability": "当前SKU经用途、形态及相邻边界确认属于本类；不得仅以现挂类目作为证据；完整容器明确适配卷纸",
    "applicability": "适配卷式纸品的容器；兼容多纸型时各适配分支可同时成立。",
    "evidenceRequirement": "真实的容器兼容纸型分支。复合兼容容器可同时为多支true；不能用isRollFormat判断容器，更不能因未写适配信息填false。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/0",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/33",
      "bindingId": "1f96cac3-8498-4c32-936c-7a6a54b9320b:fit.roll_diameter"
    },
    "condition": {
      "fact": "containerSupportsRollPaper",
      "equals": true
    }
  },
  {
    "categoryId": "1f96cac3-8498-4c32-936c-7a6a54b9320b",
    "categoryName": "纸巾盒",
    "attributeId": "fit.roll_width",
    "mode": "conditional",
    "auditedApplicability": "当前SKU经用途、形态及相邻边界确认属于本类；不得仅以现挂类目作为证据；完整容器明确适配卷纸",
    "applicability": "适配卷式纸品的容器；兼容多纸型时各适配分支可同时成立。",
    "evidenceRequirement": "真实的容器兼容纸型分支。复合兼容容器可同时为多支true；不能用isRollFormat判断容器，更不能因未写适配信息填false。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/1",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/34",
      "bindingId": "1f96cac3-8498-4c32-936c-7a6a54b9320b:fit.roll_width"
    },
    "condition": {
      "fact": "containerSupportsRollPaper",
      "equals": true
    }
  },
  {
    "categoryId": "1f96cac3-8498-4c32-936c-7a6a54b9320b",
    "categoryName": "纸巾盒",
    "attributeId": "box.roll_capacity",
    "mode": "conditional",
    "auditedApplicability": "当前SKU经用途、形态及相邻边界确认属于本类；不得仅以现挂类目作为证据；完整容器明确适配卷纸",
    "applicability": "适配卷式纸品的容器；兼容多纸型时各适配分支可同时成立。",
    "evidenceRequirement": "真实的容器兼容纸型分支。复合兼容容器可同时为多支true；不能用isRollFormat判断容器，更不能因未写适配信息填false。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/2",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/35",
      "bindingId": "1f96cac3-8498-4c32-936c-7a6a54b9320b:box.roll_capacity"
    },
    "condition": {
      "fact": "containerSupportsRollPaper",
      "equals": true
    }
  },
  {
    "categoryId": "1f96cac3-8498-4c32-936c-7a6a54b9320b",
    "categoryName": "纸巾盒",
    "attributeId": "fit.fold",
    "mode": "conditional",
    "auditedApplicability": "当前SKU经用途、形态及相邻边界确认属于本类；不得仅以现挂类目作为证据；完整容器明确适配折叠擦手纸",
    "applicability": "适配折叠擦手纸的容器；是否已有参数声明不是适用性门槛。",
    "evidenceRequirement": "真实的容器兼容纸型分支。复合兼容容器可同时为多支true；不能用isRollFormat判断容器，更不能因未写适配信息填false。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/3",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/36",
      "bindingId": "1f96cac3-8498-4c32-936c-7a6a54b9320b:fit.fold"
    },
    "condition": {
      "fact": "containerSupportsFoldedHandTowels",
      "equals": true
    }
  },
  {
    "categoryId": "1f96cac3-8498-4c32-936c-7a6a54b9320b",
    "categoryName": "纸巾盒",
    "attributeId": "fit.paper_size",
    "mode": "conditional",
    "auditedApplicability": "当前SKU经用途、形态及相邻边界确认属于本类；不得仅以现挂类目作为证据；完整容器明确适配抽取式纸张，且需区分展开/折后口径",
    "applicability": "适配可定义成张尺寸的抽取纸品容器；抽取动作不单独证明平叠或非卷。",
    "evidenceRequirement": "真实的容器兼容纸型分支。复合兼容容器可同时为多支true；不能用isRollFormat判断容器，更不能因未写适配信息填false。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/4",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/37",
      "bindingId": "1f96cac3-8498-4c32-936c-7a6a54b9320b:fit.paper_size"
    },
    "condition": {
      "fact": "containerSupportsSheetPaper",
      "equals": true
    }
  },
  {
    "categoryId": "1f96cac3-8498-4c32-936c-7a6a54b9320b",
    "categoryName": "纸巾盒",
    "attributeId": "box.sheet_capacity",
    "mode": "conditional",
    "auditedApplicability": "当前SKU经用途、形态及相邻边界确认属于本类；不得仅以现挂类目作为证据；完整容器适配折叠擦手纸，且厂家明确容量及适配纸规格",
    "applicability": "适配折叠擦手纸的容器；是否已有参数声明不是适用性门槛。",
    "evidenceRequirement": "容量及其对应适配纸型/规格须为当前SKU厂家明确声明；缺容量或纸规格留缺证据，不另建hasDeclaredCapacity作适用性门槛。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/5",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/38",
      "bindingId": "1f96cac3-8498-4c32-936c-7a6a54b9320b:box.sheet_capacity"
    },
    "condition": {
      "fact": "containerSupportsFoldedHandTowels",
      "equals": true
    }
  },
  {
    "categoryId": "69d8ff06-f670-4ca8-89e5-d6e1c497244f",
    "categoryName": "洗脸巾",
    "attributeId": "face.size",
    "mode": "conditional",
    "auditedApplicability": "当前SKU经用途、形态及相邻边界确认属于本类；不得仅以现挂类目作为证据；单张或已分节成品；不分节卷式不适用",
    "applicability": "独立成张平叠巾体或已分节卷式巾体；明确不分节的连续卷式不适用，组织或分节未明则unknown。",
    "evidenceRequirement": "单张平叠本体或已分节卷具有单张/单节展开尺寸；只有明确卷式且不分节两项充分为真才可排除。抽取动作不反证卷式，没给尺寸不等于不适用。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/6",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/156",
      "bindingId": "69d8ff06-f670-4ca8-89e5-d6e1c497244f:face.size"
    },
    "condition": {
      "any": [
        {
          "fact": "isRollFormat",
          "equals": false
        },
        {
          "fact": "hasExplicitPerforation",
          "equals": true
        }
      ]
    }
  },
  {
    "categoryId": "eb42a48e-c62b-4f2c-87ea-ca27021c31b6",
    "categoryName": "餐巾纸",
    "attributeId": "paper.quantity",
    "mode": "core",
    "auditedApplicability": "当前SKU经用途、形态及相邻边界确认属于本类；不得仅以现挂类目作为证据；单一同规格、按张/抽/片等计数销售；异质组合不适用，销售计量路径未明则条件待判",
    "applicability": "独立核心计量：单内包装成品计数值、原计数单位与内包装单位三元成组核验。缺数量、单位或层级仍须待补；异质组成逐组成记录，不整体豁免，不以按重声明代替该计数义务。",
    "evidenceRequirement": "SKU已通过类目准入后，本核心始终适用。三元须同SKU、同版本、同口径；没有明确计数是缺值，不能将hasCountBasedSelling未知/否或未声明数量当豁免；不能暗中引入质量OR路径。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/7",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/172",
      "bindingId": "eb42a48e-c62b-4f2c-87ea-ca27021c31b6:paper.quantity"
    }
  },
  {
    "categoryId": "eb42a48e-c62b-4f2c-87ea-ca27021c31b6",
    "categoryName": "餐巾纸",
    "attributeId": "paper.count_unit",
    "mode": "core",
    "auditedApplicability": "当前SKU经用途、形态及相邻边界确认属于本类；不得仅以现挂类目作为证据；单一同规格、按计数销售，必须与计数值成对；未明则条件待判",
    "applicability": "独立核心计量：单内包装成品计数值、原计数单位与内包装单位三元成组核验。缺数量、单位或层级仍须待补；异质组成逐组成记录，不整体豁免，不以按重声明代替该计数义务。",
    "evidenceRequirement": "SKU已通过类目准入后，本核心始终适用。三元须同SKU、同版本、同口径；没有明确计数是缺值，不能将hasCountBasedSelling未知/否或未声明数量当豁免；不能暗中引入质量OR路径。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/8",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/173",
      "bindingId": "eb42a48e-c62b-4f2c-87ea-ca27021c31b6:paper.count_unit"
    }
  },
  {
    "categoryId": "eb42a48e-c62b-4f2c-87ea-ca27021c31b6",
    "categoryName": "餐巾纸",
    "attributeId": "paper.inner_unit",
    "mode": "core",
    "auditedApplicability": "当前SKU经用途、形态及相邻边界确认属于本类；不得仅以现挂类目作为证据；填写单内包装计数或净纸重时，必须明确对应包装层级",
    "applicability": "独立核心计量：单内包装成品计数值、原计数单位与内包装单位三元成组核验。缺数量、单位或层级仍须待补；异质组成逐组成记录，不整体豁免，不以按重声明代替该计数义务。",
    "evidenceRequirement": "SKU已通过类目准入后，本核心始终适用。三元须同SKU、同版本、同口径；没有明确计数是缺值，不能将hasCountBasedSelling未知/否或未声明数量当豁免；不能暗中引入质量OR路径。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/9",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/174",
      "bindingId": "eb42a48e-c62b-4f2c-87ea-ca27021c31b6:paper.inner_unit"
    }
  },
  {
    "categoryId": "15c851c5-7435-4843-8df6-4bd61dd3c1d5",
    "categoryName": "厨房纸巾",
    "attributeId": "roll.perforated",
    "mode": "conditional",
    "auditedApplicability": "当前SKU经用途、形态及相邻边界确认属于本类；不得仅以现挂类目作为证据；明确卷式厨房纸；非卷式不适用，形态未明则条件待判",
    "applicability": "仅卷式厨房纸适用是否分节属性；组织形态未明则unknown，未声明分节不作为不适用。",
    "evidenceRequirement": "卷式才判断是否分节；不以hasExplicitPerforation作本字段适用门槛，否则false值和未知会被自循环豁免。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/10",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/191",
      "bindingId": "15c851c5-7435-4843-8df6-4bd61dd3c1d5:roll.perforated"
    },
    "condition": {
      "fact": "isRollFormat",
      "equals": true
    }
  },
  {
    "categoryId": "542a38bf-4f0a-4725-a0a3-455ebbe8a66c",
    "categoryName": "枕巾",
    "attributeId": "pillow.process",
    "mode": "evidence",
    "auditedApplicability": "当前SKU经用途、形态及相邻边界确认属于本类；不得仅以现挂类目作为证据；有明确可定义的织造或加工结构；组合按组成记录",
    "applicability": "无额外适用性条件。填写要求：当前主体或各组成的织造/加工工艺须明确；无工艺声明保留缺项。",
    "evidenceRequirement": "织造/加工结构的值需要证据，但缺工艺声明不使属性失去适用性；枕巾含纺织及非织造加工，不能以“hasDeclaredProcess”豁免未知。组合按组成留值是作用域/引用规则。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/15",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/218",
      "bindingId": "542a38bf-4f0a-4725-a0a3-455ebbe8a66c:pillow.process"
    }
  },
  {
    "categoryId": "542a38bf-4f0a-4725-a0a3-455ebbe8a66c",
    "categoryName": "枕巾",
    "attributeId": "pillow.hole",
    "mode": "conditional",
    "auditedApplicability": "当前SKU经用途、形态及相邻边界确认属于本类；不得仅以现挂类目作为证据；一次性枕垫/枕脸巾条件分支；常规纺织平铺枕巾不适用",
    "applicability": "一次性枕垫/枕脸巾分支适用；常规纺织平铺枕巾不适用。明确无孔是本分支可记录的值，不是退出条件。",
    "evidenceRequirement": "真实商品形态分支，不是孔存在与否；处于一次性枕垫分支时明确无孔仍是有效值，不能将无孔判不适用。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/16",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/219",
      "bindingId": "542a38bf-4f0a-4725-a0a3-455ebbe8a66c:pillow.hole"
    },
    "condition": {
      "fact": "isDisposablePillowFacePad",
      "equals": true
    }
  },
  {
    "categoryId": "ef61450e-4bfe-443e-a061-bb42c7d2b256",
    "categoryName": "坐垫纸",
    "attributeId": "paper.quantity",
    "mode": "core",
    "auditedApplicability": "当前SKU经用途、形态及相邻边界确认属于本类；不得仅以现挂类目作为证据；单一同规格、按张/抽/片等计数销售；异质组合不适用，销售计量路径未明则条件待判",
    "applicability": "独立核心计量：单内包装成品计数值、原计数单位与内包装单位三元成组核验。缺数量、单位或层级仍须待补；异质组成逐组成记录，不整体豁免，不以按重声明代替该计数义务。",
    "evidenceRequirement": "SKU已通过类目准入后，本核心始终适用。三元须同SKU、同版本、同口径；没有明确计数是缺值，不能将hasCountBasedSelling未知/否或未声明数量当豁免；不能暗中引入质量OR路径。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/17",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/228",
      "bindingId": "ef61450e-4bfe-443e-a061-bb42c7d2b256:paper.quantity"
    }
  },
  {
    "categoryId": "ef61450e-4bfe-443e-a061-bb42c7d2b256",
    "categoryName": "坐垫纸",
    "attributeId": "paper.count_unit",
    "mode": "core",
    "auditedApplicability": "当前SKU经用途、形态及相邻边界确认属于本类；不得仅以现挂类目作为证据；单一同规格、按计数销售，必须与计数值成对；未明则条件待判",
    "applicability": "独立核心计量：单内包装成品计数值、原计数单位与内包装单位三元成组核验。缺数量、单位或层级仍须待补；异质组成逐组成记录，不整体豁免，不以按重声明代替该计数义务。",
    "evidenceRequirement": "SKU已通过类目准入后，本核心始终适用。三元须同SKU、同版本、同口径；没有明确计数是缺值，不能将hasCountBasedSelling未知/否或未声明数量当豁免；不能暗中引入质量OR路径。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/18",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/229",
      "bindingId": "ef61450e-4bfe-443e-a061-bb42c7d2b256:paper.count_unit"
    }
  },
  {
    "categoryId": "ef61450e-4bfe-443e-a061-bb42c7d2b256",
    "categoryName": "坐垫纸",
    "attributeId": "paper.inner_unit",
    "mode": "core",
    "auditedApplicability": "当前SKU经用途、形态及相邻边界确认属于本类；不得仅以现挂类目作为证据；填写单内包装计数或净纸重时，必须明确对应包装层级",
    "applicability": "独立核心计量：单内包装成品计数值、原计数单位与内包装单位三元成组核验。缺数量、单位或层级仍须待补；异质组成逐组成记录，不整体豁免，不以按重声明代替该计数义务。",
    "evidenceRequirement": "SKU已通过类目准入后，本核心始终适用。三元须同SKU、同版本、同口径；没有明确计数是缺值，不能将hasCountBasedSelling未知/否或未声明数量当豁免；不能暗中引入质量OR路径。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/19",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/230",
      "bindingId": "ef61450e-4bfe-443e-a061-bb42c7d2b256:paper.inner_unit"
    }
  },
  {
    "categoryId": "ef61450e-4bfe-443e-a061-bb42c7d2b256",
    "categoryName": "坐垫纸",
    "attributeId": "seat.fold",
    "mode": "conditional",
    "auditedApplicability": "当前SKU经用途、形态及相邻边界确认属于本类；不得仅以现挂类目作为证据；单片平铺垫纸，或来源明确提供单片折叠方式的套入式商品",
    "applicability": "具有成品单片折叠对象的平铺垫纸或套入式单片商品；仅运输收纳折叠不作为成品单片折型。",
    "evidenceRequirement": "真实单片折叠对象分支。保留套入式中确有单片结构的情况；“来源提供折法”只是正面证据，不能以没声明折法反证对象不存在。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/20",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/231",
      "bindingId": "ef61450e-4bfe-443e-a061-bb42c7d2b256:seat.fold"
    },
    "condition": {
      "fact": "seatHasSingleSheetFoldObject",
      "equals": true
    }
  },
  {
    "categoryId": "fab47077-a93f-4938-912f-1a05b60be7a8",
    "categoryName": "一次性日杂",
    "attributeId": "common.color",
    "mode": "conditional",
    "auditedApplicability": "当前SKU经用途、形态及相邻边界确认属于本类；不得仅以现挂类目作为证据；经无专类核对的单一同规格商品；异质组合按组成记录，本字段不套整套",
    "applicability": "单一同规格主体适用；明示异质固定组合时按各组成分别保存本属性，不丢弃各组成材质等核心信息。",
    "evidenceRequirement": "单一同规格主体与异质固定组成确有属性作用域差别；只有完整异质组成证据可判false，随后应记录各组成相应属性，不丢弃材质等核心信息。组成未知不豁免required=true的材质。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/21",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/238",
      "bindingId": "fab47077-a93f-4938-912f-1a05b60be7a8:common.color"
    },
    "condition": {
      "fact": "isSingleHomogeneousItem",
      "equals": true
    }
  },
  {
    "categoryId": "fab47077-a93f-4938-912f-1a05b60be7a8",
    "categoryName": "一次性日杂",
    "attributeId": "item.material",
    "mode": "conditional",
    "auditedApplicability": "当前SKU经用途、形态及相邻边界确认属于本类；不得仅以现挂类目作为证据；经无专类核对的单一同规格商品；异质组合按组成记录，本字段不套整套",
    "applicability": "单一同规格主体适用；明示异质固定组合时按各组成分别保存本属性，不丢弃各组成材质等核心信息。",
    "evidenceRequirement": "单一同规格主体与异质固定组成确有属性作用域差别；只有完整异质组成证据可判false，随后应记录各组成相应属性，不丢弃材质等核心信息。组成未知不豁免required=true的材质。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/22",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/241",
      "bindingId": "fab47077-a93f-4938-912f-1a05b60be7a8:item.material"
    },
    "condition": {
      "fact": "isSingleHomogeneousItem",
      "equals": true
    }
  },
  {
    "categoryId": "fab47077-a93f-4938-912f-1a05b60be7a8",
    "categoryName": "一次性日杂",
    "attributeId": "item.size",
    "mode": "conditional",
    "auditedApplicability": "当前SKU经用途、形态及相邻边界确认属于本类；不得仅以现挂类目作为证据；经无专类核对的单一同规格商品；异质组合按组成记录，本字段不套整套",
    "applicability": "单一同规格主体适用；明示异质固定组合时按各组成分别保存本属性，不丢弃各组成材质等核心信息。",
    "evidenceRequirement": "单一同规格主体与异质固定组成确有属性作用域差别；只有完整异质组成证据可判false，随后应记录各组成相应属性，不丢弃材质等核心信息。组成未知不豁免required=true的材质。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/23",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/248",
      "bindingId": "fab47077-a93f-4938-912f-1a05b60be7a8:item.size"
    },
    "condition": {
      "fact": "isSingleHomogeneousItem",
      "equals": true
    }
  },
  {
    "categoryId": "66d9c6c0-4e07-4c79-9fcb-ebff831d2763",
    "categoryName": "卷纸配件",
    "attributeId": "accessory.compatibility",
    "mode": "core",
    "auditedApplicability": "当前SKU经用途、形态及相邻边界确认属于本类；不得仅以现挂类目作为证据；专机替换件，或明确通用件需保存其通用范围；归属/通用状态未明则条件待判",
    "applicability": "独立核心：保存专机适用型号或明确通用范围。缺型号、通用状态或范围仍须待补；不得以未声明适配信息排除分母。",
    "evidenceRequirement": "SKU已通过类目准入后，本核心始终适用。适用型号或明确通用范围必须来自当前SKU证据；未明不降低核心要求。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/24",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/269",
      "bindingId": "66d9c6c0-4e07-4c79-9fcb-ebff831d2763:accessory.compatibility"
    }
  },
  {
    "categoryId": "66d9c6c0-4e07-4c79-9fcb-ebff831d2763",
    "categoryName": "卷纸配件",
    "attributeId": "accessory.install",
    "mode": "conditional",
    "auditedApplicability": "当前SKU经用途、形态及相邻边界确认属于本类；不得仅以现挂类目作为证据；该零件确需安装到设备/固定位置；钥匙等不适用",
    "applicability": "实际使用需安装/固定到设备或固定位置的零件；电气件也可需安装，不能按几何接口事实代替。",
    "evidenceRequirement": "真实零件功能/服务纸型分支。零件自身外尺寸不能当额定适配纸品尺寸；OEM一对一替换映射用于接口采购路径，不自动否定这些可展示的物理适配属性。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/25",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/272",
      "bindingId": "66d9c6c0-4e07-4c79-9fcb-ebff831d2763:accessory.install"
    },
    "condition": {
      "fact": "accessoryRequiresInstallation",
      "equals": true
    }
  },
  {
    "categoryId": "66d9c6c0-4e07-4c79-9fcb-ebff831d2763",
    "categoryName": "卷纸配件",
    "attributeId": "fit.roll_diameter",
    "mode": "conditional",
    "auditedApplicability": "当前SKU经用途、形态及相邻边界确认属于本类；不得仅以现挂类目作为证据；零件直接限制纸卷容纳空间，例如轴/替换支架；锁钥等不适用",
    "applicability": "功能直接限制纸卷容纳外径的零件；锁钥/纯控制电路等不属于该限位对象。",
    "evidenceRequirement": "真实零件功能/服务纸型分支。零件自身外尺寸不能当额定适配纸品尺寸；OEM一对一替换映射用于接口采购路径，不自动否定这些可展示的物理适配属性。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/26",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/274",
      "bindingId": "66d9c6c0-4e07-4c79-9fcb-ebff831d2763:fit.roll_diameter"
    },
    "condition": {
      "fact": "accessoryLimitsRollDiameter",
      "equals": true
    }
  },
  {
    "categoryId": "66d9c6c0-4e07-4c79-9fcb-ebff831d2763",
    "categoryName": "卷纸配件",
    "attributeId": "fit.roll_width",
    "mode": "conditional",
    "auditedApplicability": "当前SKU经用途、形态及相邻边界确认属于本类；不得仅以现挂类目作为证据；零件直接限制纸幅或卷宽，例如轴/替换支架；锁钥等不适用",
    "applicability": "功能直接限制纸幅或纸卷宽度的零件；零件自身宽度不能代替额定适配卷宽。",
    "evidenceRequirement": "真实零件功能/服务纸型分支。零件自身外尺寸不能当额定适配纸品尺寸；OEM一对一替换映射用于接口采购路径，不自动否定这些可展示的物理适配属性。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/27",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/275",
      "bindingId": "66d9c6c0-4e07-4c79-9fcb-ebff831d2763:fit.roll_width"
    },
    "condition": {
      "fact": "accessoryLimitsRollWidth",
      "equals": true
    }
  },
  {
    "categoryId": "817bd803-59b6-42df-993f-8f4f26851988",
    "categoryName": "擦手纸配件",
    "attributeId": "accessory.compatibility",
    "mode": "core",
    "auditedApplicability": "当前SKU经用途、形态及相邻边界确认属于本类；不得仅以现挂类目作为证据；专机替换件，或明确通用件需保存其通用范围；归属/通用状态未明则条件待判",
    "applicability": "独立核心：保存专机适用型号或明确通用范围。缺型号、通用状态或范围仍须待补；不得以未声明适配信息排除分母。",
    "evidenceRequirement": "SKU已通过类目准入后，本核心始终适用。适用型号或明确通用范围必须来自当前SKU证据；未明不降低核心要求。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/28",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/282",
      "bindingId": "817bd803-59b6-42df-993f-8f4f26851988:accessory.compatibility"
    }
  },
  {
    "categoryId": "817bd803-59b6-42df-993f-8f4f26851988",
    "categoryName": "擦手纸配件",
    "attributeId": "accessory.install",
    "mode": "conditional",
    "auditedApplicability": "当前SKU经用途、形态及相邻边界确认属于本类；不得仅以现挂类目作为证据；该零件确需安装到设备/固定位置；钥匙等不适用",
    "applicability": "实际使用需安装/固定到设备或固定位置的零件；电气件也可需安装，不能按几何接口事实代替。",
    "evidenceRequirement": "真实零件功能/服务纸型分支。零件自身外尺寸不能当额定适配纸品尺寸；OEM一对一替换映射用于接口采购路径，不自动否定这些可展示的物理适配属性。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/29",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/285",
      "bindingId": "817bd803-59b6-42df-993f-8f4f26851988:accessory.install"
    },
    "condition": {
      "fact": "accessoryRequiresInstallation",
      "equals": true
    }
  },
  {
    "categoryId": "817bd803-59b6-42df-993f-8f4f26851988",
    "categoryName": "擦手纸配件",
    "attributeId": "fit.fold",
    "mode": "conditional",
    "auditedApplicability": "当前SKU经用途、形态及相邻边界确认属于本类；不得仅以现挂类目作为证据；明确服务折叠擦手纸且零件直接限制纸路/出纸结构；锁钥等不适用",
    "applicability": "明确服务折叠擦手纸且直接约束折型/出纸结构的零件。",
    "evidenceRequirement": "真实零件功能/服务纸型分支。零件自身外尺寸不能当额定适配纸品尺寸；OEM一对一替换映射用于接口采购路径，不自动否定这些可展示的物理适配属性。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/30",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/287",
      "bindingId": "817bd803-59b6-42df-993f-8f4f26851988:fit.fold"
    },
    "condition": {
      "all": [
        {
          "fact": "accessoryServesFoldedHandTowels",
          "equals": true
        },
        {
          "fact": "accessoryConstrainsFoldGeometry",
          "equals": true
        }
      ]
    }
  },
  {
    "categoryId": "817bd803-59b6-42df-993f-8f4f26851988",
    "categoryName": "擦手纸配件",
    "attributeId": "fit.paper_size",
    "mode": "conditional",
    "auditedApplicability": "当前SKU经用途、形态及相邻边界确认属于本类；不得仅以现挂类目作为证据；明确服务折叠擦手纸且零件直接限制纸路尺寸；锁钥等不适用",
    "applicability": "明确服务折叠擦手纸且直接限制纸路或纸张尺寸的零件。",
    "evidenceRequirement": "真实零件功能/服务纸型分支。零件自身外尺寸不能当额定适配纸品尺寸；OEM一对一替换映射用于接口采购路径，不自动否定这些可展示的物理适配属性。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/31",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/288",
      "bindingId": "817bd803-59b6-42df-993f-8f4f26851988:fit.paper_size"
    },
    "condition": {
      "all": [
        {
          "fact": "accessoryServesFoldedHandTowels",
          "equals": true
        },
        {
          "fact": "accessoryConstrainsSheetPathSize",
          "equals": true
        }
      ]
    }
  },
  {
    "categoryId": "817bd803-59b6-42df-993f-8f4f26851988",
    "categoryName": "擦手纸配件",
    "attributeId": "fit.roll_diameter",
    "mode": "conditional",
    "auditedApplicability": "当前SKU经用途、形态及相邻边界确认属于本类；不得仅以现挂类目作为证据；零件直接限制纸卷容纳空间，例如轴/替换支架；锁钥等不适用",
    "applicability": "功能直接限制纸卷容纳外径的零件；锁钥/纯控制电路等不属于该限位对象。",
    "evidenceRequirement": "真实零件功能/服务纸型分支。零件自身外尺寸不能当额定适配纸品尺寸；OEM一对一替换映射用于接口采购路径，不自动否定这些可展示的物理适配属性。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/32",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/289",
      "bindingId": "817bd803-59b6-42df-993f-8f4f26851988:fit.roll_diameter"
    },
    "condition": {
      "fact": "accessoryLimitsRollDiameter",
      "equals": true
    }
  },
  {
    "categoryId": "817bd803-59b6-42df-993f-8f4f26851988",
    "categoryName": "擦手纸配件",
    "attributeId": "fit.roll_width",
    "mode": "conditional",
    "auditedApplicability": "当前SKU经用途、形态及相邻边界确认属于本类；不得仅以现挂类目作为证据；零件直接限制纸幅或卷宽，例如轴/替换支架；锁钥等不适用",
    "applicability": "功能直接限制纸幅或纸卷宽度的零件；零件自身宽度不能代替额定适配卷宽。",
    "evidenceRequirement": "真实零件功能/服务纸型分支。零件自身外尺寸不能当额定适配纸品尺寸；OEM一对一替换映射用于接口采购路径，不自动否定这些可展示的物理适配属性。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/33",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/290",
      "bindingId": "817bd803-59b6-42df-993f-8f4f26851988:fit.roll_width"
    },
    "condition": {
      "fact": "accessoryLimitsRollWidth",
      "equals": true
    }
  },
  {
    "categoryId": "fd7a6576-b4bb-4ef0-a273-9de18cf571a2",
    "categoryName": "软包抽纸",
    "attributeId": "paper.print",
    "mode": "evidence",
    "auditedApplicability": "确认软包干面巾纸，且纸本体有明确印花证据",
    "applicability": "无额外适用性条件。填写要求：纸本体明确印花或明确无印花均可记录；包装图案、压纹或未声明不代替布尔证据。",
    "evidenceRequirement": "是否印花是可取true/false的布尔属性，正面印花和明确无印花都可填。文本“有明示印花证据”应改为有明确肯定或否定证据；未说明待补，不因未写印花判不适用。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/34",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/291",
      "bindingId": "fd7a6576-b4bb-4ef0-a273-9de18cf571a2:paper.print"
    }
  },
  {
    "categoryId": "511563d5-477d-4730-852e-58f9805dc522",
    "categoryName": "无芯小卷纸",
    "attributeId": "roll.dispense",
    "mode": "evidence",
    "auditedApplicability": "确认本类当前SKU；只录该属性明确证据",
    "applicability": "无额外适用性条件。填写参数须有当前SKU同对象、同层级的明确证据；未说明留needs_evidence，不判不适用。",
    "evidenceRequirement": "属于填值证据/对象层级要求，不是SKU适用性门槛；有明示值才填，未说明留needs_evidence，不判not_applicable。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/35",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/293",
      "bindingId": "511563d5-477d-4730-852e-58f9805dc522:roll.dispense"
    }
  },
  {
    "categoryId": "511563d5-477d-4730-852e-58f9805dc522",
    "categoryName": "无芯小卷纸",
    "attributeId": "paper.use",
    "mode": "evidence",
    "auditedApplicability": "确认本类当前SKU；只录该属性明确证据",
    "applicability": "无额外适用性条件。填写要求：当前SKU主要用途须明示；未声明保留缺项，不默认推定用途或判不适用。",
    "evidenceRequirement": "用途字段适用与是否已声明用途分开；未声明留缺项，不设置hasDeclaredUse条件，也不默认推餐巾/厕用。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/36",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/294",
      "bindingId": "511563d5-477d-4730-852e-58f9805dc522:paper.use"
    }
  },
  {
    "categoryId": "511563d5-477d-4730-852e-58f9805dc522",
    "categoryName": "无芯小卷纸",
    "attributeId": "roll.width",
    "mode": "evidence",
    "auditedApplicability": "确认本类当前SKU；只录该属性明确证据",
    "applicability": "无额外适用性条件。填写参数须有当前SKU同对象、同层级的明确证据；未说明留needs_evidence，不判不适用。",
    "evidenceRequirement": "属于填值证据/对象层级要求，不是SKU适用性门槛；有明示值才填，未说明留needs_evidence，不判not_applicable。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/37",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/295",
      "bindingId": "511563d5-477d-4730-852e-58f9805dc522:roll.width"
    }
  },
  {
    "categoryId": "511563d5-477d-4730-852e-58f9805dc522",
    "categoryName": "无芯小卷纸",
    "attributeId": "paper.print",
    "mode": "evidence",
    "auditedApplicability": "确认本类当前SKU；只录该属性明确证据",
    "applicability": "无额外适用性条件。填写要求：纸本体明确印花或明确无印花均可记录；包装图案、压纹或未声明不代替布尔证据。",
    "evidenceRequirement": "是否印花是可取true/false的布尔属性，正面印花和明确无印花都可填。文本“有明示印花证据”应改为有明确肯定或否定证据；未说明待补，不因未写印花判不适用。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/38",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/296",
      "bindingId": "511563d5-477d-4730-852e-58f9805dc522:paper.print"
    }
  },
  {
    "categoryId": "eb42a48e-c62b-4f2c-87ea-ca27021c31b6",
    "categoryName": "餐巾纸",
    "attributeId": "paper.use",
    "mode": "evidence",
    "auditedApplicability": "确认本类当前SKU且有明示用途",
    "applicability": "无额外适用性条件。填写要求：当前SKU主要用途须明示；未声明保留缺项，不默认推定用途或判不适用。",
    "evidenceRequirement": "用途字段适用与是否已声明用途分开；未声明留缺项，不设置hasDeclaredUse条件，也不默认推餐巾/厕用。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/39",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/297",
      "bindingId": "eb42a48e-c62b-4f2c-87ea-ca27021c31b6:paper.use"
    }
  },
  {
    "categoryId": "6ca63ad6-33b6-40a2-bf85-a5719a6dd32a",
    "categoryName": "大卷纸",
    "attributeId": "paper.print",
    "mode": "evidence",
    "auditedApplicability": "确认本类当前SKU且有明示纸本体印花证据",
    "applicability": "无额外适用性条件。填写要求：纸本体明确印花或明确无印花均可记录；包装图案、压纹或未声明不代替布尔证据。",
    "evidenceRequirement": "是否印花是可取true/false的布尔属性，正面印花和明确无印花都可填。文本“有明示印花证据”应改为有明确肯定或否定证据；未说明待补，不因未写印花判不适用。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/40",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/301",
      "bindingId": "6ca63ad6-33b6-40a2-bf85-a5719a6dd32a:paper.print"
    }
  },
  {
    "categoryId": "6ca63ad6-33b6-40a2-bf85-a5719a6dd32a",
    "categoryName": "大卷纸",
    "attributeId": "roll.sales_count",
    "mode": "evidence",
    "auditedApplicability": "当前SKU同规格主体总卷数及层级明确",
    "applicability": "无额外适用性条件。填写要求：当前销售主体总卷数、同规格及包装层级须明确；未声明卷数不作为不适用。",
    "evidenceRequirement": "总卷数/同规格/主体层级明确是填值的证据连贯性条件；卷数没写或夹赠品待核都应缺项，不建hasDeclaredRollCount门槛。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/41",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/302",
      "bindingId": "6ca63ad6-33b6-40a2-bf85-a5719a6dd32a:roll.sales_count"
    }
  },
  {
    "categoryId": "25f165b5-7ada-48c1-9c1e-337c6e0b11a2",
    "categoryName": "大卷擦手纸",
    "attributeId": "roll.sales_count",
    "mode": "evidence",
    "auditedApplicability": "当前SKU同规格主体总卷数及层级明确",
    "applicability": "无额外适用性条件。填写要求：当前销售主体总卷数、同规格及包装层级须明确；未声明卷数不作为不适用。",
    "evidenceRequirement": "总卷数/同规格/主体层级明确是填值的证据连贯性条件；卷数没写或夹赠品待核都应缺项，不建hasDeclaredRollCount门槛。",
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/items/42",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6",
      "auditedDraftPointer": "#/bindings/303",
      "bindingId": "25f165b5-7ada-48c1-9c1e-337c6e0b11a2:roll.sales_count"
    }
  }
];
const FACT_PATCHES: readonly FactPatch[] = [
  {
    "definition": {
      "fact": "accessoryConstrainsFoldGeometry",
      "definition": "当前零件直接约束折叠擦手纸的折型兼容或出纸结构。",
      "trueEvidence": "明确折型导向/分纸/出纸结构限位或厂家声明可配Z/N/C等折型。",
      "falseEvidence": "明确锁钥、电路等不参与纸路结构，或安装件功能明确与折型无关。",
      "notEvidence": "没给折型、只写三折/通用但未明几何不能判false；孔距不等于折型。",
      "scope": "当前所选SKU；每个真/假须当前SKU证据ID及精确quote。",
      "evidenceRequired": true,
      "unknownPolicy": "缺证据、冲突或对象/层级未明均unknown；禁止按多数/类别默认或未声明置false。可选属性unknown保留槽与未知统计，不凭空升为核心；核心unknown阻断达标。"
    },
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/proposedFactDefinitions/accessoryConstrainsFoldGeometry",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6"
    }
  },
  {
    "definition": {
      "fact": "accessoryConstrainsSheetPathSize",
      "definition": "当前零件直接约束折叠擦手纸的纸路/纸张适配尺寸。",
      "trueEvidence": "明确导纸/仓体/出纸口对纸张展开或折后长宽的限制，并区分尺寸对象。",
      "falseEvidence": "明确钥匙/电气控制件等不限定纸路尺寸，或零件功能明确只固定外壳而不限制纸张。",
      "notEvidence": "零件外形尺寸、没有适配纸张值或OEM准确映射不能自动证明此事实为false。",
      "scope": "当前所选SKU；每个真/假须当前SKU证据ID及精确quote。",
      "evidenceRequired": true,
      "unknownPolicy": "缺证据、冲突或对象/层级未明均unknown；禁止按多数/类别默认或未声明置false。可选属性unknown保留槽与未知统计，不凭空升为核心；核心unknown阻断达标。"
    },
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/proposedFactDefinitions/accessoryConstrainsSheetPathSize",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6"
    }
  },
  {
    "definition": {
      "fact": "accessoryLimitsRollDiameter",
      "definition": "当前零件的功能直接限定所服务纸卷容纳外径空间。",
      "trueEvidence": "纸卷轴/承托支架/仓体限位件明确限制可容纳纸卷外径，或厂商明确最大卷径适配对象。",
      "falseEvidence": "明确钥匙/纯电气控制件等完全不限定纸卷容纳空间，或明确仅服务非卷纸且无此功能。",
      "notEvidence": "零件自身直径/外长宽高不是适配纸卷外径；准确OEM映射不自动让可展示的物理限位尺寸变不适用。",
      "scope": "当前所选SKU；每个真/假须当前SKU证据ID及精确quote。",
      "evidenceRequired": true,
      "unknownPolicy": "缺证据、冲突或对象/层级未明均unknown；禁止按多数/类别默认或未声明置false。可选属性unknown保留槽与未知统计，不凭空升为核心；核心unknown阻断达标。"
    },
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/proposedFactDefinitions/accessoryLimitsRollDiameter",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6"
    }
  },
  {
    "definition": {
      "fact": "accessoryLimitsRollWidth",
      "definition": "当前零件功能直接限定所服务纸卷宽度/纸幅空间。",
      "trueEvidence": "纸轴/托架/导向或仓体限位明确针对纸卷宽度，或厂家声明额定适配卷宽。",
      "falseEvidence": "明确锁钥/纯电气控制件等不限制卷宽，或明确仅服务非卷纸且无卷宽功能。",
      "notEvidence": "零件自身宽度、通用字样、未给适配宽度不能作为false；OEM映射不是此物理属性的否证。",
      "scope": "当前所选SKU；每个真/假须当前SKU证据ID及精确quote。",
      "evidenceRequired": true,
      "unknownPolicy": "缺证据、冲突或对象/层级未明均unknown；禁止按多数/类别默认或未声明置false。可选属性unknown保留槽与未知统计，不凭空升为核心；核心unknown阻断达标。"
    },
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/proposedFactDefinitions/accessoryLimitsRollWidth",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6"
    }
  },
  {
    "definition": {
      "fact": "accessoryRequiresInstallation",
      "definition": "零件在实际使用时需安装/固定/插装到设备或固定位置，包含需要安装的电气件；不同于是否需独立几何匹配。",
      "trueEvidence": "安装孔/固定/插接/替换装配功能明确；电气组件有明确装配到设备要求亦可真。",
      "falseEvidence": "明确仅手持使用的锁钥/工具等，不需装配到设备或固定位置。",
      "notEvidence": "只写配件/电气件/通用、没给安装方式不能判false；不能以requiresGeometricInterfaceFit=false代替此事实。",
      "scope": "当前所选SKU；每个真/假须当前SKU证据ID及精确quote。",
      "evidenceRequired": true,
      "unknownPolicy": "缺证据、冲突或对象/层级未明均unknown；禁止按多数/类别默认或未声明置false。可选属性unknown保留槽与未知统计，不凭空升为核心；核心unknown阻断达标。"
    },
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/proposedFactDefinitions/accessoryRequiresInstallation",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6"
    }
  },
  {
    "definition": {
      "fact": "accessoryServesFoldedHandTowels",
      "definition": "当前零件明确服务折叠成张擦手纸；擦手纸配件类本身也可能服务卷纸，不能从类目推真。",
      "trueEvidence": "厂家服务纸型明确折叠擦手纸/成张擦手纸及其适配设备或折型。",
      "falseEvidence": "明确仅服务卷式擦手纸/其他纸型且不服务折叠成张纸。",
      "notEvidence": "只写擦手纸配件、抽取动作或未写纸型不是false。",
      "scope": "当前所选SKU；每个真/假须当前SKU证据ID及精确quote。",
      "evidenceRequired": true,
      "unknownPolicy": "缺证据、冲突或对象/层级未明均unknown；禁止按多数/类别默认或未声明置false。可选属性unknown保留槽与未知统计，不凭空升为核心；核心unknown阻断达标。"
    },
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/proposedFactDefinitions/accessoryServesFoldedHandTowels",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6"
    }
  },
  {
    "definition": {
      "fact": "containerSupportsFoldedHandTowels",
      "definition": "当前容器支持折叠成张擦手纸；与卷式擦手纸独立，可多纸型并存。",
      "trueEvidence": "明确适配折叠擦手纸、Z/N/C/V等已核折型，或厂家说明适配的成张擦手纸结构。",
      "falseEvidence": "明确不适配折叠擦手纸，或完整排他适配范围仅卷纸且无成张纸路。",
      "notEvidence": "擦手纸盒/抽取式字样、未给折型、未给容量均不能作为反证。",
      "scope": "当前所选SKU；每个真/假须当前SKU证据ID及精确quote。",
      "evidenceRequired": true,
      "unknownPolicy": "缺证据、冲突或对象/层级未明均unknown；禁止按多数/类别默认或未声明置false。可选属性unknown保留槽与未知统计，不凭空升为核心；核心unknown阻断达标。"
    },
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/proposedFactDefinitions/containerSupportsFoldedHandTowels",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6"
    }
  },
  {
    "definition": {
      "fact": "containerSupportsRollPaper",
      "definition": "当前完整纸巾容器确实支持卷式纸品，允许同时兼容其他纸型；不是容器自己或外包装是否成卷。",
      "trueEvidence": "厂家适用纸型明示卷纸/卷筒纸/大小卷纸，或独立核实该SKU容纳及出卷纸的结构和纸型。",
      "falseEvidence": "明示不适配卷纸，或完整且排他的适配范围明确仅平叠单张/折叠纸且非卷纸。",
      "notEvidence": "纸巾盒名称、圆柱外形、中心孔或只没写卷纸不能判真/假。",
      "scope": "当前所选SKU；每个真/假须当前SKU证据ID及精确quote。",
      "evidenceRequired": true,
      "unknownPolicy": "缺证据、冲突或对象/层级未明均unknown；禁止按多数/类别默认或未声明置false。可选属性unknown保留槽与未知统计，不凭空升为核心；核心unknown阻断达标。"
    },
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/proposedFactDefinitions/containerSupportsRollPaper",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6"
    }
  },
  {
    "definition": {
      "fact": "containerSupportsSheetPaper",
      "definition": "当前容器支持可展开计量的抽取式成张纸品；不把抽取动作误当纸本体必为平叠。",
      "trueEvidence": "明确适配面巾抽纸/独立成张纸、可定义纸张展开/折后规格的适配说明。",
      "falseEvidence": "明确仅适配连续卷式纸品且无成张纸规格适配，或明示不适配抽取成张纸。",
      "notEvidence": "只有抽取式动作、盒子长宽高、盒装字样不能反证卷式或证明成张适配。",
      "scope": "当前所选SKU；每个真/假须当前SKU证据ID及精确quote。",
      "evidenceRequired": true,
      "unknownPolicy": "缺证据、冲突或对象/层级未明均unknown；禁止按多数/类别默认或未声明置false。可选属性unknown保留槽与未知统计，不凭空升为核心；核心unknown阻断达标。"
    },
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/proposedFactDefinitions/containerSupportsSheetPaper",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6"
    }
  },
  {
    "definition": {
      "fact": "isDisposablePillowFacePad",
      "definition": "当前SKU为适用开孔形状维度的一次性枕垫/枕脸巾分支，形状可有孔或明确无孔；不是是否已声明孔形。",
      "trueEvidence": "明确一次性美容/按摩枕垫、枕脸巾或对应一次性枕垫形态，并核实当前对象。",
      "falseEvidence": "明确常规纺织平铺枕巾分支；这是真正对象分支排除，不是因为图片没看见孔。",
      "notEvidence": "单写枕巾/一次性、没写开孔、未看清孔均不能作为false。",
      "scope": "当前所选SKU；每个真/假须当前SKU证据ID及精确quote。",
      "evidenceRequired": true,
      "unknownPolicy": "缺证据、冲突或对象/层级未明均unknown；禁止按多数/类别默认或未声明置false。可选属性unknown保留槽与未知统计，不凭空升为核心；核心unknown阻断达标。"
    },
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/proposedFactDefinitions/isDisposablePillowFacePad",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6"
    }
  },
  {
    "definition": {
      "fact": "seatHasSingleSheetFoldObject",
      "definition": "当前坐垫商品具有可定义成品单片折叠方式的平片/单片结构；运输收纳折叠另论。",
      "trueEvidence": "明确单片平铺垫纸；或套入式商品仍明确单片可展开成品及其折叠结构。",
      "falseEvidence": "明确成型罩套结构，且只有装配/运输折叠、不存在可定义的成品单片折型。",
      "notEvidence": "没写折法、没给折数、来源无值不等于没有可定义单片对象。",
      "scope": "当前所选SKU；每个真/假须当前SKU证据ID及精确quote。",
      "evidenceRequired": true,
      "unknownPolicy": "缺证据、冲突或对象/层级未明均unknown；禁止按多数/类别默认或未声明置false。可选属性unknown保留槽与未知统计，不凭空升为核心；核心unknown阻断达标。"
    },
    "source": {
      "triageFile": "outputs/product-governance/clean-paper-21-revision-20261019/analysis/missing-conditions-triage.json",
      "triagePointer": "#/proposedFactDefinitions/seatHasSingleSheetFoldObject",
      "auditedDraftSha256": "7fe40676126c008966e5c2750c82008f66079a84d70df966d1ed831dc62e2ce6"
    }
  }
];

const equal = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => equal(value, right[index]));
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
};

function assertNoGroupMembership(s: ConditionRevisionStandard, binding: RevisionBinding): void {
  const groups = (s.requirementGroups ?? []).filter(group => group.categoryId === binding.categoryId && (group.paths?.some(path => path.attributes.includes(binding.attributeId)) || group.atLeastOne?.some(path => path.includes(binding.attributeId))));
  if (groups.length) throw new Error(`Independent core ${binding.categoryId}:${binding.attributeId} is referenced by requirement group ${groups.map(group => group.id).join(', ')}; merge that policy explicitly.`);
}

/** Returns a detached revision and its source-linked change ledger; the supplied draft is untouched. */
export function applyConditionRevisions<T extends ConditionRevisionStandard>(input: T): { s: T; appliedChanges: AppliedConditionChange[] } {
  const s = structuredClone(input);
  const appliedChanges: AppliedConditionChange[] = [];
  const categoryIds = new Set(s.categories.map(category => category.id));
  if (categoryIds.size !== s.categories.length) throw new Error('Duplicate category IDs in condition revision input.');
  const bindingKeys = s.bindings.map(binding => `${binding.categoryId}:${binding.attributeId}`);
  if (new Set(bindingKeys).size !== bindingKeys.length) throw new Error('Duplicate binding IDs in condition revision input.');
  const facts = s.conditionFactDefinitions ?? (s.conditionFactDefinitions = []);
  if (new Set(facts.map(definition => definition.fact)).size !== facts.length) throw new Error('Duplicate condition fact names in revision input.');

  for (const patch of FACT_PATCHES) {
    const index = facts.findIndex(definition => definition.fact === patch.definition.fact);
    if (index < 0) {
      const after = structuredClone(patch.definition);
      facts.push(after);
      appliedChanges.push({ kind: 'condition_fact_added', fact: after.fact, inputPointer: `#/conditionFactDefinitions/${facts.length - 1}`, reason: 'Register the reviewed physical compatibility/subtype fact with positive, negative, and unknown evidence rules.', source: structuredClone(patch.source), before: null, after: structuredClone(after) });
      continue;
    }
    const existing = facts[index]!;
    const before = structuredClone(existing);
    for (const [key, value] of Object.entries(patch.definition)) {
      if (Object.hasOwn(existing, key) && !equal(existing[key], value)) throw new Error(`Condition fact ${existing.fact}.${key} differs from the reviewed proposal; preserve and adjudicate that concurrent change.`);
      if (!Object.hasOwn(existing, key)) existing[key] = structuredClone(value);
    }
    if (!equal(before, existing)) appliedChanges.push({ kind: 'condition_fact_completed', fact: existing.fact, inputPointer: `#/conditionFactDefinitions/${index}`, reason: 'Complete missing fact documentation without replacing existing semantic or unrelated metadata.', source: structuredClone(patch.source), before, after: structuredClone(existing) });
  }

  for (const patch of BINDING_PATCHES) {
    const category = s.categories.find(candidate => candidate.id === patch.categoryId);
    if (!category || category.name !== patch.categoryName) throw new Error(`Missing or renamed reviewed category ${patch.categoryId} (${patch.categoryName}).`);
    const index = s.bindings.findIndex(binding => binding.categoryId === patch.categoryId && binding.attributeId === patch.attributeId);
    if (index < 0) throw new Error(`Missing reviewed binding ${patch.categoryId}:${patch.attributeId}.`);
    const binding = s.bindings[index]!;
    const before = structuredClone(binding);
    if (binding.applicability !== patch.auditedApplicability && binding.applicability !== patch.applicability) throw new Error(`Reviewed binding ${patch.categoryId}:${patch.attributeId} has concurrently edited applicability text; preserve and adjudicate that change.`);
    if (patch.mode === 'core') {
      assertNoGroupMembership(s, binding);
      binding.required = true;
      binding.requirednessMode = 'independent';
      delete binding.requirementGroupId;
      delete binding.applicabilityCondition;
      delete binding.applicabilityRule;
    } else {
      if (binding.applicabilityRule !== undefined) throw new Error(`Reviewed binding ${patch.categoryId}:${patch.attributeId} has a concurrent legacy applicabilityRule; merge explicitly.`);
      if (binding.applicabilityCondition !== undefined && !equal(binding.applicabilityCondition, patch.condition)) throw new Error(`Reviewed binding ${patch.categoryId}:${patch.attributeId} has a different canonical condition; preserve and adjudicate that concurrent change.`);
      if (patch.mode === 'conditional') binding.applicabilityCondition = structuredClone(patch.condition!);
    }
    binding.applicability = patch.applicability;
    if (binding.evidenceRequirements !== undefined && (!Array.isArray(binding.evidenceRequirements) || binding.evidenceRequirements.some(value => typeof value !== 'string'))) throw new Error(`Binding ${patch.categoryId}:${patch.attributeId} evidenceRequirements has an incompatible existing shape.`);
    const requirements = binding.evidenceRequirements ?? (binding.evidenceRequirements = []);
    if (!requirements.includes(patch.evidenceRequirement)) requirements.push(patch.evidenceRequirement);
    if (!equal(before, binding)) appliedChanges.push({ kind: patch.mode === 'conditional' ? 'binding_condition_revision' : patch.mode === 'core' ? 'binding_core_scope_revision' : 'binding_evidence_scope_revision', categoryId: patch.categoryId, categoryName: patch.categoryName, attributeId: patch.attributeId, inputPointer: `#/bindings/${index}`, reason: patch.evidenceRequirement, source: structuredClone(patch.source), before, after: structuredClone(binding) });
  }
  return { s, appliedChanges };
}
