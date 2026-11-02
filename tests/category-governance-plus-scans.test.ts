import { describe, expect, test } from "bun:test";
import { scanNearDuplicates } from "../src/scenarios/category_governance_plus/near-dup.ts";
import { analyzeZeroMounts, buildDisableOps, mountDistribution, sampleEvenly, subtreeMount } from "../src/scenarios/category_governance_plus/mount-scan.ts";
import { materialize } from "../src/scenarios/category_governance_plus/engine.ts";
import type { Category } from "../src/scenarios/category_attributes_governance/types.ts";

const node = (id: string, parentId: string | null, name = id, enabled = true): Category => ({
  id, parentId, name, enabled, isLeaf: false, pathIds: [], pathNames: [], categoryId: null,
});
const tree = (...nodes: Category[]): Category[] => materialize(nodes);
const leavesOf = (nodes: Category[]) => nodes.filter((n) => n.enabled && n.isLeaf);

describe("近似名重复扫描", () => {
  // 五金工具域：充电式/插电式热风枪（0.667 不过阈）、不锈钢螺丝 vs 不锈钢螺丝钉（0.8 过阈）、归一化重名跳过
  // 电气域：热风枪（与五金归一化不同名不同，0.667 不过阈）；跨域近似：单相电度表箱 vs 单相电度表（0.8）
  const fixture = () => tree(
    node("root", null, "标准类目"),
    node("hw", "root", "五金工具"),
    node("p1", "hw", "电动热缩工具"),
    node("a1", "p1", "充电式热风枪"),
    node("a2", "p1", "插电式热风枪"),
    node("a3", "p1", "热风枪（国标）"),
    node("a4", "p1", "热风枪(国标)"),
    node("a6", "p1", "其他热缩工具"),
    node("p3", "hw", "紧固件"),
    node("a8", "p3", "不锈钢螺丝"),
    node("a9", "p3", "不锈钢螺丝钉"),
    node("el", "root", "电气类"),
    node("e1", "el", "电气辅材"),
    node("b1", "e1", "热风枪"),
    node("b2", "e1", "单相电度表"),
    node("p2", "hw", "仪表工具"),
    node("a7", "p2", "单相电度表箱"),
  );

  test("阈值过滤 + 同域/跨域标记 + 归一化重名不进来", () => {
    const pairs = scanNearDuplicates(leavesOf(fixture()), { threshold: 0.75 });
    const keys = pairs.map((pair) => `${pair.aName}|${pair.bName}`);
    // 不锈钢螺丝 vs 不锈钢螺丝钉：bigram 4/5 = 0.8 ≥ 0.75 → 命中（同域）
    expect(keys.some((key) => key.includes("不锈钢螺丝") && key.includes("不锈钢螺丝钉"))).toBe(true);
    // 充电式 vs 插电式热风枪 = 4/6 ≈ 0.667 < 0.75 → 不命中
    expect(keys.some((key) => key.includes("充电式热风枪") && key.includes("插电式热风枪"))).toBe(false);
    // 热风枪（国标） vs 热风枪(国标)：归一化相同（全角括号统一）→ 不进近似名（归 audit）
    expect(keys.filter((key) => key.includes("热风枪(国标)") && key.includes("热风枪（国标）"))).toHaveLength(0);
    // 跨域：五金「单相电度表箱」 vs 电气「单相电度表」= 4/5 = 0.8 → sameDomain=false
    const cross = pairs.find((pair) => !pair.sameDomain);
    expect(cross).toBeDefined();
    expect([cross!.aName, cross!.bName].sort()).toEqual(["单相电度表", "单相电度表箱"]);
    expect(pairs.filter((pair) => pair.sameDomain).every((pair) => pair.similarity >= 0.75)).toBe(true);
  });

  test("杂类词表命中节点与 excludeIds 被排除", () => {
    const nodes = fixture();
    const pairs = scanNearDuplicates(leavesOf(nodes), { threshold: 0.3 });
    expect(pairs.every((pair) => pair.aName !== "其他热缩工具" && pair.bName !== "其他热缩工具")).toBe(true);
    const excluded = scanNearDuplicates(leavesOf(nodes), { threshold: 0.75, excludeIds: new Set([nodes.find((n) => n.name === "不锈钢螺丝钉")!.id]) });
    expect(excluded.every((pair) => pair.aName !== "不锈钢螺丝钉" && pair.bName !== "不锈钢螺丝钉")).toBe(true);
  });
});

describe("挂载分布与零挂载分析", () => {
  const fixture = () => tree(
    node("root", null, "标准类目"),
    node("hw", "root", "五金工具"),
    node("p", "hw", "电动工具"),
    node("a", "p", "电钻"),
    node("b", "p", "电锤"),
    node("c", "p", "电剪"),
    node("dead", "hw", "枯支"),
    node("d", "dead", "枯叶一"),
    node("e", "dead", "枯叶二"),
    node("misc", "p", "其他电动工具"),
  );
  const counts = new Map([["a", 12], ["b", 0], ["c", 3], ["d", 0], ["e", 0], ["misc", 0]]);

  test("分布档位/中位数/top", () => {
    const dist = mountDistribution(leavesOf(fixture()), counts);
    expect(dist).toMatchObject({ zero: 4, oneToFive: 1, sixToTwenty: 1, twentyOneToNinetyNine: 0, hundredPlus: 0 });
    expect(dist.median).toBe(0);
    expect(dist.mountedTotal).toBe(15);
    expect(dist.top[0]).toMatchObject({ id: "a", count: 12 });
  });

  test("枯枝 vs 单独裸奔 + 杂类标记 + 兄弟挂载", () => {
    const zero = analyzeZeroMounts(fixture(), counts);
    const byId = new Map(zero.map((item) => [item.id, item]));
    expect(zero).toHaveLength(4);
    // b 电锤：兄弟 a=12、c=3 → 裸奔
    expect(byId.get("b")).toMatchObject({ branchDead: false, generic: false, siblingMountTotal: 15 });
    // d/e 枯支下：兄弟都为 0 → 枯枝
    expect(byId.get("d")).toMatchObject({ branchDead: true, siblingMountTotal: 0 });
    expect(byId.get("e")).toMatchObject({ branchDead: true });
    // misc 杂类命中
    expect(byId.get("misc")).toMatchObject({ generic: true, branchDead: false });
    expect(byId.get("b")!.siblings.map((sibling) => `${sibling.name}:${sibling.mount}`)).toContain("电钻:12");
  });

  test("disable 提案 evidence 带路径/兄弟挂载/杂类/枯枝", () => {
    const [op] = buildDisableOps(analyzeZeroMounts(fixture(), counts).filter((item) => item.id === "d"));
    expect(op!.type).toBe("disable");
    expect(op!.params.id).toBe("d");
    expect(op!.params.reason).toContain("枯枝");
    expect(op!.evidence).toMatchObject({ kind: "零挂载扫描", branchDead: true, generic: false });
  });

  test("子树挂载与等距抽样", () => {
    expect(subtreeMount(fixture(), "p", counts)).toBe(15);
    expect(subtreeMount(fixture(), "dead", counts)).toBe(0);
    const sampled = sampleEvenly([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4);
    expect(sampled).toHaveLength(4);
    expect(sampleEvenly([1, 2], 5)).toHaveLength(2);
  });
});
