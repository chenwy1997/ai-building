import type { Dictionary, Selection } from '../contracts.ts';
import { compileSelections } from '../contracts.ts';

/**
 * Mounting layer: how to choose properties for a category, kept separate from what a
 * property means.
 *
 * Definitions are versioned and immutable; guidance can evolve without bumping a
 * definition revision. Guidance narrows what a model is asked to consider and lets the
 * program check the result, so the per-category task becomes selection from a shortlist
 * instead of open-ended authoring. Facets and relations are semantic content authored
 * against the evidence, not string rules: the program uses them to build candidate sets
 * and to flag conflicts, never to decide on its own that a category needs an attribute.
 */

export type Dimension =
  | '身份' | '合规' | '材质' | '外观' | '几何与质量' | '性能' | '接口' | '包装' | '交付';

export const dimensions: Dimension[] = ['身份', '合规', '材质', '外观', '几何与质量', '性能', '接口', '包装', '交付'];

export interface Guidance {
  propertyId: string;
  dimension: Dimension;
  /** Retrieval labels used to assemble a candidate shortlist for a branch. */
  facets: string[];
  /** When this property is the right choice, in the terms a selector needs. */
  selectWhen: string;
  /** Different measurement bases or designation systems for one selection need; normally only one is mounted. */
  alternativeOf?: string[];
  /** Paired measurements; mounting one without considering the other is usually a gap. */
  companions?: string[];
}

export interface GuidanceIndex {
  schema: 'sanheng-mounting-guidance-v1';
  entries: Guidance[];
}

/** Branch template: siblings share a base set, each leaf only carries its difference. */
export interface LeafDelta {
  leafId: string;
  leafName: string;
  add?: Selection[];
  remove?: Array<{ propertyId: string; reason: string }>;
  override?: Array<{ propertyId: string; requirement: Selection['requirement']; condition?: string; reason: string }>;
}
export interface BranchTemplate {
  schema: 'sanheng-branch-template-v1';
  branchPath: string[];
  base: Selection[];
  leaves: LeafDelta[];
}

export function validateGuidance(dictionary: Dictionary, index: GuidanceIndex): void {
  if (index.schema !== 'sanheng-mounting-guidance-v1') throw new Error('未知挂载引导格式');
  const ids = new Set(dictionary.properties.map((property) => property.id));
  const seen = new Set<string>();
  for (const entry of index.entries) {
    if (!ids.has(entry.propertyId)) throw new Error(`引导指向不存在的属性: ${entry.propertyId}`);
    if (seen.has(entry.propertyId)) throw new Error(`同一属性有两条引导: ${entry.propertyId}`);
    seen.add(entry.propertyId);
    if (!dimensions.includes(entry.dimension)) throw new Error(`未知维度大类: ${entry.propertyId} -> ${entry.dimension}`);
    if (!entry.facets.length) throw new Error(`引导缺少召回标签: ${entry.propertyId}`);
    if (!entry.selectWhen.trim()) throw new Error(`引导缺少选用说明: ${entry.propertyId}`);
    for (const related of [...(entry.alternativeOf ?? []), ...(entry.companions ?? [])]) {
      if (!ids.has(related)) throw new Error(`引导关联到不存在的属性: ${entry.propertyId} -> ${related}`);
      if (related === entry.propertyId) throw new Error(`引导不能关联自身: ${entry.propertyId}`);
    }
  }
  // Alternates and companions describe symmetric relations; a one-sided declaration
  // would make the conflict check depend on which property happens to be looked at.
  const byId = new Map(index.entries.map((entry) => [entry.propertyId, entry]));
  for (const entry of index.entries) {
    for (const [kind, list] of [['alternativeOf', entry.alternativeOf ?? []], ['companions', entry.companions ?? []]] as const) {
      for (const related of list) {
        const other = byId.get(related);
        if (!other) throw new Error(`关联的属性没有引导，无法双向声明: ${entry.propertyId} -> ${related}`);
        if (!(other[kind] ?? []).includes(entry.propertyId)) {
          throw new Error(`${kind} 必须双向声明: ${entry.propertyId} 与 ${related}`);
        }
      }
    }
  }
}

/** Candidate shortlist for a branch, assembled from facets. Selection remains a model judgement. */
export function candidates(index: GuidanceIndex, facets: string[]): Guidance[] {
  const wanted = new Set(facets);
  return index.entries
    .filter((entry) => entry.facets.some((facet) => wanted.has(facet)))
    .sort((a, b) => (a.dimension < b.dimension ? -1 : a.dimension > b.dimension ? 1 : a.propertyId < b.propertyId ? -1 : 1));
}

export interface ResolvedLeaf {
  leafId: string;
  leafName: string;
  selections: Selection[];
  inherited: string[];
  added: string[];
  removed: string[];
  overridden: string[];
}

/**
 * Composes base plus delta into the leaf's full selection list. Inheritance is what keeps
 * sibling leaves consistent: a leaf can only differ from its siblings by an explicit,
 * reasoned delta, so drift of the kind seen in the historical delivery cannot occur
 * silently.
 */
export function resolveLeaf(dictionary: Dictionary, template: BranchTemplate, leaf: LeafDelta): ResolvedLeaf {
  const byId = new Map(template.base.map((selection) => [selection.propertyId, selection]));
  const inherited = [...byId.keys()];

  const removed: string[] = [];
  for (const removal of leaf.remove ?? []) {
    if (!byId.has(removal.propertyId)) throw new Error(`${leaf.leafName} 删除了基础集里没有的属性: ${removal.propertyId}`);
    if (!removal.reason.trim()) throw new Error(`${leaf.leafName} 删除基础集属性必须写理由: ${removal.propertyId}`);
    byId.delete(removal.propertyId);
    removed.push(removal.propertyId);
  }

  const overridden: string[] = [];
  for (const change of leaf.override ?? []) {
    const current = byId.get(change.propertyId);
    if (!current) throw new Error(`${leaf.leafName} 修改了基础集里没有的属性: ${change.propertyId}`);
    if (!change.reason.trim()) throw new Error(`${leaf.leafName} 修改必填策略必须写理由: ${change.propertyId}`);
    if (change.requirement === current.requirement && change.condition === current.condition) {
      throw new Error(`${leaf.leafName} 的必填策略修改没有实际变化: ${change.propertyId}`);
    }
    byId.set(change.propertyId, { ...current, requirement: change.requirement, condition: change.condition, rationale: change.reason });
    overridden.push(change.propertyId);
  }

  const added: string[] = [];
  for (const selection of leaf.add ?? []) {
    if (byId.has(selection.propertyId)) throw new Error(`${leaf.leafName} 新增的属性已在基础集中: ${selection.propertyId}`);
    byId.set(selection.propertyId, selection);
    added.push(selection.propertyId);
  }

  const selections = [...byId.values()];
  // Reuses the existing compiler so a leaf can never carry a unit or requirement the
  // definition does not allow, and cannot override a stored definition field.
  compileSelections(dictionary, selections);
  return { leafId: leaf.leafId, leafName: leaf.leafName, selections, inherited, added, removed, overridden };
}

export interface Finding {
  leafId: string;
  leafName: string;
  code: '缺维度' | '同需求多口径' | '缺配对口径' | '无引导';
  detail: string;
  propertyIds: string[];
}

/**
 * Structural checks over a resolved leaf. These catch the defect classes seen in the
 * historical delivery — missing identity, a designation and a measured value for the same
 * need, one half of a paired measurement — without judging industry correctness. Findings
 * are for review; none of them silently edits a template.
 */
export function inspectLeaf(index: GuidanceIndex, leaf: ResolvedLeaf, requiredDimensions: Dimension[]): Finding[] {
  const byId = new Map(index.entries.map((entry) => [entry.propertyId, entry]));
  const mounted = new Set(leaf.selections.map((selection) => selection.propertyId));
  const findings: Finding[] = [];
  const at = (code: Finding['code'], detail: string, propertyIds: string[]) =>
    findings.push({ leafId: leaf.leafId, leafName: leaf.leafName, code, detail, propertyIds });

  const present = new Set<Dimension>();
  for (const id of mounted) {
    const guidance = byId.get(id);
    if (!guidance) {
      at('无引导', `属性 ${id} 没有挂载引导，无法参与结构检查`, [id]);
      continue;
    }
    present.add(guidance.dimension);
  }
  for (const dimension of requiredDimensions) {
    if (!present.has(dimension)) at('缺维度', `没有任何属性覆盖「${dimension}」维度`, []);
  }

  const reported = new Set<string>();
  for (const id of mounted) {
    const guidance = byId.get(id);
    if (!guidance) continue;
    for (const alternative of guidance.alternativeOf ?? []) {
      if (!mounted.has(alternative)) continue;
      const key = [id, alternative].sort().join('|');
      if (reported.has(key)) continue;
      reported.add(key);
      at('同需求多口径', `${id} 与 ${alternative} 是同一选型需求的不同口径，同时挂载须说明理由`, [id, alternative]);
    }
    for (const companion of guidance.companions ?? []) {
      if (mounted.has(companion)) continue;
      at('缺配对口径', `挂载了 ${id} 但没有配对的 ${companion}`, [id, companion]);
    }
  }
  return findings;
}
