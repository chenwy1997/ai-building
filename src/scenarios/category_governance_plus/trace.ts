import type { Tombstone } from "./ops.ts";

/** 旧类目可追溯：墓碑链式解析 + trace 报告渲染，纯函数，与 DB 解耦。 */

export interface TombstoneHop {
  oldId: string;
  newId: string | null;
  opId: string;
  reason: string;
}

export interface TombstoneResolution {
  /** alive 时为最终存活节点 id；gone（disable/split 无 new_id）时为 null */
  finalId: string | null;
  hops: TombstoneHop[];
  status: "alive" | "gone";
}

/**
 * 沿 new_id 链走到最终节点：末端无墓碑 → alive；某跳 new_id 为空（disable/split）→ gone。
 * 异常数据成环时抛错而非死循环。
 */
export function resolveTombstone(tombstones: Tombstone[], oldId: string): TombstoneResolution {
  const byOld = new Map(tombstones.map((tombstone) => [tombstone.oldId, tombstone]));
  const hops: TombstoneHop[] = [];
  const visited = new Set<string>([oldId]);
  let current = oldId;
  for (;;) {
    const hop = byOld.get(current);
    if (!hop) return { finalId: current, hops, status: "alive" };
    hops.push({ oldId: hop.oldId, newId: hop.newId, opId: hop.opId, reason: hop.reason });
    if (hop.newId === null) return { finalId: null, hops, status: "gone" };
    if (visited.has(hop.newId)) {
      throw new Error(`墓碑链成环：${[...visited, hop.newId].join(" → ")}`);
    }
    visited.add(hop.newId);
    current = hop.newId;
  }
}

export interface ResolvedMigration {
  finalId: string | null;
  status: "alive" | "gone";
  hops: number;
}

export interface ResolvedMigrationMap {
  /** oldId → 最终存活 id | "gone"（商品迁移直接按此走） */
  map: Record<string, string>;
  /** oldId → 解析细节（跳数、落点、状态） */
  chains: Record<string, ResolvedMigration>;
}

/**
 * 版本 diff 的墓碑（own）沿全量墓碑链解析到最终落点：
 * A→B 之后 B→C 时，地图输出 A→C 而不是 A→B。
 */
export function resolveMigrationMap(own: Tombstone[], all: Tombstone[]): ResolvedMigrationMap {
  const map: Record<string, string> = {};
  const chains: Record<string, ResolvedMigration> = {};
  for (const tombstone of own) {
    const resolution = resolveTombstone(all, tombstone.oldId);
    chains[tombstone.oldId] = {
      finalId: resolution.finalId,
      status: resolution.status,
      hops: resolution.hops.length,
    };
    map[tombstone.oldId] = resolution.status === "alive" ? resolution.finalId! : "gone";
  }
  return { map, chains };
}

export interface TraceVersionState {
  versionNo: number;
  present: boolean;
  enabled?: boolean;
  path?: string[];
}

export interface TraceHopView {
  oldId: string;
  oldName: string | null;
  newId: string | null;
  newName: string | null;
  opType: string;
  /** 该跳物化出的版本号 */
  versionNo: number;
  decidedAt: string | null;
  reason: string;
}

export interface TraceReport {
  id: string;
  versions: TraceVersionState[];
  hops: TraceHopView[];
  finalStatus: "alive" | "gone" | "never";
  finalPath?: string[];
  goneReason?: string;
}

export function renderTrace(report: TraceReport): string[] {
  if (report.finalStatus === "never") {
    return [`追溯 ${report.id}：该类目 id 从未在任何版本出现（也不是任何墓碑的 oldId），请核对 id`];
  }
  const lines: string[] = [`追溯 ${report.id}：`, `版本状态：`];
  for (const state of report.versions) {
    lines.push(state.present
      ? `  v${state.versionNo}：存在（${state.enabled ? "enabled" : "禁用"}），路径 ${(state.path ?? []).join(" > ")}`
      : `  v${state.versionNo}：不存在`);
  }
  if (report.hops.length === 0) {
    lines.push(`无墓碑：当前仍存活，路径 ${(report.finalPath ?? []).join(" > ")}`);
    return lines;
  }
  lines.push(`去向链：`);
  for (const hop of report.hops) {
    const target = hop.newId === null ? "（下线）" : `${hop.newId}(${hop.newName ?? "?"})`;
    lines.push(
      `  ${hop.oldId}(${hop.oldName ?? "?"}) → ${target}［${hop.opType}，物化于 v${hop.versionNo}${hop.decidedAt ? `，${hop.decidedAt}` : ""}］`,
    );
  }
  if (report.finalStatus === "alive") {
    lines.push(`最终：alive → 当前路径 ${(report.finalPath ?? []).join(" > ")}`);
  } else {
    lines.push(`最终：gone（${report.goneReason ?? "下线原因未知"}）`);
  }
  return lines;
}
