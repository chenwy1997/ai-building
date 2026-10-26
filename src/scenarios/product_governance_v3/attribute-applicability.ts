import { Blocked, normalized, type AttributeDefinition, type Finding, type Snapshot, type Task } from "./core.ts";
import { definitionFingerprint } from "./modeling-contract.ts";

// These are frozen input records, never a model output or a tool mutation.
export interface AttributeApplicabilityReview {
  id: string;
  attributeId: string;
  definitionHash: string;
  targetCategoryIds: string[];
  status: "supported" | "pending" | "not_applicable";
  reviewKind: "human" | "fixture";
  reviewRecordId: string;
  reason: string;
}

export function modelingTargets(task: Task, data: Snapshot): string[] {
  const scope = task.candidate as any;
  if (scope?.kind !== "batch_modeling_scope" || scope.modelingMode !== "family_seed") return [task.categoryId];
  const members = scope.family?.members;
  if (!Array.isArray(members) || !members.length)
    throw new Blocked("modeling_scope", "family seed requires explicit target members");
  const ids = members.map(m => m.id), known = new Set(data.tree.nodes.map((n: any) => n.id));
  if (!ids.includes(task.categoryId) || new Set(ids).size !== ids.length || ids.some(id => !known.has(id)))
    throw new Blocked("modeling_scope", "family seed target members must be distinct frozen category IDs including the anchor");
  return ids;
}

export function knownDefinitions(data: Snapshot) {
  return [...data.attributes, ...data.families.flatMap(f => f.attributes)];
}

// A changed ID or label does not turn the same registered parameter into a new one.
// This intentionally uses identity/definition/concept+scope, not fuzzy name similarity.
export function matchingDefinitions(a: AttributeDefinition, data: Snapshot) {
  return knownDefinitions(data).filter(p => p.id === a.id || definitionFingerprint(p) === definitionFingerprint(a) ||
    normalized(p.definition) === normalized(a.definition) ||
    (normalized(p.conceptKey) === normalized(a.conceptKey) && normalized(p.scope) === normalized(a.scope)));
}

export function reuseApplicability(a: AttributeDefinition, data: Snapshot, task: Task) {
  const targetCategoryIds = modelingTargets(task, data), definitionHash = definitionFingerprint(a);
  const families = data.families.filter(f => f.attributes.some(p => p.id === a.id && definitionFingerprint(p) === definitionHash))
    .map(f => ({ id: f.id, version: f.version, members: f.members,
      usable: f.status === "confirmed" || (f.status === "candidate" && f.runId === task.runId) }));
  const reviews = (data.attributeApplicability ?? []).filter(r => r.attributeId === a.id && r.definitionHash === definitionHash);
  const blockedCategoryIds = targetCategoryIds.filter(id => reviews.some(r => r.targetCategoryIds.includes(id) && r.status !== "supported"));
  const coveredCategoryIds = targetCategoryIds.filter(id => !blockedCategoryIds.includes(id) &&
    (families.some(f => f.usable && f.members.includes(id)) ||
      reviews.some(r => r.status === "supported" && r.targetCategoryIds.includes(id))));
  return { attributeId: a.id, definitionHash, targetCategoryIds, coveredCategoryIds,
    missingCategoryIds: targetCategoryIds.filter(id => !coveredCategoryIds.includes(id)),
    reusable: coveredCategoryIds.length === targetCategoryIds.length,
    families, reviews };
}

export function attributeApplicabilityErrors(attributes: AttributeDefinition[], data: Snapshot, task: Task): Finding[] {
  const errors: Finding[] = [];
  for (const a of attributes) {
    const matches = matchingDefinitions(a, data);
    if (!matches.length) continue; // New target-scoped proposals remain subject to R07 and human review.
    if (!matches.some(p => p.id === a.id)) {
      errors.push({ ruleId: "R03", objectId: a.id,
        message: `new ID aliases registered parameter ${[...new Set(matches.map(p => p.id))].join(",")}; do not bypass target applicability by renaming. Reuse a supported definition or defer a shared revision.` });
      continue;
    }
    const assessment = reuseApplicability(a, data, task);
    if (!assessment.reusable)
      errors.push({ ruleId: "R03", objectId: a.id,
        message: `target-category applicability is not established for ${assessment.missingCategoryIds.join(",")}; unchanged definition, pool hit, citation or professionalReadiness=defined is insufficient. Keep an extension pending target-scope review, or propose a genuinely different target-scoped definition; do not merely change the ID.` });
  }
  return errors;
}
