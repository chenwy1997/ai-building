import { describe, expect, test } from "bun:test";
import {
  renderTrace,
  resolveMigrationMap,
  resolveTombstone,
} from "../src/scenarios/category_governance_plus/trace.ts";
import type { Tombstone } from "../src/scenarios/category_governance_plus/ops.ts";

const tombstone = (oldId: string, newId: string | null, reason = "测试"): Tombstone =>
  ({ oldId, newId, opId: `op-${oldId}`, reason });

describe("墓碑链式解析", () => {
  test("单跳：A→B 落点 B，hops 1，alive", () => {
    const resolution = resolveTombstone([tombstone("A", "B")], "A");
    expect(resolution).toEqual({ finalId: "B", hops: [{ oldId: "A", newId: "B", opId: "op-A", reason: "测试" }], status: "alive" });
  });

  test("两跳链式：A→B、B→C 落点 C，hops 2", () => {
    const resolution = resolveTombstone([tombstone("A", "B"), tombstone("B", "C")], "A");
    expect(resolution.finalId).toBe("C");
    expect(resolution.hops.map((hop) => hop.oldId)).toEqual(["A", "B"]);
    expect(resolution.status).toBe("alive");
  });

  test("gone：disable/split 无 new_id，链中某跳为空即 gone", () => {
    const disabled = resolveTombstone([tombstone("A", null, "disable")], "A");
    expect(disabled).toMatchObject({ finalId: null, status: "gone" });
    expect(disabled.hops).toHaveLength(1);

    const chained = resolveTombstone([tombstone("A", "B"), tombstone("B", null, "拆分为 2 个类目")], "A");
    expect(chained).toMatchObject({ finalId: null, status: "gone" });
    expect(chained.hops).toHaveLength(2);
  });

  test("无墓碑的 id 原样返回 alive、hops 为空", () => {
    expect(resolveTombstone([tombstone("A", "B")], "Z")).toEqual({ finalId: "Z", hops: [], status: "alive" });
  });

  test("成环报错而非死循环", () => {
    expect(() => resolveTombstone([tombstone("A", "B"), tombstone("B", "A")], "A"))
      .toThrow("墓碑链成环");
  });
});

describe("迁移地图链式解析", () => {
  test("export 地图输出最终映射（A→C 而非 A→B）并保留 hops", () => {
    const own = [tombstone("A", "B"), tombstone("X", null, "disable")];
    const all = [...own, tombstone("B", "C")];
    const { map, chains } = resolveMigrationMap(own, all);
    expect(map).toEqual({ A: "C", X: "gone" });
    expect(chains.A).toEqual({ finalId: "C", status: "alive", hops: 2 });
    expect(chains.X).toEqual({ finalId: null, status: "gone", hops: 1 });
  });
});

describe("trace 报告渲染", () => {
  test("含完整去向链（每跳 op 类型/版本/时间）与最终存活路径", () => {
    const lines = renderTrace({
      id: "A",
      versions: [
        { versionNo: 1, present: true, enabled: true, path: ["标准类目", "甲"] },
        { versionNo: 2, present: true, enabled: true, path: ["标准类目", "甲"] },
        { versionNo: 3, present: false },
      ],
      hops: [
        { oldId: "A", oldName: "甲", newId: "B", newName: "乙", opType: "merge", versionNo: 3, decidedAt: "2026/9/21 09:20:57", reason: "合并" },
        { oldId: "B", oldName: "乙", newId: "C", newName: "丙", opType: "merge", versionNo: 4, decidedAt: "2026/9/22 10:00:00", reason: "再合并" },
      ],
      finalStatus: "alive",
      finalPath: ["标准类目", "丙"],
    });
    const text = lines.join("\n");
    expect(text).toContain("v1：存在（enabled），路径 标准类目 > 甲");
    expect(text).toContain("v3：不存在");
    expect(text).toContain("A(甲) → B(乙)［merge，物化于 v3，2026/9/21 09:20:57］");
    expect(text).toContain("B(乙) → C(丙)［merge，物化于 v4，2026/9/22 10:00:00］");
    expect(text).toContain("最终：alive → 当前路径 标准类目 > 丙");
  });

  test("gone 说明下线原因；无墓碑打印当前路径；从未存在给出提示", () => {
    const gone = renderTrace({
      id: "A",
      versions: [{ versionNo: 1, present: true, enabled: true, path: ["标准类目", "甲"] }],
      hops: [{ oldId: "A", oldName: "甲", newId: null, newName: null, opType: "disable", versionNo: 2, decidedAt: null, reason: "ES 零挂载商品" }],
      finalStatus: "gone",
      goneReason: "disable：ES 零挂载商品",
    }).join("\n");
    expect(gone).toContain("A(甲) → （下线）［disable，物化于 v2］");
    expect(gone).toContain("最终：gone（disable：ES 零挂载商品）");

    const alive = renderTrace({
      id: "Z",
      versions: [{ versionNo: 1, present: true, enabled: true, path: ["标准类目", "存续"] }],
      hops: [],
      finalStatus: "alive",
      finalPath: ["标准类目", "存续"],
    }).join("\n");
    expect(alive).toContain("无墓碑：当前仍存活，路径 标准类目 > 存续");

    expect(renderTrace({ id: "ghost", versions: [], hops: [], finalStatus: "never" }).join("\n"))
      .toContain("从未在任何版本出现");
  });
});
