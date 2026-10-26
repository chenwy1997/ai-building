import review from "./knowledge/wash-tissue-core-review-20261026.json";
import inventory from "./scm-field-responsibilities.json";
import compactInventory from "./knowledge/scm-field-responsibilities-compact-20261026.json";
import { Blocked, hash, jsonClone, type AttributeDefinition, type Finding, type Snapshot, type Task } from "./core.ts";
import { definitionFingerprint } from "./modeling-contract.ts";
import { modelingTargets, type AttributeApplicabilityReview } from "./attribute-applicability.ts";

export const PILOT_CORE_REVIEW = review;
export const PILOT_CORE_ID = review.id;
export const NATIVE_QUANTITY_KNOWLEDGE_ID = "native-quantity-carrier-20261026";
export const COMPACT_INVENTORY_ID = "scm-field-responsibilities-compact-20261026";

// Explicit user-authorized offline assessment, not a runtime model approval.
// Exact released records only: a caller cannot manufacture an agent review by
// changing its targets, definition hash, reason or status in an input snapshot.
export function isReleasedOfflineReview(r: AttributeApplicabilityReview) {
  return review.applicabilityReviews.some(approved => hash(approved) === hash(r));
}

export function attachPilotCoreReview(data: Snapshot, selectedIds: string[]) {
  const groups = review.coreGroups.filter(g => g.categoryIds.some(id => selectedIds.includes(id)));
  if (!groups.length) return null;
  const targets = [...new Set(groups.flatMap(g => g.categoryIds))];
  if (hash(inventory) !== hash(compactInventory))
    throw new Blocked("pilot_review_drift", "compact field inventory must preserve every original field and source record");
  for (const source of review.sourceDefinitions.definitions) {
    const known = [...data.attributes, ...data.families.flatMap(f => f.attributes)].filter(a => a.id === source.id);
    if (known.some(a => definitionFingerprint(a) !== definitionFingerprint(source as AttributeDefinition)))
      throw new Blocked("pilot_review_drift", "reviewed source definition changed: " + source.id);
    if (!known.length) data.attributes.push(jsonClone(source) as AttributeDefinition);
  }
  data.attributeApplicability ??= [];
  for (const r of review.applicabilityReviews.filter(r => r.targetCategoryIds.some(id => targets.includes(id)))) {
    const old = data.attributeApplicability.find(old => old.id === r.id);
    if (old && hash(old) !== hash(r)) throw new Blocked("pilot_review_drift", "frozen offline review changed: " + r.id);
    if (data.attributeApplicability.some(old => old.attributeId === r.attributeId &&
      old.targetCategoryIds.some(id => r.targetCategoryIds.includes(id)) && old.status !== r.status))
      throw new Blocked("pilot_review_conflict", "existing target review must be resolved explicitly: " + r.attributeId);
    if (!old) data.attributeApplicability.push(jsonClone(r) as AttributeApplicabilityReview);
  }
  data.knowledgeIds = [...new Set([...data.knowledgeIds, PILOT_CORE_ID, NATIVE_QUANTITY_KNOWLEDGE_ID])];
  const requirement = { id: PILOT_CORE_ID, categoryIds: targets,
    stages: ["family-modeling", "domain-research", "review-assistance"] as const,
    knowledgeIds: [PILOT_CORE_ID, NATIVE_QUANTITY_KNOWLEDGE_ID, COMPACT_INVENTORY_ID,
      ...new Set(review.sourceDefinitions.definitions.flatMap(a => a.references.filter(r => r.kind === "knowledge").map(r => r.id)))],
    reason: "用户确认的有限核心清单与授权离线核实；只覆盖指定三类的待审提案，不是SKU值或生产采用" };
  data.knowledgeRequirements = data.knowledgeRequirements.filter(r => r.id !== PILOT_CORE_ID);
  for (const r of data.knowledgeRequirements) if (r.categoryIds.every(id => targets.includes(id)))
    r.knowledgeIds = r.knowledgeIds.map(id => id === "scm-field-responsibilities-20261022" ? COMPACT_INVENTORY_ID : id);
  data.knowledgeRequirements.push({ ...requirement, stages: [...requirement.stages] });
  data.knowledgeIds = [...new Set([...data.knowledgeIds, ...requirement.knowledgeIds])];
  return { reviewId: PILOT_CORE_ID, reviewHash: hash(review), categoryIds: targets };
}

export function pilotCoreContext(data: Snapshot, task: Task) {
  if (!data.knowledgeIds.includes(PILOT_CORE_ID)) return null;
  const targets = modelingTargets(task, data);
  const groups = review.coreGroups.filter(g => g.categoryIds.some(id => targets.includes(id)));
  if (!groups.length) return null;
  return { reviewId: PILOT_CORE_ID, reviewHash: hash(review), adoption: "pending_human",
    groups, instructions: "本轮按用户已确认的核心清单覆盖，不再次质疑业务准入。逐项使用给出的conceptKey与scope；sharedAttributeId必须原样引用，宿主保留已核实的定义。其余核心是目标对象的新定义提案，不是照搬纸张定义。全部选填；只有这些核心进入attributes，其余保留候选。内装数量为conditional来源计划，不能整类排除为system_owned，也不能默认独立；具体SKU仍待单位组合核实。" };
}

// A finite business acceptance contract for this explicitly approved pilot.
// It does not make this field set mandatory for other categories or past snapshots.
export function pilotCoreErrors(value: any, data: Snapshot, task: Task): Finding[] {
  const context = pilotCoreContext(data, task);
  if (!context) return [];
  const errors: Finding[] = [], add = (id: string, message: string) => errors.push({ ruleId: "R07", objectId: id, message });
  const allowed = context.groups.flatMap(g => g.core);
  for (const core of allowed) {
    const matches = value.attributes.filter((a: AttributeDefinition) => a.conceptKey === core.conceptKey);
    if (matches.length !== 1) { add(core.conceptKey, "confirmed pilot core needs exactly one admitted definition; missing/duplicate core: " + core.name); continue; }
    const a = matches[0], b = value.bindings.find((b: any) => b.attributeId === a.id);
    if (a.fieldType !== core.fieldType || a.scope !== core.scope || (core.sharedAttributeId && a.id !== core.sharedAttributeId))
      add(a.id, "confirmed core object/type/shared identity differs from released review; use coreScope, not a relabeled substitute");
    if (b?.requiredness !== "optional") add(a.id, "this confirmed pilot keeps core attributes optional");
    if (core.name === "内装数量") {
      const q = value.decisions.find((d: any) => d.objectId === a.id)?.quantity;
      if (q?.measure !== "contents_per_package" || q?.relation !== "conditional")
        add(a.id, "inner quantity requires conditional native overlap; category-wide same/distinct/unresolved is not the agreed responsibility plan");
      const terms = context.groups.find(g => g.core.some(c => c.conceptKey === core.conceptKey))!.quantity.countTerms;
      if (q?.countTerms?.some((term: string) => !terms.includes(term)))
        add(a.id, "inner quantity count terms must preserve reviewed content units, not package/roll counts or inferred conversions");
    }
  }
  for (const a of value.attributes) if (!allowed.some(c => c.conceptKey === a.conceptKey))
    add(a.id, "outside confirmed pilot core; preserve as an extension/revision instead of expanding admitted attributes");
  return errors;
}
