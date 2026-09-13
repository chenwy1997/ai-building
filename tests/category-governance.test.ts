import { describe, expect, test } from "bun:test";
import { normalizeCategories } from "../src/scenarios/category_governance/category-tree.ts";
import { toStdText, makeContextChunks } from "../src/scenarios/category_governance/std-text.ts";
import { compactTemplates, parseGovernanceResponse } from "../src/scenarios/category_governance/template-codec.ts";
import { buildGovernanceUserPrompt } from "../src/scenarios/category_governance/prompt.ts";
import { buildJdEvidenceText, normalizeJdEvidence } from "../src/scenarios/category_governance/jd-evidence.ts";
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

  test("兼容模型把属性值返回成数字或非标准 scope 的情况", () => {
    const response = {
      items: [{
        category: { id: "a4", path: ["办公", "纸品", "A4复印纸"], name: "A4复印纸" },
        shared: [{ key: "成型技术", name: "成型技术", type: "text", required: false, scope: "common", example: 80 }],
        properties: [{ key: "size", name: "纸张尺寸", type: "string", required: "true", options: ["A4", 16] }],
        notes: "模型补充说明",
      }],
    };
    const restored = parseGovernanceResponse(JSON.stringify(response), [document.nodes[2]!]);
    expect(restored[0]?.shared[0]?.key).toMatch(/^attr_[a-f0-9]{10}$/);
    expect(restored[0]?.shared[0]?.example).toBe("80");
    expect(restored[0]?.shared[0]?.scope).toBe("shared");
    expect(restored[0]?.properties[0]?.type).toBe("text");
    expect(restored[0]?.properties[0]?.required).toBe(true);
    expect(restored[0]?.properties[0]?.options).toEqual(["A4", "16"]);
    expect(restored[0]?.notes).toEqual(["模型补充说明"]);
  });

  test("公共属性 key 在多次治理中保持稳定，并拒绝缺少单位的量纲数字属性", () => {
    const response = {
      items: [{
        category: { id: "a4" }, shared: [],
        properties: [
          { key: "os", name: "操作系统", type: "text", required: false },
          { key: "ram_capacity", name: "运行内存", type: "number", required: false, unit: "GB" },
        ], notes: [],
      }],
    };
    const restored = parseGovernanceResponse(JSON.stringify(response), [document.nodes[2]!]);
    expect(restored[0]?.properties.map((item) => item.key)).toEqual(["operating_system", "ram"]);
    const invalid = { ...response, items: [{ ...response.items[0], properties: [{ key: "screen_size", name: "屏幕尺寸", type: "number", required: false }] }] };
    expect(() => parseGovernanceResponse(JSON.stringify(invalid), [document.nodes[2]!])).toThrow("必须填写 unit");
  });

  test("治理提示词使用紧凑 a/c 结构，并把参考证据放在目标之后", () => {
    const target = document.nodes[2]!;
    const evidence = normalizeJdEvidence({ categories: [{ path: ["办公", "纸品", "A4复印纸"], attributes: [{ name: "纸张克重", unit: "g/m²", values: ["70", "80"] }] }] });
    const reference = buildJdEvidenceText([target], evidence);
    const prompt = buildGovernanceUserPrompt({
      version: "v1", categoryText: "#STD-CAT\n1+ 办公", targetCategories: [target], referenceText: reference,
    });
    expect(prompt).toContain('"a":{"a0"');
    expect(prompt).toContain('"c":{"');
    expect(prompt).toContain("#JD-EVIDENCE");
    expect(prompt.indexOf("目标末级类目")).toBeLessThan(prompt.indexOf("#JD-EVIDENCE"));
    expect(prompt).toContain("纸张克重");
  });
});
