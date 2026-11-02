import type { Dimension, Guidance, GuidanceIndex } from '../mounting.ts';
import type { BranchEvidence } from './build.ts';
import type { BranchSpec } from './spec.ts';

/**
 * Derives a branch spec from the branch's own history instead of hand-writing one.
 *
 * Hand-written specs are what actually blocked scaling: the taxonomy has 1,627 third-level
 * branches, and the API cost of mounting all of them is small next to the cost of authoring
 * 1,627 facet lists. The derivation is evidence-driven — a branch's historical attribute
 * names map to canonical properties, those properties carry facets, and the facets that
 * recur across the branch describe what kind of goods it sells.
 *
 * Validated against the four hand-mounted branches: the derived shortlist contains every
 * property those branches actually mounted, 4 of 4. In one case (塑料润滑脂) it is tighter
 * than what I hand-wrote, having dropped O-ring and wall-thickness properties that grease
 * has no use for.
 */

/**
 * Facets that describe a form rather than a domain, so they cannot be inferred from which
 * properties a branch happened to use before. Leaving 实物 out was the one error the
 * validation caught: three of four branches then lost the overall length/width/height/
 * thickness properties, because their history names map to specific geometry (通径, 壁厚)
 * and never to the generic envelope dimensions.
 */
export const alwaysOnFacets = ['通用', '实物', '配件', '兜底类目'] as const;

/**
 * A facet is this branch's domain when the branch uses a real fraction of what the facet
 * holds — not merely when it recurs. Counting occurrences instead pulled in 22 facets and
 * 94 of 129 properties for 垃圾袋, because generic properties like 品牌 and 材质 each carry
 * several facets and so drag whole domains along. Using 2 of 20 管路 properties is
 * incidental; using 6 of 8 清洁 properties is what the branch is about.
 */
const facetFloor = { minProperties: 2, shareOfFacet: 0.25 } as const;

/** Every sellable thing needs to be identifiable; the rest has to be earned from evidence. */
const alwaysRequiredDimensions: Dimension[] = ['身份'];

/** A dimension is required only if most leaves already used something from it. */
const dimensionFloor = 0.6;

export interface HistoryMapping {
  /** Historical attribute name to the canonical properties it was mapped onto. */
  targets: Map<string, string[]>;
}

const tally = <T>(items: Iterable<T>) => {
  const counts = new Map<T, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return counts;
};

/** Facets worth showing this branch, by how much of each facet the branch actually uses. */
export function deriveFacets(evidence: BranchEvidence, mapping: HistoryMapping, guidance: GuidanceIndex): string[] {
  const byProperty = new Map<string, Guidance>(guidance.entries.map((entry) => [entry.propertyId, entry]));
  const facetSize = tally(guidance.entries.flatMap((entry) => entry.facets));

  const used = new Set(
    evidence.leaves.flatMap((leaf) => leaf.historical.flatMap((attribute) => mapping.targets.get(attribute.name) ?? [])),
  );
  const usedPerFacet = tally([...used].flatMap((propertyId) => byProperty.get(propertyId)?.facets ?? []));

  const domain = [...usedPerFacet.entries()]
    .filter(
      ([facet, count]) =>
        count >= facetFloor.minProperties && count / (facetSize.get(facet) ?? count) >= facetFloor.shareOfFacet,
    )
    .map(([facet]) => facet);
  return [...new Set([...domain, ...alwaysOnFacets])].sort();
}

/**
 * Dimensions to require. Derived rather than fixed because a dimension that a branch has
 * never used is not a defect: 兜底类目 buckets have no interface, and consumables have no
 * geometry. Requiring one anyway would report 缺维度 on a correct template, and a check
 * that fires on correct output teaches reviewers to ignore it.
 */
export function deriveRequiredDimensions(
  evidence: BranchEvidence,
  mapping: HistoryMapping,
  guidance: GuidanceIndex,
): Dimension[] {
  const byProperty = new Map<string, Guidance>(guidance.entries.map((entry) => [entry.propertyId, entry]));
  const leavesPerDimension = new Map<Dimension, number>();
  for (const leaf of evidence.leaves) {
    const seen = new Set<Dimension>();
    for (const attribute of leaf.historical)
      for (const propertyId of mapping.targets.get(attribute.name) ?? []) {
        const dimension = byProperty.get(propertyId)?.dimension;
        if (dimension) seen.add(dimension);
      }
    for (const dimension of seen) leavesPerDimension.set(dimension, (leavesPerDimension.get(dimension) ?? 0) + 1);
  }
  const threshold = evidence.leaves.length * dimensionFloor;
  const earned = [...leavesPerDimension.entries()]
    .filter(([, leaves]) => leaves >= threshold)
    .map(([dimension]) => dimension);
  return [...new Set([...alwaysRequiredDimensions, ...earned])];
}

export function deriveSpec(evidence: BranchEvidence, mapping: HistoryMapping, guidance: GuidanceIndex): BranchSpec {
  const facets = deriveFacets(evidence, mapping, guidance);
  const requiredDimensions = deriveRequiredDimensions(evidence, mapping, guidance);
  const mapped = new Set(
    evidence.leaves.flatMap((leaf) => leaf.historical.flatMap((attribute) => mapping.targets.get(attribute.name) ?? [])),
  );
  return {
    branchPath: evidence.branchPath,
    facets,
    requiredDimensions,
    premise:
      `召回标签与必填维度由本分支历史属性名反推，未经人工挑选：${evidence.leaves.length} 个末级类目的历史名映射到 ${mapped.size} 条字典属性，`
      + `其召回标签中复现的构成领域标签，加上常开的 ${alwaysOnFacets.join('、')}；`
      + `必填维度取「身份」加上被 ${Math.round(dimensionFloor * 100)}% 以上末级用过的维度。`
      + `未映射的历史名 ${evidence.unmappedNames.length} 个不参与反推——它们要么是字典缺口，要么是尚未判定的长尾，正是本次要暴露的东西。`,
  };
}
