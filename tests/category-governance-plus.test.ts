import { describe, expect, test } from "bun:test";
import { applyOps, buildLineage, materialize, NEW_ID_PREFIX, treeHash } from "../src/scenarios/category_governance_plus/engine.ts";
import { validateOpShape } from "../src/scenarios/category_governance_plus/ops.ts";
import type { CategoryOp } from "../src/scenarios/category_governance_plus/ops.ts";
import type { Category } from "../src/scenarios/category_attributes_governance/types.ts";

const node = (id: string, parentId: string | null, name = id, enabled = true): Category => ({
  id, parentId, name, enabled, isLeaf: false, pathIds: [], pathNames: [], categoryId: null,
});

/** root └─ tools ├─ drill ├─ hammer ├─ saw ├─ pliers ├─ wrench └─ grinder */
const baseTree = (): Category[] => materialize([
  node("root", null, "标准类目"),
  node("tools", "root", "五金工具"),
  node("drill", "tools", "电钻"),
  node("hammer", "tools", "锤子"),
  node("saw", "tools", "锯子"),
  node("pliers", "tools", "钳子"),
  node("wrench", "tools", "扳手"),
  node("grinder", "tools", "角磨机"),
]);

const byId = (nodes: Category[], id: string): Category => {
  const found = nodes.find((n) => n.id === id);
  if (!found) throw new Error(`测试树缺少节点：${id}`);
  return found;
};

describe("op 式类目变更引擎", () => {
  test("rename/move 保 id，不进入迁移地图", () => {
    const result = applyOps(baseTree(), [
      { opId: "op-1", type: "rename", params: { id: "drill", name: "充电电钻" } },
      { opId: "op-2", type: "move", params: { id: "saw", parentId: "root" } },
    ], 2);
    expect(byId(result.nodes, "drill").name).toBe("充电电钻");
    expect(byId(result.nodes, "drill").pathNames).toEqual(["标准类目", "五金工具", "充电电钻"]);
    expect(byId(result.nodes, "saw").parentId).toBe("root");
    expect(result.tombstones).toEqual([]);
    expect(result.migrationMap).toEqual({});
  });

  test("move 校验无环：移动到自身后代整批拒绝", () => {
    expect(() => applyOps(baseTree(), [
      { opId: "op-1", type: "move", params: { id: "tools", parentId: "drill" } },
    ], 2)).toThrow("整批拒绝");
    expect(() => applyOps(baseTree(), [
      { opId: "op-1", type: "move", params: { id: "tools", parentId: "tools" } },
    ], 2)).toThrow("整批拒绝");
  });

  test("disable 保留 id、写墓碑、地图记 gone", () => {
    const result = applyOps(baseTree(), [
      { opId: "op-1", type: "disable", params: { id: "drill", reason: "停产" } },
    ], 2);
    const drill = byId(result.nodes, "drill");
    expect(drill.enabled).toBe(false);
    expect(result.tombstones).toEqual([{ oldId: "drill", newId: null, opId: "op-1", reason: "停产" }]);
    expect(result.migrationMap).toEqual({ drill: "gone" });
  });

  test("merge 存续者语义：目标保 id，其余源打墓碑 replaced_by", () => {
    const result = applyOps(baseTree(), [
      { opId: "op-1", type: "merge", params: { sources: ["drill", "hammer"], target: "hammer", reason: "重复类目" } },
    ], 2);
    expect(result.nodes.some((n) => n.id === "drill")).toBe(false);
    expect(byId(result.nodes, "hammer").parentId).toBe("tools");
    expect(result.tombstones).toEqual([{ oldId: "drill", newId: "hammer", opId: "op-1", reason: "重复类目" }]);
    expect(result.migrationMap).toEqual({ drill: "hammer" });
  });

  test("merge 只作用于末级，目标必须在 sources 中或已存在", () => {
    expect(() => applyOps(baseTree(), [
      { opId: "op-1", type: "merge", params: { sources: ["drill"], target: "tools" } },
    ], 2)).toThrow("整批拒绝");
    expect(() => applyOps(baseTree(), [
      { opId: "op-1", type: "merge", params: { sources: ["drill"], target: "ghost" } },
    ], 2)).toThrow("整批拒绝");
    expect(() => applyOps(baseTree(), [
      { opId: "op-1", type: "merge", params: { sources: ["drill"], target: "drill" } },
    ], 2)).toThrow("整批拒绝");
  });

  test("split 发新 id、源打墓碑、子类目继承源父级", () => {
    const result = applyOps(baseTree(), [
      { opId: "op-1", type: "split", params: { source: "pliers", children: [{ name: "尖嘴钳" }, { name: "钢丝钳" }] } },
    ], 2);
    expect(result.nodes.some((n) => n.id === "pliers")).toBe(false);
    const first = byId(result.nodes, `${NEW_ID_PREFIX}2-1`);
    const second = byId(result.nodes, `${NEW_ID_PREFIX}2-2`);
    expect([first.name, second.name]).toEqual(["尖嘴钳", "钢丝钳"]);
    expect(first.parentId).toBe("tools");
    expect(first.pathNames).toEqual(["标准类目", "五金工具", "尖嘴钳"]);
    expect(result.tombstones[0]).toMatchObject({ oldId: "pliers", newId: null, opId: "op-1" });
    expect(result.migrationMap).toEqual({ pliers: "gone" });
  });

  test("split/add 只作用于存在的类目，split 至少两个子类", () => {
    expect(() => applyOps(baseTree(), [
      { opId: "op-1", type: "split", params: { source: "tools", children: [{ name: "a" }, { name: "b" }] } },
    ], 2)).toThrow("整批拒绝");
    expect(() => applyOps(baseTree(), [
      { opId: "op-1", type: "add", params: { parentId: "ghost", name: "角磨机" } },
    ], 2)).toThrow("整批拒绝");
  });

  test("同一 id 被多个 op 冲突操作，整批拒绝", () => {
    expect(() => applyOps(baseTree(), [
      { opId: "op-1", type: "disable", params: { id: "drill" } },
      { opId: "op-2", type: "split", params: { source: "drill", children: [{ name: "a" }, { name: "b" }] } },
    ], 2)).toThrow("冲突");
    expect(() => applyOps(baseTree(), [
      { opId: "op-1", type: "merge", params: { sources: ["drill", "hammer"], target: "hammer" } },
      { opId: "op-2", type: "rename", params: { id: "drill", name: "x" } },
    ], 2)).toThrow("整批拒绝");
  });

  test("apply 顺序：rename/move/disable 先于 merge，phase3 按 opId 确定发号", () => {
    const renamed = applyOps(baseTree(), [
      { opId: "op-9", type: "rename", params: { id: "hammer", name: "羊角锤" } },
      { opId: "op-1", type: "merge", params: { sources: ["drill", "hammer"], target: "hammer" } },
    ], 2);
    expect(byId(renamed.nodes, "hammer").name).toBe("羊角锤");

    const addFirst = applyOps(baseTree(), [
      { opId: "op-2", type: "split", params: { source: "pliers", children: [{ name: "尖嘴钳" }, { name: "钢丝钳" }] } },
      { opId: "op-1", type: "add", params: { parentId: "tools", name: "角磨机" } },
    ], 2);
    expect(byId(addFirst.nodes, `${NEW_ID_PREFIX}2-1`).name).toBe("角磨机");
    expect(byId(addFirst.nodes, `${NEW_ID_PREFIX}2-2`).name).toBe("尖嘴钳");

    const splitFirst = applyOps(baseTree(), [
      { opId: "op-1", type: "split", params: { source: "pliers", children: [{ name: "尖嘴钳" }, { name: "钢丝钳" }] } },
      { opId: "op-2", type: "add", params: { parentId: "tools", name: "角磨机" } },
    ], 2);
    expect(byId(splitFirst.nodes, `${NEW_ID_PREFIX}2-1`).name).toBe("尖嘴钳");
    expect(byId(splitFirst.nodes, `${NEW_ID_PREFIX}2-3`).name).toBe("角磨机");
  });

  test("迁移地图只含消失的 id：merge 源→目标、disable/split→gone，rename/move 不进图", () => {
    const result = applyOps(baseTree(), [
      { opId: "op-1", type: "rename", params: { id: "drill", name: "充电电钻" } },
      { opId: "op-2", type: "move", params: { id: "drill", parentId: "root" } },
      { opId: "op-3", type: "merge", params: { sources: ["hammer", "wrench"], target: "hammer" } },
      { opId: "op-4", type: "disable", params: { id: "saw" } },
      { opId: "op-5", type: "split", params: { source: "grinder", children: [{ name: "充电角磨机" }, { name: "插电角磨机" }] } },
    ], 2);
    expect(result.migrationMap).toEqual({ wrench: "hammer", saw: "gone", grinder: "gone" });
    expect(result.lineage[`${NEW_ID_PREFIX}2-1`]).toMatchObject({ kind: "split", sourceId: "grinder", opId: "op-5" });
    expect(buildLineage([
      { opId: "op-5", type: "split", params: { source: "grinder", children: [{ name: "充电角磨机" }, { name: "插电角磨机" }] } },
    ], 2)).toEqual(result.lineage);
  });

  test("物化后树可序列化且 hash 稳定；禁用节点仍在树中", () => {
    const result = applyOps(baseTree(), [
      { opId: "op-1", type: "disable", params: { id: "saw" } },
    ], 2);
    expect(treeHash(result.nodes)).toMatch(/^[a-f0-9]{64}$/);
    expect(treeHash(result.nodes)).toBe(treeHash(materialize(result.nodes)));
    expect(byId(result.nodes, "saw").enabled).toBe(false);
  });

  test("propose 结构校验：非法条目报告并可跳过", () => {
    expect(validateOpShape({ type: "rename", params: { id: "a", name: "b" } })).toEqual([]);
    expect(validateOpShape({ type: "merge", params: { sources: ["a", "b"], target: "b" } })).toEqual([]);
    expect(validateOpShape({ type: "hop", params: {} })).not.toEqual([]);
    expect(validateOpShape({ type: "rename", params: { id: "a" } })).not.toEqual([]);
    expect(validateOpShape({ type: "split", params: { source: "a", children: [{ name: "x" }] } })).not.toEqual([]);
    expect(validateOpShape("rename" as unknown as CategoryOp)).not.toEqual([]);
  });
});
