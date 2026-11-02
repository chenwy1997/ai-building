import type { Category } from "../category_attributes_governance/types.ts";
import type { OpParams, OpType } from "./ops.ts";

/** 树内治理审计：不依赖商品证据、不依赖 AI，纯函数，输入最新版本树，产出 ops.json 候选 + markdown 报告。 */

export interface AuditCandidate {
  type: OpType;
  params: OpParams;
  evidence: Record<string, unknown>;
}

export interface AuditSummary {
  duplicateMerges: number;
  shellMerges: number;
  bracketVariantGroups: number;
  genericNameNodes: number;
  disabledNodes: number;
  deepNodes: number;
  mixedDepthParents: number;
}

export interface AuditResult {
  ops: AuditCandidate[];
  report: string;
  summary: AuditSummary;
}

export const GENERIC_NAME_WORDS = ["其他", "其它", "通用", "万能", "各种", "杂项", "特殊商品", "特殊用品"];

/** 类目名归一化：全角→半角、去空白、括号统一、大小写折叠。 */
export function normalizeCategoryName(name: string): string {
  let text = "";
  for (const ch of name) {
    const code = ch.codePointAt(0)!;
    if (code === 0x3000) {
      text += " ";
      continue;
    }
    // U+FF01–U+FF5E 全角ASCII ↔ U+0021–U+007E
    if (code >= 0xff01 && code <= 0xff5e) {
      text += String.fromCodePoint(code - 0xfee0);
      continue;
    }
    text += ch;
  }
  return text
    .replace(/[（【[]/gu, "(")
    .replace(/[）】\]]/gu, ")")
    .replace(/\s+/gu, "")
    .toLowerCase();
}

/** 去掉尾部括号组的主干名（「插电式热风器（标准型）」→「插电式热风器」）。 */
const bracketStem = (name: string): string =>
  normalizeCategoryName(name).replace(/(\([^()]*\))+$/u, "");

interface IndexedTree {
  scoped: Category[];
  byId: Map<string, Category>;
  allChildren: Map<string, Category[]>;
  enabledChildren: Map<string, Category[]>;
  subtreeSize: (id: string) => number;
  enabledLeafCount: (id: string) => number;
}

function indexTree(nodes: Category[], scope: Category | null): IndexedTree {
  const scoped = scope ? nodes.filter((node) => node.pathIds.includes(scope.id)) : nodes;
  const byId = new Map(scoped.map((node) => [node.id, node]));
  const allChildren = new Map<string, Category[]>();
  const enabledChildren = new Map<string, Category[]>();
  for (const node of scoped) {
    if (!node.parentId || !byId.has(node.parentId)) continue;
    allChildren.set(node.parentId, [...(allChildren.get(node.parentId) ?? []), node]);
    if (node.enabled) enabledChildren.set(node.parentId, [...(enabledChildren.get(node.parentId) ?? []), node]);
  }
  const sizes = new Map<string, number>();
  const subtreeSize = (id: string): number => {
    const cached = sizes.get(id);
    if (cached !== undefined) return cached;
    sizes.set(id, 0);
    let size = 0;
    for (const child of allChildren.get(id) ?? []) size += 1 + subtreeSize(child.id);
    sizes.set(id, size);
    return size;
  };
  const leafCounts = new Map<string, number>();
  const enabledLeafCount = (id: string): number => {
    const cached = leafCounts.get(id);
    if (cached !== undefined) return cached;
    leafCounts.set(id, 0);
    let count = 0;
    for (const child of enabledChildren.get(id) ?? []) {
      count += child.isLeaf ? 1 : enabledLeafCount(child.id);
    }
    leafCounts.set(id, count);
    return count;
  };
  return { scoped, byId, allChildren, enabledChildren, subtreeSize, enabledLeafCount };
}

const nodeRef = (node: Category, tree: IndexedTree): Record<string, unknown> => ({
  id: node.id,
  path: node.pathNames,
  enabled: node.enabled,
  isLeaf: node.isLeaf,
  subtreeSize: tree.subtreeSize(node.id),
});

export function auditTree(nodes: Category[], scope: Category | null = null): AuditResult {
  const tree = indexTree(nodes, scope);
  const { scoped, enabledChildren } = tree;
  const ops: AuditCandidate[] = [];
  const used = new Set<string>();

  // 1. 归一化重名：同名 enabled 末级 → merge（强信号；存续者取路径浅者，并列取 id 小者）
  // 杂类命名的「同名」是占位语义而非重复，缺商品证据不出 op，只进第 4 节 review
  const byNormalized = new Map<string, Category[]>();
  for (const node of scoped) {
    if (!node.enabled || !node.isLeaf) continue;
    if (GENERIC_NAME_WORDS.some((word) => node.name.includes(word))) continue;
    const normalized = normalizeCategoryName(node.name);
    if (!normalized) continue;
    byNormalized.set(normalized, [...(byNormalized.get(normalized) ?? []), node]);
  }
  const duplicateGroups = [...byNormalized.entries()]
    .filter(([, members]) => members.length >= 2)
    .map(([name, members]) => {
      const sorted = [...members].sort(
        (a, b) => a.pathIds.length - b.pathIds.length || a.id.localeCompare(b.id),
      );
      return {
        name,
        members: sorted,
        target: sorted[0]!,
        sameParent: members.every((member) => member.parentId === members[0]!.parentId),
      };
    })
    .sort((a, b) => b.members.length - a.members.length || a.name.localeCompare(b.name));
  for (const group of duplicateGroups) {
    for (const member of group.members) used.add(member.id);
    ops.push({
      type: "merge",
      params: {
        sources: group.members.map((member) => member.id),
        target: group.target.id,
        reason: `归一化重名「${group.name}」：${group.members.length} 个 enabled 末级同名，建议并入路径更浅的 ${group.target.pathNames.join(" > ")}`,
      },
      evidence: {
        kind: "归一化重名",
        normalizedName: group.name,
        sameParent: group.sameParent,
        nodes: group.members.map((member) => nodeRef(member, tree)),
      },
    });
  }

  // 2. 空壳中间层：enabled 非叶节点只有 1 个 enabled 孩子 → 父子合并，存续者=子
  const shells = scoped
    .filter((node) => node.enabled && !node.isLeaf && (enabledChildren.get(node.id) ?? []).length === 1)
    .map((node) => ({ node, child: enabledChildren.get(node.id)![0]! }))
    .sort((a, b) => a.node.pathIds.join("/").localeCompare(b.node.pathIds.join("/")));
  const shellOps: AuditCandidate[] = [];
  const skippedShells: string[] = [];
  for (const { node, child } of shells) {
    // 与重名合并或链上已候选的空壳冲突时跳过，避免 apply 整批拒绝
    if (used.has(node.id) || used.has(child.id)) {
      skippedShells.push(node.pathNames.join(" > "));
      continue;
    }
    used.add(node.id);
    used.add(child.id);
    shellOps.push({
      type: "merge",
      params: {
        sources: [node.id, child.id],
        target: child.id,
        reason: `空壳中间层：仅有 1 个 enabled 孩子，建议父子合并，存续者=${child.name}`,
      },
      evidence: {
        kind: "空壳中间层",
        nodes: [nodeRef(node, tree), nodeRef(child, tree)],
        disabledChildren: (tree.allChildren.get(node.id) ?? [])
          .filter((sibling) => !sibling.enabled)
          .map((sibling) => nodeRef(sibling, tree)),
      },
    });
  }
  ops.push(...shellOps);

  // 3. 括号变体近似名（同级、主干相同、括号后缀不同）→ 只进 review，不出 op
  const variantGroups = new Map<string, Category[]>();
  for (const node of scoped) {
    if (!node.enabled || !node.isLeaf) continue;
    const stem = bracketStem(node.name);
    if (!stem || stem === normalizeCategoryName(node.name)) continue;
    const key = `${node.parentId ?? ""} ${stem}`;
    variantGroups.set(key, [...(variantGroups.get(key) ?? []), node]);
  }
  const variants = [...variantGroups.values()]
    .filter((members) => members.length >= 2
      && new Set(members.map((member) => normalizeCategoryName(member.name))).size >= 2)
    .sort((a, b) => a[0]!.pathIds.join("/").localeCompare(b[0]!.pathIds.join("/")));

  // 4. 杂类命名 → 只进 review，附挂载统计
  const genericNodes = scoped
    .filter((node) => node.enabled && GENERIC_NAME_WORDS.some((word) => node.name.includes(word)))
    .sort((a, b) => a.pathIds.join("/").localeCompare(b.pathIds.join("/")));

  // 5. 统计：禁用节点 / 深度异常（>5 层；同父孩子深度不一）
  const disabled = scoped.filter((node) => !node.enabled)
    .sort((a, b) => a.pathIds.join("/").localeCompare(b.pathIds.join("/")));
  const deep = scoped.filter((node) => node.pathIds.length > 5)
    .sort((a, b) => a.pathIds.join("/").localeCompare(b.pathIds.join("/")));
  const mixedDepth = [...enabledChildren.entries()]
    .filter(([, kids]) => kids.length >= 2 && kids.some((kid) => kid.isLeaf) && kids.some((kid) => !kid.isLeaf))
    .map(([parentId, kids]) => ({ parent: tree.byId.get(parentId)!, kids }))
    .sort((a, b) => a.parent.pathIds.join("/").localeCompare(b.parent.pathIds.join("/")));

  const summary: AuditSummary = {
    duplicateMerges: duplicateGroups.length,
    shellMerges: shellOps.length,
    bracketVariantGroups: variants.length,
    genericNameNodes: genericNodes.length,
    disabledNodes: disabled.length,
    deepNodes: deep.length,
    mixedDepthParents: mixedDepth.length,
  };

  const lines: string[] = [
    `# audit 树内治理报告`,
    ``,
    `范围：${scope ? scope.pathNames.join(" > ") : "全树"}`,
    `节点 ${scoped.length}，enabled 末级 ${scoped.filter((n) => n.enabled && n.isLeaf).length}，禁用 ${disabled.length}`,
    ``,
    `## merge 候选：归一化重名（${summary.duplicateMerges}，按证据强度排序）`,
    ``,
  ];
  for (const group of duplicateGroups) {
    lines.push(
      `- 「${group.name}」×${group.members.length}${group.sameParent ? "（同级）" : "（跨分支）"} → 存续者 \`${group.target.pathNames.join(" > ")}\``,
      ...group.members.map((member) => `  - ${member.id} ${member.pathNames.join(" > ")}${member.id === group.target.id ? " ← target" : ""}`),
    );
  }
  lines.push(``, `## merge 候选：空壳中间层（${summary.shellMerges}）`, ``);
  for (const op of shellOps) {
    const nodesInfo = op.evidence.nodes as Array<{ path: string[] }>;
    lines.push(`- ${nodesInfo.map((info) => `\`${info.path.join(" > ")}\``).join(" ⊂ ")}（存续者=子）`);
  }
  if (skippedShells.length > 0) {
    lines.push(``, `因与其他候选冲突跳过的空壳 ${skippedShells.length} 个：${skippedShells.slice(0, 5).map((path) => `\`${path}\``).join("、")}${skippedShells.length > 5 ? " 等" : ""}`);
  }
  lines.push(``, `## review：括号变体近似名（${summary.bracketVariantGroups}，合法区分维度，只确认命名规范）`, ``);
  for (const members of variants) {
    lines.push(`- ${members.map((member) => `\`${member.pathNames.at(-1)}\``).join(" vs ")}（${members[0]!.pathNames.slice(0, -1).join(" > ")} 下）`);
  }
  lines.push(``, `## review：杂类命名（${summary.genericNameNodes}，缺商品证据不擅自处置）`, ``);
  for (const node of genericNodes) {
    lines.push(`- \`${node.pathNames.join(" > ")}\`：enabled 子类 ${(enabledChildren.get(node.id) ?? []).length} 个，enabled 末级后代 ${tree.enabledLeafCount(node.id)} 个`);
  }
  lines.push(``, `## 统计：禁用节点（${summary.disabledNodes}）`, ``);
  for (const node of disabled.slice(0, 20)) lines.push(`- \`${node.pathNames.join(" > ")}\``);
  if (disabled.length > 20) lines.push(`- …等 ${disabled.length} 个`);
  lines.push(``, `## 统计：深度异常（超深 ${summary.deepNodes}，同父深度不一 ${summary.mixedDepthParents}）`, ``);
  for (const node of deep.slice(0, 10)) lines.push(`- 超深（${node.pathIds.length} 层）：\`${node.pathNames.join(" > ")}\``);
  if (deep.length > 10) lines.push(`- …等 ${deep.length} 个`);
  for (const { parent, kids } of mixedDepth.slice(0, 10)) {
    lines.push(`- 深度不一：\`${parent.pathNames.join(" > ")}\` 下叶子 ${kids.filter((kid) => kid.isLeaf).length} 个、分支 ${kids.filter((kid) => !kid.isLeaf).length} 个`);
  }
  if (mixedDepth.length > 10) lines.push(`- …等 ${mixedDepth.length} 个`);
  lines.push(``, `---`, `ops.json：merge ${ops.length} 条（重名 ${summary.duplicateMerges}，空壳 ${summary.shellMerges}）`);

  return { ops, report: `${lines.join("\n")}\n`, summary };
}
