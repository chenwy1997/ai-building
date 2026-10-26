import { hash, Blocked, type AttributeDefinition, type Snapshot, type Finding, type AttributeBinding } from "./core.ts";
import nativeQuantity from "./knowledge/native-quantity-carrier-20261026.json";

export const DEFINITION_FIELDS = ["name", "conceptKey", "definition", "scope", "fieldType", "unit", "enumValues", "multi", "valueLevel", "numberConfig", "textConfig", "optionConfig", "defaultValue"] as const;
export function definitionFingerprint(a: AttributeDefinition) {
  return hash(Object.fromEntries(DEFINITION_FIELDS.map(k => [k, a[k]])));
}
export function usableDefinitions(data: Snapshot, runId: string) {
  return [...data.attributes, ...data.families.filter(f => f.status === "confirmed" || (f.status === "candidate" && f.runId === runId)).flatMap(f => f.attributes)];
}
// Never let search order select a winner for an ambiguous identity.
export function uniqueDefinitions(items: AttributeDefinition[]) {
  const byId = new Map<string, AttributeDefinition>();
  for (const a of items) {
    const previous = byId.get(a.id);
    if (previous && definitionFingerprint(previous) !== definitionFingerprint(a))
      throw new Blocked("attribute_pool_conflict", `attribute ID ${a.id} has conflicting shared definitions; revise the registry before reuse`);
    if (!previous) byId.set(a.id, a);
  }
  return [...byId.values()];
}
export function sharedDefinitionErrors(attributes: AttributeDefinition[], data: Snapshot, runId: string): Finding[] {
  const pool = usableDefinitions(data, runId), errors: Finding[] = [];
  for (const a of attributes) {
    const existing = pool.filter(p => p.id === a.id);
    if (existing.some(p => definitionFingerprint(p) !== definitionFingerprint(a)))
      errors.push({ ruleId: "R03", objectId: a.id, message: "existing shared ID changes its definition/configuration outside the applicable family; propose a shared revision separately" });
  }
  return errors;
}

export interface ModelingDecision {
  objectId: string;
  disposition: "admitted" | "extension" | "system_owned" | "not_needed";
  businessNeed: "confirmed" | "pending" | "not_needed";
  admissionBasis: "business_need" | "sample_availability";
  businessReason: string;
  requiredNecessity: "confirmed" | "pending" | "optional";
  requirednessBasis: "business_need" | "sample_availability";
  professionalReadiness: "defined" | "pending";
  professionalReason: string;
  valueEvidence: "available" | "missing" | "unassessed";
  quantity: null | {
    measure: "contents_per_package" | "sales_unit_count" | "other_count";
    countedObject: string;
    denominator: "package" | "sales_unit" | "other";
    countTerms: string[];
    systemFieldKeys: string[];
    relation: "same" | "distinct" | "conditional" | "unresolved";
    sameWhen: string | null;
    differentWhen: string | null;
    overlapAction: "reuse_system_field" | "not_applicable";
    reason: string;
  };
}

// Host-owned semantic responsibility, always supplied in context. Values are not SKU evidence.
export const QUANTITY_RESPONSIBILITY = {
  version: "quantity-responsibility-2",
  nativeOwnerKey: "unitMin",
  nativeFields: { unitMin: "最小计量单位", unitMinQua: "一个销售单位包含的最小计量单位数量", saleUnit: "销售单位默认属性键；salesUnit只是治理职责别名" },
  nativeCarrier: nativeQuantity.mapping,
  relation: "unitMinQua × unitMin / saleUnit（均须按CategoryKeyConfig解析实际键）",
  businessAdmission: "按业务必要性决定，不要求已挂商品有值；职责映射按计数对象、分母和计数词比较。",
  packageCount: "包内数量不能一概视为基础字段或一概认为独立。销售单位与最小单位可变时用conditional，重合时reuse_system_field，避免二次填写。",
  examples: [
    { saleUnit: "提", unitMin: "包", unitMinQua: 6, proposal: "200张/包", overlap: false },
    { saleUnit: "包", unitMin: "张", unitMinQua: 200, proposal: "200张/包", overlap: true },
  ],
  countTerms: "抽、张、片、节、格不默认等价；一包、一盒、一个销售单位、一个物流箱不能默认等价。",
  unresolved: "职责关系尚不能描述时放扩展候选，并记录需要核实的关系；不得用商品样本缺值代替业务准入判断。",
  executionBoundary: "这是建模与填写来源计划。实际SKU原生单位组合尚未读取/核实时不能执行条件映射或生成重复值。",
} as const;

export function needsQuantityMapping(item: { name: string; conceptKey: string }) {
  return /每(?:包|盒|卷|提|箱).*(?:数量|张数|抽数|片数|节数|格数|卷数)|销售总(?:数量|卷数)|(?:包装|内装).*数量/.test(item.name) || /(?:package|pack)[._-]?(?:count|quantity)|contents_per_package|inner[._-]?(?:count|quantity)|total_rolls/.test(item.conceptKey);
}

// Deliberately narrow: these are explicit gate statements observed in real runs,
// not an attempt to certify arbitrary natural-language reasoning.
export function activationGateConflicts(criteria: string) {
  return criteria.split(/[。；;\n]/).filter(clause => {
    if (/(?:不|不能|不应|不得)(?:作为|成为|要求|依赖|以)|与.{0,12}无关/.test(clause)) return false;
    return /(?:确认|核实|明确).{0,12}(?:必填必要性|是否必填)|必填必要性.{0,12}(?:确认|核实)/.test(clause) ||
      /(?:包装标注|商品资料|SKU资料|样本|数据|取值).{0,14}(?:可稳定取得|稳定可得|齐全后|完整后)|(?:稳定取得|稳定获取).{0,12}(?:数据|取值|标注)/.test(clause);
  });
}

export function modelingDecisionErrors(value: { attributes: AttributeDefinition[]; bindings: AttributeBinding[]; extensionCandidates: {id: string; name: string; conceptKey: string; activationCriteria?: string}[]; decisions: ModelingDecision[]; unresolved?: string[] }, data: Snapshot): Finding[] {
  const errors: Finding[] = [], add = (ruleId: string, objectId: string, message: string) => errors.push({ruleId, objectId, message});
  const items = [...value.attributes, ...value.extensionCandidates];
  for (const c of value.extensionCandidates) if (activationGateConflicts(c.activationCriteria ?? "").length)
    add("R07", c.id, "extension activation explicitly depends on requiredness confirmation or stable SKU value availability; separate those from business/professional admission");
  // A stated exclusion on native-quantity grounds still needs a decision, not just free-text omission.
  // This is a narrow coverage check for explicit statements; it is not a semantic completeness proof.
  if ((value.unresolved ?? []).some(s => /(?:最小计量单位|unitMin)/.test(s) && /每(?:包|卷|提|箱)/.test(s)) &&
      !value.decisions.some(d => d.quantity !== null))
    add("R01", "quantity-responsibility", "native quantity overlap is discussed but no structured ownership decision was recorded, including excluded candidates");

  const ids = new Set<string>();
  for (const d of value.decisions) {
    if (ids.has(d.objectId)) add("R07", d.objectId, "each modeling object needs exactly one decision");
    ids.add(d.objectId);
    const a = value.attributes.find(a => a.id === d.objectId), c = value.extensionCandidates.find(c => c.id === d.objectId), b = value.bindings.find(b => b.attributeId === d.objectId);
    if ((a && d.disposition !== "admitted") || (c && d.disposition !== "extension") || (!a && !c && ["admitted", "extension"].includes(d.disposition)))
      add("R07", d.objectId, "decision disposition disagrees with the attribute/extension lists");
    if (d.admissionBasis !== "business_need" || d.requirednessBasis !== "business_need")
      add("R07", d.objectId, "sample availability is not a basis for business admission or requiredness; record it only in valueEvidence");
    if (a && (d.businessNeed !== "confirmed" || d.professionalReadiness !== "defined"))
      add("R07", d.objectId, "admitted definition requires an explicit business use and defined professional meaning; unresolved candidate stays an extension");
    if (b?.requiredness === "required" && d.requiredNecessity !== "confirmed")
      add("R02", d.objectId, "required contradicts pending/optional business necessity; unknown necessity must be optional");
    if (b?.requiredness === "required" && a && (value.unresolved ?? []).flatMap(s => s.split(/[。；\n]/)).some(sentence =>
        sentence.includes(a.name) && /必填(?:必要性|需求)[^。；]{0,15}(?:待业务确认|待确认|未确认|未核实|待核实)/.test(sentence)))
      add("R02", d.objectId, "unresolved explicitly contradicts required necessity for this named attribute; revise the shared decision");
    // Catch explicit contradictions in the binding itself as well as the structured decision.
    // A generic data-availability gap elsewhere is not evidence of a requiredness conflict.
    if (b?.requiredness === "required" && /(?:必填|强制填写)(?:必要性|需求)?[^。；]{0,12}(?:待业务确认|待确认|未确认|未核实|待核实)/.test(b.requirednessReason))
      add("R02", d.objectId, "requirednessReason explicitly leaves required necessity unconfirmed");
    if (d.disposition === "not_needed" && d.businessNeed !== "not_needed")
      add("R07", d.objectId, "not_needed requires an explicit business rejection, not unavailable sample values");
    const q = d.quantity;
    if (!q) continue;
    if (new Set(q.systemFieldKeys).size !== q.systemFieldKeys.length || q.systemFieldKeys.some(key => !data.systemFields.some(f => f.key === key)))
      add("R01", d.objectId, "quantity mapping references unknown/duplicate native owner keys");
    if (!q.systemFieldKeys.includes("unitMin")) add("R01", d.objectId, "quantity mapping must compare the native unitMin responsibility (unitMin + unitMinQua)");
    if (q.measure === "sales_unit_count" && (q.denominator !== "sales_unit" || q.relation !== "same"))
      add("R01", d.objectId, "sales-unit count is already a native responsibility");
    if (q.measure === "contents_per_package" && (q.denominator !== "package" || q.relation === "distinct"))
      add("R01", d.objectId, "package contents cannot assert unconditional independence from variable native sales units; describe conditional overlap");
    if (q.relation === "conditional" && (!q.sameWhen || !q.differentWhen || q.overlapAction !== "reuse_system_field"))
      add("R01", d.objectId, "conditional quantity mapping needs both overlap cases and reuse_system_field");
    if (q.relation === "same" && (d.disposition !== "system_owned" || q.overlapAction !== "reuse_system_field"))
      add("R01", d.objectId, "same quantity belongs to the native field; it must not create another governed value");
    if (a && q.relation === "unresolved") add("R01", d.objectId, "quantity ownership unresolved; keep an explicit extension until the relationship is defined");
    if (d.disposition === "system_owned" && q.relation !== "same")
      add("R01", d.objectId, "system_owned needs an established same-parameter mapping, not a field-name guess");
  }
  for (const item of items) {
    const d = value.decisions.find(d => d.objectId === item.id);
    if (!d) add("R07", item.id, "missing structured business/professional/value-evidence decision");
    else if (needsQuantityMapping(item) && !d.quantity) add("R01", item.id, "package/sales quantity requires a structured native responsibility mapping");
  }
  return errors;
}
