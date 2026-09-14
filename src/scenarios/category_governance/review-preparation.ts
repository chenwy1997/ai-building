import { propertyVariantId, type AttributeCandidate, type AttributeConsensusDocument, type AttributeVariant, type CategoryConsensus } from "./consensus.ts";
import type { AttributeProperty } from "./types.ts";

export function candidateProperty(candidate: AttributeCandidate): AttributeProperty {
  const { decision, runCount, observationCount, coverage, requiredRate, sharedRate, sourceRuns, reasons, variants, ...property } = candidate;
  return property;
}

export function candidateVariants(candidate: AttributeCandidate): AttributeVariant[] {
  if (candidate.variants?.length) return candidate.variants;
  const property = candidateProperty(candidate);
  return [{ id: propertyVariantId(property), property, sourceRuns: candidate.sourceRuns, roundIds: candidate.sourceRuns }];
}

/** 仅按已有 key 关联定义，不按名称猜语义，也不裁剪低频/超量候选。 */
export function prepareReviewCategory(category: CategoryConsensus): CategoryConsensus {
  const candidates = [...category.shared, ...category.properties];
  const parents = candidates.map((_, index) => index);
  const root = (index: number): number => parents[index] === index ? index : parents[index] = root(parents[index]!);
  const keys = new Map<string, number>();
  candidates.forEach((candidate, index) => {
    for (const key of [candidate.key, ...candidateVariants(candidate).map((variant) => variant.property.key)]) {
      const other = keys.get(key);
      if (other !== undefined) parents[root(index)] = root(other);
      keys.set(key, index);
    }
  });
  const groups = new Map<number, AttributeCandidate[]>();
  candidates.forEach((candidate, index) => {
    const id = root(index);
    const group = groups.get(id) ?? [];
    group.push(candidate);
    groups.set(id, group);
  });
  const prepared = [...groups.values()].map((group): AttributeCandidate => {
    const definitions = new Map<string, AttributeVariant>();
    for (const candidate of group) for (const variant of candidateVariants(candidate)) {
      const id = propertyVariantId(variant.property);
      const previous = definitions.get(id);
      definitions.set(id, { ...variant, id,
        sourceRuns: [...new Set([...(previous?.sourceRuns ?? []), ...variant.sourceRuns])].sort(),
        roundIds: [...new Set([...(previous?.roundIds ?? []), ...variant.roundIds])].sort(),
      });
    }
    const variants = [...definitions.values()].sort((a, b) => a.id.localeCompare(b.id));
    const representative = [...group].sort((a, b) => b.observationCount - a.observationCount || a.key.localeCompare(b.key))[0]!;
    const key = [...new Set(group.map((candidate) => candidate.key))].sort()[0]!;
    const roundIds = new Set(variants.flatMap((variant) => variant.roundIds));
    const requiredRounds = new Set(variants.filter((variant) => variant.property.required).flatMap((variant) => variant.roundIds));
    const sharedRounds = new Set(variants.filter((variant) => variant.property.scope === "shared").flatMap((variant) => variant.roundIds));
    return { ...representative, key, variants,
      // 这里只合并观察来源，不根据字符串规则裁决含义、单位、必填或枚举冲突。
      observationCount: roundIds.size, coverage: roundIds.size / Math.max(1, category.runCount),
      requiredRate: requiredRounds.size / Math.max(1, category.runCount), sharedRate: sharedRounds.size / Math.max(1, category.runCount),
      sourceRuns: [...new Set(variants.flatMap((variant) => variant.sourceRuns))].sort(),
    };
  }).sort((a, b) => a.key.localeCompare(b.key));
  return { ...category, shared: prepared.filter((item) => item.scope === "shared"), properties: prepared.filter((item) => item.scope !== "shared") };
}

export function reviewCategoryStats(category: CategoryConsensus) {
  const candidates = [...category.shared, ...category.properties];
  const conflictGroups = candidates.filter((candidate) => candidateVariants(candidate).length > 1).length;
  return { candidateGroups: candidates.length, definitionCount: candidates.reduce((sum, candidate) => sum + candidateVariants(candidate).length, 0), conflictGroups,
    // 这个阈值仅用于抽样覆盖压力较大的输入，不删除或跳过任何候选。
    risk: candidates.length > 80 ? "large" : conflictGroups > 0 ? "conflict" : "ordinary" };
}

export function prepareReviewConsensus(consensus: AttributeConsensusDocument): AttributeConsensusDocument {
  const categories = consensus.categories.map(prepareReviewCategory);
  const all = categories.flatMap((category) => [...category.shared, ...category.properties]);
  return { ...consensus, categories, stats: { ...consensus.stats, candidateCount: all.length,
    confirmedCount: all.filter((candidate) => candidate.decision === "confirmed").length,
    candidateStatusCount: all.filter((candidate) => candidate.decision === "candidate").length,
    reviewCount: all.filter((candidate) => candidate.decision === "review").length,
  } };
}

/** 确定性分层抽样：覆盖普通、多定义和大输入，以及不同一级业务类目。 */
export function sampleReviewCategories(categories: CategoryConsensus[], count: number): CategoryConsensus[] {
  const buckets = new Map<string, CategoryConsensus[]>();
  for (const category of [...categories].sort((a, b) => a.category.id.localeCompare(b.category.id))) {
    const risk = reviewCategoryStats(category).risk;
    const key = `${risk === "large" ? "0" : risk === "conflict" ? "1" : "2"}/${category.category.path[1] ?? category.category.path[0]}`;
    const values = buckets.get(key) ?? [];
    values.push(category);
    buckets.set(key, values);
  }
  const byRisk = ["0", "1", "2"].map((risk) => [...buckets.entries()].filter(([key]) => key.startsWith(risk)).sort(([a], [b]) => a.localeCompare(b)));
  const groups: Array<[string, CategoryConsensus[]]> = [];
  // 交错风险层，避免 --sample 较小时前面的异常类目挤掉普通对照组。
  for (let index = 0; index < Math.max(...byRisk.map((items) => items.length)); index += 1) {
    for (const items of byRisk) if (items[index]) groups.push(items[index]!);
  }
  const selected: CategoryConsensus[] = [];
  for (let index = 0; selected.length < Math.min(count, categories.length); index += 1) {
    let added = false;
    for (const [, group] of groups) {
      if (selected.length >= count) break;
      if (group[index]) { selected.push(group[index]!); added = true; }
    }
    if (!added) break;
  }
  return selected;
}
