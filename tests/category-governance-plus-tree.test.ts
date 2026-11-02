import { describe, expect, test } from "bun:test";
import { levelLabel, renderSubtree } from "../src/scenarios/category_governance_plus/tree.ts";
import { materialize } from "../src/scenarios/category_governance_plus/engine.ts";
import type { Category } from "../src/scenarios/category_attributes_governance/types.ts";

const node = (id: string, parentId: string | null, name = id, enabled = true): Category => ({
  id, parentId, name, enabled, isLeaf: false, pathIds: [], pathNames: [], categoryId: null,
});

const tree = (...nodes: Category[]): Category[] => materialize(nodes);
const scopeOf = (nodes: Category[], id: string): Category => nodes.find((n) => n.id === id)!;

const fixture = () => tree(
  node("root", null, "标准类目"),
  node("hw", "root", "五金工具"),
  node("power", "hw", "电动工具"),
  node("rivet", "power", "电动铆接工具"),
  node("gun", "rivet", "拉铆枪"),
  node("gun2", "rivet", "铆螺母枪", false),
  node("heat", "power", "电动热缩工具"),
  node("hg1", "heat", "充电式热风枪"),
  node("hg2", "heat", "插电式热风枪"),
  node("weld", "root", "焊接"),
);

describe("tree 子树渲染", () => {
  test("层级标注：根为[根]，其下一级~五级，第五级为[四级(品名)]", () => {
    expect(levelLabel(0)).toBe("[根]");
    expect(levelLabel(1)).toBe("[一级]");
    expect(levelLabel(2)).toBe("[二级]");
    expect(levelLabel(3)).toBe("[三级]");
    expect(levelLabel(4)).toBe("[四级(品名)]");
    expect(levelLabel(5)).toBe("[五级]");
    expect(levelLabel(6)).toBe("[六级]");

    const nodes = fixture();
    const { lines } = renderSubtree(nodes, scopeOf(nodes, "root"));
    expect(lines[0]).toBe("[根]标准类目");
    expect(lines.find((line) => line.includes("拉铆枪"))).toBe("        [四级(品名)]拉铆枪");
  });

  test("禁用节点名称后标注（禁用），行首缩进按相对深度", () => {
    const nodes = fixture();
    const { lines } = renderSubtree(nodes, scopeOf(nodes, "power"));
    expect(lines).toEqual([
      "[二级]电动工具",
      "  [三级]电动热缩工具",
      "    [四级(品名)]充电式热风枪",
      "    [四级(品名)]插电式热风枪",
      "  [三级]电动铆接工具",
      "    [四级(品名)]拉铆枪",
      "    [四级(品名)]铆螺母枪（禁用）",
    ]);
  });

  test("max-depth 截断：分支行尾标 …(+N 个后代)，visibleIds 只含已渲染节点", () => {
    const nodes = fixture();
    const { lines, visibleIds, truncatedBranches, hiddenDescendants } = renderSubtree(
      nodes, scopeOf(nodes, "power"), { maxDepth: 1 },
    );
    expect(lines).toEqual([
      "[二级]电动工具",
      "  [三级]电动热缩工具 …(+2 个后代)",
      "  [三级]电动铆接工具 …(+2 个后代)",
    ]);
    expect(visibleIds).toEqual(["power", "heat", "rivet"]);
    expect(truncatedBranches).toBe(2);
    expect(hiddenDescendants).toBe(4);
  });

  test("counts 以 Map 注入显示（挂载 N），未注入的节点不标注", () => {
    const nodes = fixture();
    const counts = new Map([["heat", 6], ["hg1", 3], ["hg2", 0]]);
    const { lines } = renderSubtree(nodes, scopeOf(nodes, "heat"), { counts });
    expect(lines).toEqual([
      "[三级]电动热缩工具（挂载 6）",
      "  [四级(品名)]充电式热风枪（挂载 3）",
      "  [四级(品名)]插电式热风枪（挂载 0）",
    ]);

    const partial = renderSubtree(nodes, scopeOf(nodes, "heat"), { counts: new Map([["hg1", 5]]) });
    expect(partial.lines[0]).toBe("[三级]电动热缩工具");
    expect(partial.lines[1]).toBe("  [四级(品名)]充电式热风枪（挂载 5）");
  });

  test("兄弟排序按名称确定（与输入顺序无关）", () => {
    const nodes = tree(
      node("root", null, "标准类目"),
      node("b", "root", "乙类"),
      node("a", "root", "甲类"),
      node("a1", "a", "甲叶"),
    );
    const { lines } = renderSubtree(nodes, scopeOf(nodes, "root"));
    expect(lines[1]).toBe("  [一级]乙类");
    expect(lines[2]).toBe("  [一级]甲类");
    expect(lines[3]).toBe("    [二级]甲叶");
  });
});
