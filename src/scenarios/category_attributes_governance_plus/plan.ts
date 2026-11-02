import type { Attribute } from "../category_attributes_governance/types.ts";
import { buildLineage } from "../category_governance_plus/engine.ts";
import type { CategoryOp, MergeParams, Tombstone } from "../category_governance_plus/ops.ts";

export interface TemplateRow { categoryId: string; attributes: Attribute[] }
export interface BaseTemplate { version: number | string; rows: TemplateRow[] }

export type Bucket = "unchanged" | "derived" | "added";
export type Provenance = "inherited" | "reconciled" | "generated";

export interface MergeConflict { key: string; field: "type" | "unit"; values: string[] }

export interface BucketPlan {
  categoryId: string;
  bucket: Bucket;
  provenance: Provenance;
  attributes: Attribute[];
  conflicts: MergeConflict[];
  hints: string[];
}

const cloneAttribute = (attr: Attribute): Attribute => [
  attr[0], attr[1], attr[2], attr[3], attr[4], [...attr[5]], attr[6], attr[7], attr[8], [...attr[9]],
];

const REQUIREMENT_RANK: Record<Attribute[3], number> = { optional: 1, conditional: 2, required: 3 };

/**
 * 确定性合并：按 attr key 并集；type/unit 冲突记入 conflicts（不擅自裁决）；
 * options 求并集；requirement 取更严格者（required > conditional > optional）。
 */
export function reconcileMerge(templates: Attribute[][]): { attributes: Attribute[]; conflicts: MergeConflict[] } {
  const byKey = new Map<string, Attribute>();
  const conflictMap = new Map<string, MergeConflict>();
  const addConflict = (key: string, field: "type" | "unit", ...values: string[]): void => {
    const id = `${key}|${field}`;
    const existing = conflictMap.get(id) ?? { key, field, values: [] as string[] };
    for (const value of values) if (!existing.values.includes(value)) existing.values.push(value);
    conflictMap.set(id, existing);
  };
  for (const template of templates) {
    for (const attr of template) {
      const acc = byKey.get(attr[0]);
      if (!acc) {
        byKey.set(attr[0], cloneAttribute(attr));
        continue;
      }
      if (acc[2] !== attr[2]) addConflict(attr[0], "type", acc[2], attr[2]);
      if (acc[4] !== attr[4]) addConflict(attr[0], "unit", acc[4], attr[4]);
      if (REQUIREMENT_RANK[attr[3]] > REQUIREMENT_RANK[acc[3]]) {
        acc[3] = attr[3];
        acc[6] = attr[6];
      }
      for (const option of attr[5]) if (!acc[5].includes(option)) acc[5].push(option);
      if (!acc[1] && attr[1]) acc[1] = attr[1];
      if (!acc[6] && attr[6]) acc[6] = attr[6];
      if (!acc[7] && attr[7]) acc[7] = attr[7];
      if (!acc[8] && attr[8]) acc[8] = attr[8];
      for (const ref of attr[9]) if (!acc[9].includes(ref)) acc[9].push(ref);
    }
  }
  const conflicts = [...conflictMap.values()]
    .sort((a, b) => a.key.localeCompare(b.key) || a.field.localeCompare(b.field));
  return { attributes: [...byKey.values()], conflicts };
}

/**
 * 父模板属性全量下发到每个子类；提示哪些属性可能是拆分轴（有选项的单/多选属性），
 * 供人工/LLM 后续裁剪。本步不调 AI。
 */
export function reconcileSplit(
  parent: Attribute[],
  children: Array<{ id: string; name: string }>,
): Array<{ categoryId: string; attributes: Attribute[]; hints: string[] }> {
  const axes = parent.filter((attr) => (attr[2] === "single" || attr[2] === "multi") && attr[5].length > 0);
  return children.map((child) => {
    const hints = axes.map((attr) => {
      const matched = attr[5].filter((option) => child.name.includes(option) || option.includes(child.name));
      return matched.length > 0
        ? `属性「${attr[1]}」（${attr[0]}）的选项与子类目名相关：${matched.join("、")}，可能是拆分轴，请确认是否裁剪其余选项`
        : `属性「${attr[1]}」（${attr[0]}）有 ${attr[5].length} 个选项，可能是拆分轴，请确认子类目是否需要裁剪`;
    });
    return { categoryId: child.id, attributes: parent.map(cloneAttribute), hints };
  });
}

/**
 * 把目标版本的末级类目分三桶：
 * unchanged（无 op 触及或仅 rename/move）整份继承；derived（merge 存续者 / split 子类）继承为草稿并调和；
 * added（add 产生）只标桶与占位，不调用 AI。
 */
export function planBuckets(
  leaves: Array<{ id: string; name: string }>,
  ops: readonly CategoryOp[],
  tombstones: readonly Tombstone[],
  base: BaseTemplate,
  versionNo: number,
): BucketPlan[] {
  const baseById = new Map(base.rows.map((row) => [row.categoryId, row.attributes]));
  const lineage = buildLineage(ops, versionNo);
  const mergeParamsOf = new Map<string, MergeParams>();
  for (const op of ops) {
    if (op.type !== "merge") continue;
    const params = op.params as MergeParams;
    if (params.target) mergeParamsOf.set(params.target, params);
  }
  const mergedAwayOf = new Map<string, string[]>();
  for (const tombstone of tombstones) {
    if (!tombstone.newId) continue;
    mergedAwayOf.set(tombstone.newId, [...(mergedAwayOf.get(tombstone.newId) ?? []), tombstone.oldId]);
  }
  return leaves.map((leaf) => {
    const merge = mergeParamsOf.get(leaf.id);
    if (merge) {
      const sources = [...new Set([...merge.sources, merge.target, ...(mergedAwayOf.get(leaf.id) ?? [])])];
      const { attributes, conflicts } = reconcileMerge(sources.map((id) => baseById.get(id) ?? []));
      const hints = sources
        .filter((id) => !baseById.has(id))
        .map((id) => `源类目 ${id} 无基础模板，按空模板参与合并`);
      return { categoryId: leaf.id, bucket: "derived", provenance: "reconciled", attributes, conflicts, hints };
    }
    const entry = lineage[leaf.id];
    if (entry?.kind === "split" && entry.sourceId) {
      const parent = baseById.get(entry.sourceId) ?? [];
      const [plan] = reconcileSplit(parent, [{ id: leaf.id, name: leaf.name }]);
      const hints = [...(plan?.hints ?? [])];
      if (!baseById.has(entry.sourceId)) hints.unshift(`父类目 ${entry.sourceId} 无基础模板，按空模板下发`);
      return {
        categoryId: leaf.id, bucket: "derived", provenance: "reconciled",
        attributes: plan?.attributes ?? [], conflicts: [], hints,
      };
    }
    if (entry?.kind === "add") {
      return {
        categoryId: leaf.id, bucket: "added", provenance: "generated",
        attributes: [], conflicts: [], hints: ["add 产生的新类目：待全量治理"],
      };
    }
    const inherited = baseById.get(leaf.id);
    if (inherited) {
      return {
        categoryId: leaf.id, bucket: "unchanged", provenance: "inherited",
        attributes: inherited.map(cloneAttribute), conflicts: [], hints: [],
      };
    }
    return {
      categoryId: leaf.id, bucket: "added", provenance: "generated",
      attributes: [], conflicts: [], hints: ["无基础模板可继承：待全量治理"],
    };
  });
}

export interface DiffRow {
  categoryId: string;
  key: string;
  kind: "added" | "removed" | "changed";
  before: Attribute | null;
  after: Attribute | null;
}

export interface DiffReport {
  summary: { added: number; removed: number; changed: number; unchanged: number };
  rows: DiffRow[];
}

/** 只产出变化行（added/removed/changed），按 (category_id, attr_key) 定位；未变化只计入 summary。 */
export function diffTemplates(base: TemplateRow[], next: TemplateRow[]): DiffReport {
  const locate = (rows: TemplateRow[]): Map<string, { categoryId: string; attr: Attribute }> => {
    const map = new Map<string, { categoryId: string; attr: Attribute }>();
    for (const row of rows) {
      for (const attr of row.attributes) map.set(`${row.categoryId} ${attr[0]}`, { categoryId: row.categoryId, attr });
    }
    return map;
  };
  const baseMap = locate(base);
  const nextMap = locate(next);
  const rows: DiffRow[] = [];
  let unchanged = 0;
  for (const [id, { categoryId, attr }] of nextMap) {
    const before = baseMap.get(id);
    if (!before) rows.push({ categoryId, key: attr[0], kind: "added", before: null, after: attr });
    else if (JSON.stringify(before.attr) !== JSON.stringify(attr)) {
      rows.push({ categoryId, key: attr[0], kind: "changed", before: before.attr, after: attr });
    } else unchanged += 1;
  }
  for (const [id, { categoryId, attr }] of baseMap) {
    if (!nextMap.has(id)) rows.push({ categoryId, key: attr[0], kind: "removed", before: attr, after: null });
  }
  rows.sort((a, b) => a.categoryId.localeCompare(b.categoryId) || a.key.localeCompare(b.key));
  return {
    summary: {
      added: rows.filter((row) => row.kind === "added").length,
      removed: rows.filter((row) => row.kind === "removed").length,
      changed: rows.filter((row) => row.kind === "changed").length,
      unchanged,
    },
    rows,
  };
}
