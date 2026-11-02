import type { Category } from "../category_attributes_governance/types.ts";
import { GENERIC_NAME_WORDS } from "./audit.ts";
import type { DisableParams } from "./ops.ts";

/** 全树挂载分布与零挂载分析：纯函数，counts 以 Map<id, number> 注入（leafMountCounts 聚合结果）。 */

export interface MountDistribution {
  zero: number;
  oneToFive: number;
  sixToTwenty: number;
  twentyOneToNinetyNine: number;
  hundredPlus: number;
  median: number;
  mountedTotal: number;
  top: Array<{ id: string; path: string[]; count: number }>;
}

export function mountDistribution(leaves: Category[], counts: Map<string, number>): MountDistribution {
  const values = leaves.map((leaf) => counts.get(leaf.id) ?? 0).sort((a, b) => a - b);
  const bucketOf = (count: number): keyof Omit<MountDistribution, "median" | "mountedTotal" | "top"> =>
    count === 0 ? "zero"
      : count <= 5 ? "oneToFive"
        : count <= 20 ? "sixToTwenty"
          : count <= 99 ? "twentyOneToNinetyNine" : "hundredPlus";
  const distribution: MountDistribution = {
    zero: 0, oneToFive: 0, sixToTwenty: 0, twentyOneToNinetyNine: 0, hundredPlus: 0,
    median: 0, mountedTotal: 0, top: [],
  };
  for (const value of values) distribution[bucketOf(value)] += 1;
  distribution.mountedTotal = values.reduce((sum, value) => sum + value, 0);
  distribution.median = values.length === 0 ? 0
    : values.length % 2 === 1 ? values[(values.length - 1) / 2]!
      : (values[values.length / 2 - 1]! + values[values.length / 2]!) / 2;
  distribution.top = leaves
    .map((leaf) => ({ id: leaf.id, path: leaf.pathNames, count: counts.get(leaf.id) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
    .slice(0, 20);
  return distribution;
}

export interface ZeroMountItem {
  id: string;
  path: string[];
  /** enabled 兄弟（含分支）及其子树挂载量 */
  siblings: Array<{ id: string; name: string; mount: number }>;
  siblingMountTotal: number;
  /** true=整个分支都没货（枯枝）；false=单独裸奔 */
  branchDead: boolean;
  generic: boolean;
}

/** 子树挂载量（enabled 末级 counts 之和）。 */
export function subtreeMount(nodes: Category[], rootId: string, counts: Map<string, number>): number {
  const root = nodes.find((node) => node.id === rootId);
  if (!root) return 0;
  if (root.isLeaf) return root.enabled ? (counts.get(root.id) ?? 0) : 0;
  let total = 0;
  for (const node of nodes) {
    if (node.enabled && node.isLeaf && node.id !== rootId && node.pathIds.includes(rootId)) {
      total += counts.get(node.id) ?? 0;
    }
  }
  return total;
}

export function analyzeZeroMounts(nodes: Category[], counts: Map<string, number>): ZeroMountItem[] {
  const leaves = nodes.filter((node) => node.enabled && node.isLeaf);
  const childrenOf = (parentId: string | null): Category[] =>
    nodes.filter((node) => node.parentId === parentId && node.enabled)
      .sort((a, b) => (a.name < b.name ? -1 : 1));
  return leaves
    .filter((leaf) => (counts.get(leaf.id) ?? 0) === 0)
    .sort((a, b) => a.pathNames.join("/") < b.pathNames.join("/") ? -1 : 1)
    .map((leaf) => {
      const siblings = childrenOf(leaf.parentId)
        .filter((sibling) => sibling.id !== leaf.id)
        .map((sibling) => ({ id: sibling.id, name: sibling.name, mount: subtreeMount(nodes, sibling.id, counts) }));
      const siblingMountTotal = siblings.reduce((sum, sibling) => sum + sibling.mount, 0);
      return {
        id: leaf.id,
        path: leaf.pathNames,
        siblings,
        siblingMountTotal,
        branchDead: siblingMountTotal === 0,
        generic: GENERIC_NAME_WORDS.some((word) => leaf.name.includes(word)),
      };
    });
}

export interface DisableCandidate {
  type: "disable";
  params: DisableParams;
  evidence: Record<string, unknown>;
}

/** 零挂载 → disable 提案（evidence 带路径/兄弟挂载/杂类标记/枯枝判断）；零挂载 ≠ 直接 disable，需过裁决器。 */
export function buildDisableOps(items: ZeroMountItem[]): DisableCandidate[] {
  return items.map((item) => ({
    type: "disable",
    params: {
      id: item.id,
      reason: `零挂载末级（${item.branchDead ? "整支无货枯枝" : "单独裸奔，兄弟合计挂载 " + item.siblingMountTotal}${item.generic ? "，杂类词表命中" : ""}），建议禁用`,
    },
    evidence: {
      kind: "零挂载扫描",
      path: item.path,
      siblingMounts: Object.fromEntries(item.siblings.map((sibling) => [sibling.name, sibling.mount])),
      siblingMountTotal: item.siblingMountTotal,
      branchDead: item.branchDead,
      generic: item.generic,
    },
  }));
}

/** 超过全量阈值时的确定性抽样：按路径排序后等距取 n 条，覆盖全树各域。 */
export function sampleEvenly<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  const step = items.length / n;
  return Array.from({ length: n }, (_, index) => items[Math.floor(index * step)]!);
}
