import { describe, expect, test } from "bun:test";
import { normalizeCategories } from "../src/scenarios/category_governance/category-tree.ts";
import { toStdText, makeContextChunks } from "../src/scenarios/category_governance/std-text.ts";
import { compactTemplates, parseGovernanceResponse } from "../src/scenarios/category_governance/template-codec.ts";
import type { GovernanceResult } from "../src/scenarios/category_governance/types.ts";

describe("标准类目治理公共函数", () => {
  const document = normalizeCategories({ items: [
    { id: "root", name: "办公", fatherId: null },
    { id: "paper", name: "纸品", fatherId: "root" },
    { id: "a4", name: "A4复印纸", fatherId: "paper" },
  ] }, "v1");

  test("保留层级并用缩进表达共同父路径", () => {
    const text = toStdText(document);
    expect(document.leafCount).toBe(1);
    expect(text).toContain("1+ 办公");
    expect(text).toContain("    3* A4复印纸");
    expect(makeContextChunks(document, 2).find((chunk) => chunk.rootPath.length === 2)?.rootPath).toEqual(["办公", "纸品"]);
  });

  test("属性字典压缩后可以无损还原", () => {
    const result: GovernanceResult = {
      category: { id: "a4", path: ["办公", "纸品", "A4复印纸"], name: "A4复印纸" },
      shared: [{ key: "brand", name: "品牌", type: "text", required: false, unit: null, options: [], scope: "shared" }],
      properties: [{ key: "size", name: "纸张尺寸", type: "single", required: true, unit: null, options: ["A4"], scope: "category" }],
      notes: [],
    };
    const compact = compactTemplates([result]);
    const restored = parseGovernanceResponse(JSON.stringify(compact), [document.nodes[2]!]);
    expect(Object.keys(compact.a)).toHaveLength(2);
    expect(restored[0]?.properties[0]?.required).toBe(true);
    expect(restored[0]?.properties[0]?.options).toEqual(["A4"]);
  });
});
