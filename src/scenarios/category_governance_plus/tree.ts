import type { Category } from "../category_attributes_governance/types.ts";

/** 类目子树渲染：纯函数，与 DB/ES 解耦；挂载量以 Map<id, number> 注入。 */

const LEVEL_LABELS = [
  "[根]",
  "[一级]",
  "[二级]",
  "[三级]",
  "[四级(品名)]",
  "[五级]",
  "[六级]",
  "[七级]",
  "[八级]",
  "[九级]",
  "[十级]",
];

/** 层级标注：标准类目根为 L0（[根]），其下依次为一级、二级、三级、四级(品名)、五级…… */
export function levelLabel(depth: number): string {
  return LEVEL_LABELS[depth] ?? `[L${depth}]`;
}

export interface RenderOptions {
  /** scope 节点为第 0 层，向下渲染的层数；缺省渲染全深度 */
  maxDepth?: number;
  /** 节点 id → 商品库挂载量（末级 standardCategory.id，分支 standardCategory.idPath） */
  counts?: Map<string, number>;
}

export interface RenderedTree {
  lines: string[];
  /** 实际渲染的节点 id（含 scope 自身，按渲染顺序），供 counts 取数用 */
  visibleIds: string[];
  truncatedBranches: number;
  hiddenDescendants: number;
}

export function renderSubtree(nodes: Category[], scope: Category, options: RenderOptions = {}): RenderedTree {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string, Category[]>();
  for (const node of nodes) {
    if (!node.parentId || !byId.has(node.parentId)) continue;
    children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]);
  }
  // 按码元排序而非 localeCompare：与 ICU/.locale 无关，跨机器渲染稳定
  for (const kids of children.values()) {
    kids.sort((a, b) => (a.name === b.name ? a.id.localeCompare(b.id) : a.name < b.name ? -1 : 1));
  }
  const sizes = new Map<string, number>();
  const descendantCount = (id: string): number => {
    const cached = sizes.get(id);
    if (cached !== undefined) return cached;
    sizes.set(id, 0);
    let size = 0;
    for (const kid of children.get(id) ?? []) size += 1 + descendantCount(kid.id);
    sizes.set(id, size);
    return size;
  };

  const lines: string[] = [];
  const visibleIds: string[] = [];
  let truncatedBranches = 0;
  let hiddenDescendants = 0;
  const walk = (node: Category, displayDepth: number): void => {
    visibleIds.push(node.id);
    const count = options.counts?.get(node.id);
    let text = `${"  ".repeat(displayDepth)}${levelLabel(node.pathIds.length - 1)}${node.name}`
      + `${node.enabled ? "" : "（禁用）"}${count === undefined ? "" : `（挂载 ${count}）`}`;
    const kids = children.get(node.id) ?? [];
    if (kids.length > 0 && options.maxDepth !== undefined && displayDepth >= options.maxDepth) {
      const hidden = descendantCount(node.id);
      text += ` …(+${hidden} 个后代)`;
      truncatedBranches += 1;
      hiddenDescendants += hidden;
    }
    lines.push(text);
    if (kids.length === 0 || (options.maxDepth !== undefined && displayDepth >= options.maxDepth)) return;
    for (const kid of kids) walk(kid, displayDepth + 1);
  };
  walk(scope, 0);
  return { lines, visibleIds, truncatedBranches, hiddenDescendants };
}
