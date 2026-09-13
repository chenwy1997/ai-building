import { describe, expect, test } from "bun:test";
import { normalizeCategories } from "../src/scenarios/category_governance/category-tree.ts";
import { toStdText, makeContextChunks } from "../src/scenarios/category_governance/std-text.ts";
import { compactTemplates, parseGovernanceResponse } from "../src/scenarios/category_governance/template-codec.ts";
import { buildGovernanceUserPrompt } from "../src/scenarios/category_governance/prompt.ts";
import { buildJdEvidenceText, normalizeJdEvidence } from "../src/scenarios/category_governance/jd-evidence.ts";
import { collectJdEvidence } from "../src/scenarios/category_governance/jd-collector.ts";
import { buildJdCategoryMapping, autoJdCategoryReferences } from "../src/scenarios/category_governance/jd-mapping.ts";
import { buildAttributeConsensus, buildConfirmedTemplateDocument } from "../src/scenarios/category_governance/consensus.ts";
import { applySemanticReviews, buildSemanticReviewPrompt, mergeSemanticReviews, parseSemanticReviewResponse } from "../src/scenarios/category_governance/semantic-review.ts";
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

  test("兼容紧凑属性 unit 错位和多一个 null 的模型输出", () => {
    const response = {
      v: 1,
      a: {
        a0: ["screen_size", "屏幕尺寸", "n", "", null, "英寸", "屏幕对角线尺寸", null, null, "category"],
        a1: ["battery_capacity", "电池容量", "n", "", null, "mAh", [], "电池容量", null, null, "category"],
        a2: ["screen_refresh_rate", "屏幕刷新率", "n", "", null, null, "屏幕刷新率", "Hz", null, "category"],
        a3: ["screen_resolution", "屏幕分辨率", "t", "", null, "", null, "分辨率规格", null, null, "category"],
      },
      c: { a4: [[], ["a0", "a1", "a2", "a3"], []] },
    };
    const restored = parseGovernanceResponse(JSON.stringify(response), [document.nodes[2]!]);
    expect(restored[0]?.properties.map((item) => item.unit)).toEqual(["英寸", "mAh", "Hz", ""]);
  });

  test("治理提示词使用紧凑 a/c 结构，并把参考证据放在目标之后", () => {
    const target = document.nodes[2]!;
    const evidence = normalizeJdEvidence({ categories: [
      { path: ["办公", "纸品", "A4复印纸"], targetIds: [document.nodes[2]!.id], sampleSkuIds: ["1", "2", "3", "4"], attributes: [
        { name: "纸张克重", unit: "g/m²", values: ["70", "80"], observed: 2 },
        { name: "国补备案型号", values: ["型号-1"], observed: 2 },
        { name: "偶然字段", values: ["只出现一次"], observed: 1 },
      ] },
      { path: ["办公", "纸品", "复印纸"], attributes: [{ name: "无关字段", values: ["不要带入"] }] },
    ] });
    const reference = buildJdEvidenceText([target], evidence);
    const prompt = buildGovernanceUserPrompt({
      version: "v1", categoryText: "#STD-CAT\n1+ 办公", targetCategories: [target], referenceText: reference,
    });
    expect(prompt).toContain('"a":{"a0"');
    expect(prompt).toContain('"c":{"');
    expect(prompt).toContain("#JD-EVIDENCE");
    expect(prompt.indexOf("目标末级类目")).toBeLessThan(prompt.indexOf("#JD-EVIDENCE"));
    expect(prompt).toContain("纸张克重");
    expect(prompt).toContain("seen=2/4");
    expect(prompt).toContain("国补备案型号");
    expect(prompt).toContain("hint=platform_field");
    expect(prompt).toContain("偶然字段");
    expect(prompt).toContain("weak=1");
    expect(prompt).not.toContain("无关字段");
    expect(prompt).toContain("seen=x/y");
  });

  test("京东采样器聚合类目属性和规格参数，并保留目标映射", async () => {
    const target = document.nodes[2]!;
    let searchRequest: Record<string, unknown> | undefined;
    const result = await collectJdEvidence({
      targetCategories: [target], skusPerCategory: 2, searchPageSize: 2, concurrency: 1, attempts: 1,
      jdCategories: [{ id: "123", name: target.name, path: ["办公", "纸品", target.name] }],
      goodsApi: {
        async searchSku(request) {
          searchRequest = request;
          return { skuHitResultPaging: { items: [
            { skuId: 1001, skuName: "A4复印纸 70g", categoryId3: 999, categoryName1: "办公", categoryName2: "纸品", categoryName3: "复印纸" },
            { skuId: 1002, skuName: "A4复印纸 80g", categoryId3: 999, categoryName1: "办公", categoryName2: "纸品", categoryName3: "复印纸" },
          ] } };
        },
        async getSkuDetailInfo(request) {
          const skuId = String(request.skuId);
          return {
            skuId,
            categoryAttrList: [{ cateAttrName: "纸张类型", cateAttrValList: ["复印纸"] }],
            paramGroupAttrList: [{ paramGroupName: "规格", paramAttributeList: [{ paramAttrName: "克重", paramAttrValList: [String(skuId) === "1001" ? "70g" : "80g"] }] }],
          };
        },
      },
    });
    expect(searchRequest?.categoryId3).toBe(123);
    expect(searchRequest?.keyword).toBe("");
    expect(result.stats.sampledSkuCount).toBe(2);
    expect(result.document.categories[0]?.targetIds).toContain(target.id);
    expect(result.document.categories[0]?.attributes.map((item) => item.name)).toEqual(["克重", "纸张类型"]);
    expect(result.document.categories[0]?.attributes[0]?.observed).toBe(2);
  });

  test("京东类目映射只自动接受有父路径证据的包含关系", () => {
    const targets = normalizeCategories({ items: [
      { id: "root", name: "标准类目", fatherId: null },
      { id: "tools", name: "五金工具", fatherId: "root" },
      { id: "drill", name: "手电钻", fatherId: "tools" },
      { id: "phone", name: "手机壳", fatherId: "root" },
    ] }, "v1").nodes.filter((node) => node.isLeaf);
    const mapping = buildJdCategoryMapping(targets, [
      { id: "101", name: "电钻", path: ["家装建材", "五金工具", "电钻"] },
      { id: "102", name: "手机", path: ["手机通讯", "手机"] },
    ]);
    const drill = mapping.mappings.find((item) => item.targetName === "手电钻");
    const phoneCase = mapping.mappings.find((item) => item.targetName === "手机壳");
    expect(drill?.status).toBe("auto_parent");
    expect(autoJdCategoryReferences(mapping).find((item) => item.targetIds?.includes(drill!.targetId))?.id).toBe("101");
    expect(phoneCase?.status).toBe("review");
  });

  test("多批次属性共识区分稳定属性、单批候选和低价值字段", () => {
    const category = { id: "a4", path: ["办公", "纸品", "A4复印纸"], name: "A4复印纸" };
    const observations: Array<{ runId: string; result: GovernanceResult }> = [1, 2].map((runId) => ({ runId: String(runId), result: {
      category,
      shared: [{ key: "brand", name: "品牌", type: "text" as const, required: false, unit: null, options: [], scope: "shared" as const }],
      properties: [
        { key: "weight", name: "纸张克重", type: "number" as const, required: true, unit: "g/m²", options: [], scope: "category" as const },
        ...(runId === 1 ? [{ key: "color", name: "颜色", type: "single" as const, required: false, unit: null, options: ["白色"], scope: "category" as const }] : []),
        { key: "release_date", name: "上市日期", type: "date" as const, required: false, unit: null, options: [], scope: "category" as const },
      ],
      notes: [],
    } }));
    const result = buildAttributeConsensus(observations);
    const categoryResult = result.categories[0]!;
    expect(result.stats.confirmedCount).toBe(3);
    expect(categoryResult.properties.find((property) => property.name === "纸张克重")?.decision).toBe("confirmed");
    expect(categoryResult.properties.find((property) => property.name === "纸张克重")?.required).toBe(true);
    expect(categoryResult.properties.find((property) => property.name === "颜色")?.decision).toBe("candidate");
    expect(categoryResult.properties.find((property) => property.name === "上市日期")?.decision).toBe("confirmed");
    const templates = buildConfirmedTemplateDocument(result);
    expect(templates.categories[0]?.properties.map((property) => property.name)).toEqual(["上市日期", "纸张克重"]);
    expect(templates.categories[0]?.properties[0]).not.toHaveProperty("decision");
  });

  test("语义终审把固定上下文放在动态候选之前，并应用 keep/add 决策", () => {
    const category = buildAttributeConsensus([{ runId: "1", result: {
      category: { id: "a4", path: ["办公", "纸品", "A4复印纸"], name: "A4复印纸" },
      shared: [], properties: [{ key: "weight", name: "纸张克重", type: "number", required: false, unit: "g/m²", options: [], scope: "category" }], notes: [],
    } }]);
    const target = category.categories[0]!;
    const prompt = buildSemanticReviewPrompt({ category: target, evidenceText: "#JD-EVIDENCE\nattr=纸张克重|seen=1/1" });
    expect(prompt.indexOf("#CATEGORY")).toBeLessThan(prompt.indexOf("#CANDIDATES"));
    const review = parseSemanticReviewResponse(JSON.stringify({ category_id: "a4", decisions: [
      { key: "weight", action: "keep", reason: "采购识别需要" },
      { key: "material", action: "add", reason: "纸张行业通用字段", property: { key: "material", name: "材质", type: "text", required: false, unit: null, options: [], description: "纸张材质", format: null, example: null, scope: "category" } },
    ], notes: [] }), target);
    const templates = applySemanticReviews(category, [review]);
    expect(templates.categories[0]?.properties.map((property) => property.name)).toEqual(["纸张克重", "材质"]);
  });

  test("语义终审稳定结果按类目增量合并，重复类目使用最新结果", () => {
    const merged = mergeSemanticReviews(
      [
        { categoryId: "a4", decisions: [], notes: ["旧"] },
        { categoryId: "phone", decisions: [], notes: ["保留"] },
      ],
      [{ categoryId: "a4", decisions: [], notes: ["新"] }],
    );
    expect(merged.map((item) => item.categoryId)).toEqual(["a4", "phone"]);
    expect(merged.find((item) => item.categoryId === "a4")?.notes).toEqual(["新"]);
  });
});
