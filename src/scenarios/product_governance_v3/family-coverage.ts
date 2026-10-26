import type { BatchPlan } from "./batch.ts";
import { DataSnapshot } from "./snapshot.ts";

// A shared parent or a name match must never silently create a baseline.
export function familyCoverage(plan: BatchPlan, snapshot = new DataSnapshot(plan.snapshot)) {
  const selected = new Set(plan.categoryIds);
  const rows = plan.categoryIds.map(categoryId => {
    const node = snapshot.tree.get(categoryId), groups = plan.groups.filter(g => g.members.includes(categoryId));
    if (groups.length > 1) throw Error("ambiguous family coverage: " + categoryId);
    const group = groups[0], family = group && snapshot.data.families.find(f => f.id === group.id);
    return { categoryId, category: node.name, familyId: group?.id ?? null,
      status: family ? "existing_baseline" : group?.needsSeed ? "seed_required" : "ungrouped_pending_review",
      baselineStatus: family?.status ?? null, baselineVersion: family?.version ?? null,
      relatedCandidates: !group ? snapshot.tree.related(categoryId).filter(n => selected.has(n.node.id))
        .map(n => ({ categoryId: n.node.id, category: n.node.name, basis: "name_similarity_only" })) : [],
      reason: group?.reason ?? "尚未确认共同商品对象及适用边界；本次独立建模，不表示不存在同族" };
  });
  return { totalLeaves: rows.length, configuredFamilies: plan.groups.length,
    groupedLeaves: rows.filter(r => r.familyId).length,
    ungroupedLeaves: rows.filter(r => !r.familyId).length,
    newSeedFamilies: plan.groups.filter(g => g.needsSeed && !snapshot.data.families.some(f => f.id === g.id)).map(g => g.id),
    reusedFamilies: plan.groups.filter(g => snapshot.data.families.some(f => f.id === g.id)).map(g => g.id),
    semanticGroupingComplete: false,
    automaticGrouping: false, rows };
}
