import type { SQL } from "bun";
import type { Category } from "../category_attributes_governance/types.ts";
import { materialize } from "./engine.ts";
import type { CategoryOp, OpParams, OpType, Tombstone } from "./ops.ts";
import { resolveMigrationMap } from "./trace.ts";
import type { ResolvedMigrationMap } from "./trace.ts";

export interface VersionRow {
  version_no: number;
  base_version_no: number | null;
  applied_op_count: number;
  tree_hash: string;
  node_count: number;
  leaf_count: number;
  note: string | null;
  created_at: string;
}

interface OpRow {
  op_id: string;
  type: OpType;
  params: OpParams | string;
  evidence: unknown;
}

// bun:sql 把 jsonb 列作为字符串返回，读取侧统一解析。
const parseJson = (value: unknown): unknown =>
  typeof value === "string" ? JSON.parse(value) : value;

const toOp = (row: OpRow): CategoryOp => ({
  opId: row.op_id,
  type: row.type,
  params: parseJson(row.params) as OpParams,
  evidence: parseJson(row.evidence),
});

export async function latestVersionNo(database: SQL): Promise<number | null> {
  const rows = await database<Array<{ max: number | null }>>`
    SELECT MAX(version_no) AS max FROM category_versions
  `;
  return rows[0]?.max ?? null;
}

export async function insertVersion(
  database: SQL,
  row: { versionNo: number; baseVersionNo: number | null; appliedOpCount: number; treeHash: string; nodeCount: number; leafCount: number; note: string | null },
): Promise<void> {
  await database`
    INSERT INTO category_versions (version_no, base_version_no, applied_op_count, tree_hash, node_count, leaf_count, note)
    VALUES (${row.versionNo}, ${row.baseVersionNo}, ${row.appliedOpCount}, ${row.treeHash}, ${row.nodeCount}, ${row.leafCount}, ${row.note})
  `;
}

export async function insertVersionNodes(database: SQL, versionNo: number, nodes: Category[]): Promise<void> {
  for (const node of nodes) {
    await database`
      INSERT INTO category_version_nodes (version_no, node_id, parent_id, name, path_json, enabled, is_leaf, category_id)
      VALUES (${versionNo}, ${node.id}, ${node.parentId}, ${node.name}, ${JSON.stringify(node.pathNames)}::jsonb,
              ${node.enabled}, ${node.isLeaf}, ${node.categoryId})
    `;
  }
}

export async function loadVersionNodes(database: SQL, versionNo: number): Promise<Category[]> {
  const rows = await database<Array<{ node_id: string; parent_id: string | null; name: string; enabled: boolean; category_id: string | null }>>`
    SELECT node_id, parent_id, name, enabled, category_id
    FROM category_version_nodes WHERE version_no = ${versionNo}
  `;
  if (rows.length === 0) throw new Error(`版本不存在或没有节点：v${versionNo}`);
  return materialize(rows.map((row) => ({
    id: row.node_id,
    parentId: row.parent_id,
    name: row.name,
    enabled: row.enabled,
    isLeaf: false,
    pathIds: [],
    pathNames: [],
    categoryId: row.category_id,
  })));
}

export async function insertTombstones(database: SQL, tombstones: Tombstone[]): Promise<void> {
  for (const tombstone of tombstones) {
    // 墓碑 id 永不复活、永不复用；重复写入说明上游校验有漏洞，直接忽略保留首条。
    await database`
      INSERT INTO category_tombstones (old_id, new_id, op_id, reason)
      VALUES (${tombstone.oldId}, ${tombstone.newId}, ${tombstone.opId}, ${tombstone.reason})
      ON CONFLICT (old_id) DO NOTHING
    `;
  }
}

export async function approvedOps(database: SQL): Promise<CategoryOp[]> {
  const rows = await database<OpRow[]>`
    SELECT op_id, type, params, evidence FROM category_ops
    WHERE status = 'approved' ORDER BY created_at, op_id
  `;
  return rows.map(toOp);
}

/** 产出某个类目版本的 op（applied 时 base_version_no 会被更新为该版本的基线）。 */
export async function appliedOpsForBase(database: SQL, baseVersionNo: number): Promise<CategoryOp[]> {
  const rows = await database<OpRow[]>`
    SELECT op_id, type, params, evidence FROM category_ops
    WHERE status = 'applied' AND base_version_no = ${baseVersionNo}
    ORDER BY created_at, op_id
  `;
  return rows.map(toOp);
}

export async function tombstonesForBase(database: SQL, baseVersionNo: number): Promise<Tombstone[]> {
  const rows = await database<Array<{ old_id: string; new_id: string | null; op_id: string; reason: string }>>`
    SELECT t.old_id, t.new_id, t.op_id, t.reason
    FROM category_tombstones t JOIN category_ops o ON o.op_id = t.op_id
    WHERE o.base_version_no = ${baseVersionNo}
    ORDER BY t.old_id
  `;
  return rows.map((row) => ({ oldId: row.old_id, newId: row.new_id, opId: row.op_id, reason: row.reason }));
}

/** 全量墓碑（链式解析用，不限定版本）。 */
export async function allTombstones(database: SQL): Promise<Tombstone[]> {
  const rows = await database<Array<{ old_id: string; new_id: string | null; op_id: string; reason: string }>>`
    SELECT old_id, new_id, op_id, reason FROM category_tombstones ORDER BY old_id
  `;
  return rows.map((row) => ({ oldId: row.old_id, newId: row.new_id, opId: row.op_id, reason: row.reason }));
}

export interface TombstoneWithOp extends Tombstone {
  opType: OpType;
  /** 墓碑物化出的版本号（op 基线 +1） */
  versionNo: number;
  decidedAt: string | null;
}

/** 全量墓碑联上 op 元信息（trace 去向链展示用）。 */
export async function allTombstonesWithOps(database: SQL): Promise<TombstoneWithOp[]> {
  const rows = await database<Array<{ old_id: string; new_id: string | null; op_id: string; reason: string; type: OpType; base_version_no: number; decided_at: string | null }>>`
    SELECT t.old_id, t.new_id, t.op_id, t.reason, o.type, o.base_version_no, o.decided_at
    FROM category_tombstones t JOIN category_ops o ON o.op_id = t.op_id
    ORDER BY t.old_id
  `;
  return rows.map((row) => ({
    oldId: row.old_id, newId: row.new_id, opId: row.op_id, reason: row.reason,
    opType: row.type, versionNo: row.base_version_no + 1,
    decidedAt: row.decided_at === null ? null : String(row.decided_at),
  }));
}

export interface VersionPresence {
  versionNo: number;
  name: string;
  enabled: boolean;
  path: string[];
}

/** 某 id 在各版本中的存在状态（不存在的版本由调用方按版本表补齐）。 */
export async function versionPresence(database: SQL, nodeId: string): Promise<VersionPresence[]> {
  const rows = await database<Array<{ version_no: number; name: string; enabled: boolean; path_json: string }>>`
    SELECT version_no, name, enabled, path_json
    FROM category_version_nodes WHERE node_id = ${nodeId} ORDER BY version_no
  `;
  return rows.map((row) => ({
    versionNo: row.version_no,
    name: row.name,
    enabled: row.enabled,
    path: parseJson(row.path_json) as string[],
  }));
}

export async function allVersionNos(database: SQL): Promise<number[]> {
  const rows = await database<Array<{ version_no: number }>>`
    SELECT version_no FROM category_versions ORDER BY version_no
  `;
  return rows.map((row) => row.version_no);
}

/** 某 id 最近一次出现时的名称（trace 链路展示用）；从未出现返回 null。 */
export async function latestNameOf(database: SQL, nodeId: string): Promise<string | null> {
  const rows = await database<Array<{ name: string }>>`
    SELECT name FROM category_version_nodes WHERE node_id = ${nodeId}
    ORDER BY version_no DESC LIMIT 1
  `;
  return rows[0]?.name ?? null;
}

/** 某版本相对其基线的迁移地图：链式解析到最终存活节点（A→B→C 输出 A→C），并保留 hops 信息。 */
export async function migrationMapForVersion(database: SQL, versionNo: number): Promise<ResolvedMigrationMap> {
  const own = await tombstonesForBase(database, versionNo - 1);
  const all = await allTombstones(database);
  return resolveMigrationMap(own, all);
}
