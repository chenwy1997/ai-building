import { toStdText } from "../category_attributes_governance/context.ts";
import { hash } from "../category_attributes_governance/storage.ts";
import type { Category } from "../category_attributes_governance/types.ts";
import type {
  AddParams,
  CategoryOp,
  DisableParams,
  MergeParams,
  MoveParams,
  OpType,
  RenameParams,
  SplitParams,
  Tombstone,
} from "./ops.ts";

/** add/split 新 id 前缀；格式 PLUS-<versionNo>-<版本内序号>，确定性可测且不与原库 id 冲突。 */
export const NEW_ID_PREFIX = "PLUS-";

/** 执行顺序：rename/move/disable 先行，merge 次之，split/add 最后；同阶段内按 opId 排序保证确定。 */
const PHASE: Record<OpType, number> = { rename: 1, move: 1, disable: 1, merge: 2, split: 3, add: 3 };

export interface LineageEntry {
  opId: string;
  kind: "add" | "split";
  sourceId: string | null;
  name: string;
}

export interface ApplyResult {
  nodes: Category[];
  tombstones: Tombstone[];
  /** old_id → new_id | "remount" | "gone"；rename/move 保 id 不进入地图。 */
  migrationMap: Record<string, string>;
  lineage: Record<string, LineageEntry>;
}

/** 由 id/parentId/name/enabled/categoryId 重算 pathIds/pathNames/isLeaf；校验无环、全连通。 */
export function materialize(nodes: Category[]): Category[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (byId.size !== nodes.length) throw new Error("类目ID重复");
  const children = new Map<string, Category[]>();
  for (const node of nodes) {
    const parent = node.parentId ?? "";
    children.set(parent, [...(children.get(parent) ?? []), node]);
  }
  const ordered = (list: Category[]) => [...list].sort((a, b) => a.id.localeCompare(b.id));
  const result: Category[] = [];
  const visiting = new Set<string>();
  const visit = (node: Category, pathIds: string[], pathNames: string[]): void => {
    if (visiting.has(node.id)) throw new Error(`类目树存在环：${node.id}`);
    visiting.add(node.id);
    const ids = [...pathIds, node.id];
    const names = [...pathNames, node.name];
    const kids = ordered(children.get(node.id) ?? []);
    result.push({
      id: node.id,
      parentId: node.parentId,
      name: node.name,
      enabled: node.enabled,
      isLeaf: kids.length === 0,
      pathIds: ids,
      pathNames: names,
      categoryId: node.categoryId,
    });
    for (const kid of kids) visit(kid, ids, names);
    visiting.delete(node.id);
  };
  for (const root of ordered(nodes.filter((n) => !n.parentId || !byId.has(n.parentId)))) visit(root, [], []);
  if (result.length !== nodes.length) throw new Error("类目树存在环或不可达节点");
  return result;
}

export function treeHash(nodes: Category[]): string {
  return hash(toStdText(nodes));
}

/** 重放 split/add 的发号顺序，得到新 id → 来源 op 的血缘；纯函数，不需要树。 */
export function buildLineage(ops: readonly CategoryOp[], versionNo: number): Record<string, LineageEntry> {
  const lineage: Record<string, LineageEntry> = {};
  let seq = 0;
  const phase3 = ops
    .filter((op) => op.type === "split" || op.type === "add")
    .sort((a, b) => a.opId.localeCompare(b.opId));
  for (const op of phase3) {
    if (op.type === "split") {
      const params = op.params as SplitParams;
      for (const child of params.children) {
        seq += 1;
        lineage[`${NEW_ID_PREFIX}${versionNo}-${seq}`] = { opId: op.opId, kind: "split", sourceId: params.source, name: child.name };
      }
    } else {
      const params = op.params as AddParams;
      seq += 1;
      lineage[`${NEW_ID_PREFIX}${versionNo}-${seq}`] = { opId: op.opId, kind: "add", sourceId: null, name: params.name };
    }
  }
  return lineage;
}

/**
 * 在内存树上应用一批 op。任何校验失败都抛「整批拒绝」并附全部原因；调用方丢弃结果即可，不落库。
 * 铁律：id 只在 rename/move 下存活；墓碑 id 永不复活、永不复用（终态 op 独占 id，冲突即拒绝）。
 */
export function applyOps(baseNodes: Category[], ops: readonly CategoryOp[], versionNo: number): ApplyResult {
  if (ops.length === 0) throw new Error("没有可应用的 op");
  const byId = new Map<string, Category>();
  for (const node of baseNodes) byId.set(node.id, { ...node });

  // 冲突预检：终态 op（disable / merge 非存续源 / split 源）独占 id，且不得与同批其他 op 触及同一 id。
  const conflicts: string[] = [];
  const terminal = new Map<string, string>();
  const touched = new Map<string, string[]>();
  const markTouched = (id: string, opId: string): void => {
    touched.set(id, [...(touched.get(id) ?? []), opId]);
  };
  const markTerminal = (id: string, opId: string): void => {
    const existing = terminal.get(id);
    if (existing && existing !== opId) conflicts.push(`类目 ${id} 被多个终态 op 操作：${existing}、${opId}`);
    else terminal.set(id, opId);
  };
  for (const op of ops) {
    switch (op.type) {
      case "rename":
      case "move":
        markTouched((op.params as RenameParams | MoveParams).id, op.opId);
        break;
      case "disable":
        markTerminal((op.params as DisableParams).id, op.opId);
        break;
      case "merge": {
        const params = op.params as MergeParams;
        for (const source of new Set(params.sources)) if (source !== params.target) markTerminal(source, op.opId);
        if (params.target) markTouched(params.target, op.opId);
        break;
      }
      case "split":
        markTerminal((op.params as SplitParams).source, op.opId);
        break;
      case "add":
        break;
    }
  }
  for (const [id, opId] of terminal) {
    const others = (touched.get(id) ?? []).filter((candidate) => candidate !== opId);
    if (others.length > 0) conflicts.push(`类目 ${id} 同时被终态 op ${opId} 与 ${others.join("、")} 触及`);
  }
  if (conflicts.length > 0) {
    throw new Error(`整批拒绝：\n${conflicts.map((line) => `op 冲突：${line}`).join("\n")}`);
  }

  const childCounts = new Map<string, number>();
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      childCounts.set(node.parentId, (childCounts.get(node.parentId) ?? 0) + 1);
    }
  }
  const bump = (parentId: string | null, delta: number): void => {
    if (parentId) childCounts.set(parentId, (childCounts.get(parentId) ?? 0) + delta);
  };
  const isLeafNow = (id: string): boolean => (childCounts.get(id) ?? 0) === 0;
  const isDescendantOf = (ancestorId: string, id: string): boolean => {
    let current = byId.get(id)?.parentId ?? null;
    while (current) {
      if (current === ancestorId) return true;
      current = byId.get(current)?.parentId ?? null;
    }
    return false;
  };

  const tombstones: Tombstone[] = [];
  const migrationMap: Record<string, string> = {};
  const lineage: Record<string, LineageEntry> = {};
  let seq = 0;
  const issueId = (): string => {
    seq += 1;
    const id = `${NEW_ID_PREFIX}${versionNo}-${seq}`;
    if (byId.has(id)) throw new Error(`新 id 与既有类目冲突：${id}`);
    return id;
  };
  const mustNode = (id: string): Category => {
    const node = byId.get(id);
    if (!node) throw new Error(`类目不存在：${id}`);
    return node;
  };

  const sorted = [...ops].sort((a, b) => PHASE[a.type] - PHASE[b.type] || a.opId.localeCompare(b.opId));
  const errors: string[] = [];
  for (const op of sorted) {
    try {
      switch (op.type) {
        case "rename": {
          const params = op.params as RenameParams;
          const node = mustNode(params.id);
          if (!params.name?.trim()) throw new Error("name 不能为空");
          node.name = params.name.trim();
          break;
        }
        case "move": {
          const params = op.params as MoveParams;
          const node = mustNode(params.id);
          const parent = mustNode(params.parentId);
          if (params.parentId === params.id) throw new Error("不能移动到自身");
          if (isDescendantOf(params.id, params.parentId)) throw new Error(`移动到自身后代会形成环：${params.parentId}`);
          if (!parent.enabled) throw new Error(`目标父级已禁用：${params.parentId}`);
          bump(node.parentId, -1);
          node.parentId = params.parentId;
          bump(params.parentId, 1);
          break;
        }
        case "disable": {
          const params = op.params as DisableParams;
          const node = mustNode(params.id);
          node.enabled = false;
          tombstones.push({ oldId: params.id, newId: null, opId: op.opId, reason: params.reason || "disable" });
          migrationMap[params.id] = "gone";
          break;
        }
        case "merge": {
          const params = op.params as MergeParams;
          if (!params.target) throw new Error("merge 必须指定 target（存续者）");
          const target = mustNode(params.target);
          if (!target.enabled) throw new Error(`merge 目标已禁用：${params.target}`);
          const losers = [...new Set(params.sources)].filter((source) => source !== params.target);
          if (losers.length === 0) throw new Error("merge 至少需要一个非目标源");
          // loser 分两类：末级（常规合并）与 target 的祖先（空壳中间层父子合并，孩子整体上移一层）
          const ancestorLosers: string[] = [];
          const leafLosers: string[] = [];
          for (const loser of losers) {
            mustNode(loser);
            if (isDescendantOf(loser, params.target)) ancestorLosers.push(loser);
            else if (isLeafNow(loser)) leafLosers.push(loser);
            else throw new Error(`merge 只作用于末级类目：${loser}`);
          }
          if (leafLosers.length > 0 && !isLeafNow(target.id)) throw new Error(`merge 只作用于末级类目：${target.id}`);
          const reason = params.reason || `合并入 ${params.target}`;
          for (const loser of ancestorLosers) {
            const node = byId.get(loser)!;
            for (const child of byId.values()) {
              if (child.parentId !== loser) continue;
              bump(loser, -1);
              child.parentId = node.parentId;
              bump(node.parentId, 1);
            }
            bump(node.parentId, -1);
            byId.delete(loser);
            tombstones.push({ oldId: loser, newId: params.target, opId: op.opId, reason });
            migrationMap[loser] = params.target;
          }
          for (const loser of leafLosers) {
            bump(byId.get(loser)?.parentId ?? null, -1);
            byId.delete(loser);
            tombstones.push({ oldId: loser, newId: params.target, opId: op.opId, reason });
            migrationMap[loser] = params.target;
          }
          break;
        }
        case "split": {
          const params = op.params as SplitParams;
          const source = mustNode(params.source);
          if (!isLeafNow(params.source)) throw new Error(`split 只作用于末级类目：${params.source}`);
          if (!Array.isArray(params.children) || params.children.length < 2) throw new Error("split 至少需要两个子类目");
          const parentId = source.parentId;
          byId.delete(params.source);
          bump(parentId, -1);
          for (const child of params.children) {
            if (!child.name?.trim()) throw new Error("split 子类目 name 不能为空");
            const id = issueId();
            byId.set(id, {
              id, parentId, name: child.name.trim(), enabled: true,
              isLeaf: true, pathIds: [], pathNames: [], categoryId: child.categoryId ?? null,
            });
            bump(parentId, 1);
            lineage[id] = { opId: op.opId, kind: "split", sourceId: params.source, name: child.name.trim() };
          }
          tombstones.push({ oldId: params.source, newId: null, opId: op.opId, reason: params.reason || `拆分为 ${params.children.length} 个类目` });
          migrationMap[params.source] = "gone";
          break;
        }
        case "add": {
          const params = op.params as AddParams;
          const parent = mustNode(params.parentId);
          if (!parent.enabled) throw new Error(`父级已禁用：${params.parentId}`);
          if (!params.name?.trim()) throw new Error("add 的 name 不能为空");
          const id = issueId();
          byId.set(id, {
            id, parentId: params.parentId, name: params.name.trim(), enabled: true,
            isLeaf: true, pathIds: [], pathNames: [], categoryId: params.categoryId ?? null,
          });
          bump(params.parentId, 1);
          lineage[id] = { opId: op.opId, kind: "add", sourceId: null, name: params.name.trim() };
          break;
        }
      }
    } catch (error) {
      errors.push(`${op.opId}（${op.type}）：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`整批拒绝，${errors.length} 个 op 校验失败：\n${errors.join("\n")}`);
  }
  return { nodes: materialize([...byId.values()]), tombstones, migrationMap, lineage };
}
