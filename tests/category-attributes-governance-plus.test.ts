import { describe, expect, test } from "bun:test";
import { diffTemplates, planBuckets, reconcileMerge, reconcileSplit } from "../src/scenarios/category_attributes_governance_plus/plan.ts";
import type { BaseTemplate } from "../src/scenarios/category_attributes_governance_plus/plan.ts";
import { applyOps, materialize } from "../src/scenarios/category_governance_plus/engine.ts";
import type { CategoryOp } from "../src/scenarios/category_governance_plus/ops.ts";
import type { Attribute, Category } from "../src/scenarios/category_attributes_governance/types.ts";

const attr = (
  key: string,
  name: string,
  type: Attribute[2] = "text",
  requirement: Attribute[3] = "optional",
  unit = "",
  options: string[] = [],
): Attribute => [key, name, type, requirement, unit, options, "", "", "", []];

const node = (id: string, parentId: string | null, name = id): Category => ({
  id, parentId, name, enabled: true, isLeaf: false, pathIds: [], pathNames: [], categoryId: null,
});

/** root └─ tools ├─ drill ├─ hammer ├─ wrench ├─ pliers └─ saw */
const baseTree = (): Category[] => materialize([
  node("root", null, "标准类目"),
  node("tools", "root", "五金工具"),
  node("drill", "tools", "电钻"),
  node("hammer", "tools", "锤子"),
  node("wrench", "tools", "扳手"),
  node("pliers", "tools", "钳子"),
  node("saw", "tools", "锯子"),
]);

const baseTemplate: BaseTemplate = {
  version: 1,
  rows: [
    { categoryId: "drill", attributes: [attr("power", "功率", "number", "required", "W")] },
    { categoryId: "hammer", attributes: [attr("weight", "重量", "number", "optional", "kg")] },
    { categoryId: "wrench", attributes: [attr("size", "规格", "single", "optional", "", ["10mm", "12mm"])] },
    { categoryId: "pliers", attributes: [attr("jaw", "钳口类型", "single", "required", "", ["尖嘴", "钢丝", "斜口"])] },
    { categoryId: "saw", attributes: [attr("length", "锯条长度", "number", "optional", "mm")] },
  ],
};

describe("diff 式增量属性治理", () => {
  test("三桶分类：rename/move 继承，merge 存续者与 split 子类调和，add 占位", () => {
    const ops: CategoryOp[] = [
      { opId: "op-1", type: "rename", params: { id: "drill", name: "充电电钻" } },
      { opId: "op-2", type: "move", params: { id: "saw", parentId: "root" } },
      { opId: "op-3", type: "merge", params: { sources: ["wrench", "hammer"], target: "hammer" } },
      { opId: "op-4", type: "add", params: { parentId: "tools", name: "电锤" } },
      { opId: "op-5", type: "split", params: { source: "pliers", children: [{ name: "尖嘴钳" }, { name: "钢丝钳" }] } },
    ];
    const applied = applyOps(baseTree(), ops, 2);
    const leaves = applied.nodes
      .filter((n) => n.isLeaf && n.enabled)
      .map((n) => ({ id: n.id, name: n.name }));
    const plans = planBuckets(leaves, ops, applied.tombstones, baseTemplate, 2);
    const byId = new Map(plans.map((plan) => [plan.categoryId, plan]));

    expect(byId.get("drill")).toMatchObject({ bucket: "unchanged", provenance: "inherited" });
    expect(byId.get("drill")?.attributes).toEqual(baseTemplate.rows[0]?.attributes);
    expect(byId.get("saw")?.bucket).toBe("unchanged");

    const survivor = byId.get("hammer");
    expect(survivor).toMatchObject({ bucket: "derived", provenance: "reconciled" });
    expect(survivor?.attributes.map((a) => a[0]).sort()).toEqual(["size", "weight"]);

    // phase3 按 opId 排序发号：op-4 add → PLUS-2-1，op-5 split → PLUS-2-2/3
    expect(byId.get("PLUS-2-1")).toMatchObject({ bucket: "added", provenance: "generated", attributes: [] });
    const splitChild = byId.get("PLUS-2-2");
    expect(splitChild).toMatchObject({ bucket: "derived", provenance: "reconciled" });
    expect(splitChild?.attributes.map((a) => a[0])).toEqual(["jaw"]);
    expect(byId.get("pliers")).toBeUndefined();
  });

  test("reconcileMerge：key 并集、unit/type 冲突记录不裁决、options 并集、requirement 取严格", () => {
    const { attributes, conflicts } = reconcileMerge([
      [attr("power", "功率", "number", "required", "W"), attr("voltage", "电压", "number", "optional", "V")],
      [attr("power", "输入功率", "number", "optional", "kW"), attr("color", "颜色", "single", "optional", "", ["红", "蓝"])],
      [attr("color", "颜色", "single", "conditional", "", ["蓝", "绿"]), attr("power", "功率", "text", "optional", "W")],
    ]);
    const byKey = new Map(attributes.map((a) => [a[0], a]));
    expect([...byKey.keys()]).toEqual(["power", "voltage", "color"]);
    expect(byKey.get("power")?.[3]).toBe("required");
    expect(byKey.get("power")?.[4]).toBe("W");
    expect(byKey.get("color")?.[3]).toBe("conditional");
    expect(byKey.get("color")?.[5]).toEqual(["红", "蓝", "绿"]);
    expect(conflicts).toEqual([
      { key: "power", field: "type", values: ["number", "text"] },
      { key: "power", field: "unit", values: ["W", "kW"] },
    ]);
  });

  test("reconcileSplit：父模板全量下发且互不影响，标出可能的拆分轴", () => {
    const parent = [
      attr("jaw", "钳口类型", "single", "required", "", ["尖嘴", "钢丝", "斜口"]),
      attr("brand", "品牌", "text", "optional"),
    ];
    const [needle, lineman] = reconcileSplit(parent, [
      { id: "c1", name: "尖嘴钳" },
      { id: "c2", name: "鲤鱼钳" },
    ]);
    expect(needle?.attributes).toEqual(parent);
    expect(lineman?.attributes).toEqual(parent);
    expect(needle?.attributes[0]?.[5]).not.toBe(lineman?.attributes[0]?.[5]);
    expect(needle?.hints.join()).toContain("尖嘴");
    expect(needle?.hints.join()).toContain("拆分轴");
    expect(lineman?.hints.join()).toContain("拆分轴");
    expect(lineman?.hints.join()).not.toContain("相关：");
  });

  test("diffTemplates 只含变化行，按 category_id+attr_key 定位", () => {
    const base = [
      { categoryId: "a", attributes: [attr("k1", "属性一"), attr("k2", "属性二"), attr("k4", "属性四")] },
      { categoryId: "b", attributes: [attr("k1", "属性一")] },
    ];
    const next = [
      { categoryId: "a", attributes: [attr("k1", "属性一"), attr("k2", "属性二", "number", "required", "mm"), attr("k3", "属性三")] },
      { categoryId: "c", attributes: [attr("k1", "属性一")] },
    ];
    const report = diffTemplates(base, next);
    expect(report.rows.map((row) => `${row.kind}:${row.categoryId}/${row.key}`)).toEqual([
      "changed:a/k2",
      "added:a/k3",
      "removed:a/k4",
      "removed:b/k1",
      "added:c/k1",
    ]);
    expect(report.summary).toEqual({ added: 2, removed: 2, changed: 1, unchanged: 1 });
    expect(report.rows.find((row) => row.kind === "changed")?.before?.[4]).toBe("");
    expect(report.rows.find((row) => row.kind === "changed")?.after?.[4]).toBe("mm");
  });

  test("planBuckets：继承的属性是深拷贝，改写草稿不污染基础模板", () => {
    const plans = planBuckets([{ id: "drill", name: "电钻" }], [], [], baseTemplate, 1);
    expect(plans).toHaveLength(1);
    plans[0]!.attributes[0]![4] = "kW";
    expect(baseTemplate.rows[0]?.attributes[0]?.[4]).toBe("W");
    // 无基础模板且未被 op 触及的末级落入 added，等全量治理
    const orphan = planBuckets([{ id: "ghost", name: "幽灵" }], [], [], baseTemplate, 1);
    expect(orphan[0]).toMatchObject({ bucket: "added", provenance: "generated" });
  });
});
