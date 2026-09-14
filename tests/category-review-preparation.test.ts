import { describe, expect, test } from "bun:test";
import { buildAttributeConsensus, type GovernanceObservation } from "../src/scenarios/category_governance/consensus.ts";
import { candidateProperty, candidateVariants, prepareReviewCategory, prepareReviewConsensus, reviewCategoryStats, sampleReviewCategories } from "../src/scenarios/category_governance/review-preparation.ts";
import { applySemanticReviews, applySuccessfulSemanticReviews, buildSemanticReviewPrompt, parseSemanticReviewResponse, reviewVariantIndex, semanticReviewInputFingerprint } from "../src/scenarios/category_governance/semantic-review.ts";
import type { AttributeProperty } from "../src/scenarios/category_governance/types.ts";

const property = (key: string, name = key, extra: Partial<AttributeProperty> = {}): AttributeProperty => ({ key, name, type: "text", required: false, unit: null, options: [], description: "", format: null, example: null, scope: "category", ...extra });
const observation = (id: string, runId: string, properties: AttributeProperty[], roundId?: string): GovernanceObservation => ({ runId, roundId, result: { category: { id, name: id, path: ["标准类目", "一级", id] }, shared: [], properties, notes: [] } });
const conflicting = () => prepareReviewConsensus(buildAttributeConsensus([
  observation("box", "19", [property("spec", "容量", { type: "number", unit: "L" }), property("material", "材质")]),
  observation("box", "27", [property("spec", "重量", { type: "number", unit: "kg" }), property("material", "材质")]),
]));

describe("候选整理和增量复审", () => {
  test("来源重复或补跑不会增加共识票数，完整定义保留，代表值不拼接字段", () => {
    const first = property("size", "规格", { type: "single", options: ["S", "M"], unit: null });
    const second = property("size", "规格", { type: "number", options: [], unit: "mm" });
    const doc = buildAttributeConsensus([
      observation("part", "19", [first]), observation("part", "27", [second]),
      observation("part", "28", [second], "27"), observation("part", "28", [second], "27"),
    ]);
    const candidate = doc.categories[0]!.properties[0]!;
    expect(doc.categories[0]?.runCount).toBe(2);
    expect(candidate.observationCount).toBe(2);
    expect(candidate.coverage).toBe(1);
    expect(candidateVariants(candidate)).toHaveLength(2);
    expect([first, second]).toContainEqual(candidateProperty(candidate));
    const oneRound = buildAttributeConsensus([observation("part", "27", [second]), observation("part", "28", [second], "27")]);
    expect(oneRound.stats.confirmedCount).toBe(0);
  });

  test("同 key 定义归组且不丢数据，重建结果稳定；不能默认 keep 多定义", () => {
    const doc = conflicting();
    const category = doc.categories[0]!;
    expect([...category.shared, ...category.properties].map((p) => p.key)).toEqual(["material", "spec"]);
    expect(candidateVariants(category.properties.find((p) => p.key === "spec")!)).toHaveLength(2);
    expect(prepareReviewCategory(category)).toEqual(category);
    expect(prepareReviewCategory({ ...category, properties: [...category.properties].reverse() })).toEqual(category);
    expect(() => parseSemanticReviewResponse(JSON.stringify({ category_id: "box", decisions: [{ key: "spec", action: "keep" }], drop_remaining: true, drop_reason: "其余不适用" }), category)).toThrow("多个定义");
    const ref = [...reviewVariantIndex(category)].find(([, v]) => v.property.unit === "kg")![0];
    const review = parseSemanticReviewResponse(JSON.stringify({ category_id: "box", decisions: [{ key: "spec", action: "keep", variant: ref }], drop_remaining: true, drop_reason: "不适用" }), category);
    expect(review.decisions.find((d) => d.key === "spec")?.property?.unit).toBe("kg");
    expect(applySemanticReviews(doc, [review]).categories[0]?.properties[0]?.unit).toBe("kg");
    const wrong = [...reviewVariantIndex(category)].find(([, v]) => v.property.key === "material")![0];
    expect(() => parseSemanticReviewResponse(JSON.stringify({ category_id: "box", decisions: [{ key: "spec", action: "keep", variant: wrong }], drop_remaining: true, drop_reason: "不适用" }), category)).toThrow("定义引用无效");
  });

  test("大输入不会按阈值丢候选，AI 明确批量删除后才展开审计记录", () => {
    const doc = prepareReviewConsensus(buildAttributeConsensus([observation("large", "19", Array.from({ length: 350 }, (_, i) => property(`field_${i}`)))]));
    const category = doc.categories[0]!;
    expect(reviewCategoryStats(category).candidateGroups).toBe(350);
    const prompt = buildSemanticReviewPrompt({ category });
    expect(prompt).toContain("field_349");
    const data = { category_id: "large", decisions: [{ key: "field_0", action: "keep" }], drop_remaining: true, drop_reason: "其余候选不适用于本类目" };
    const review = parseSemanticReviewResponse(JSON.stringify(data), category);
    expect(review.decisions).toHaveLength(350);
    expect(review.bulkDrop?.keys).toHaveLength(349);
    expect(() => parseSemanticReviewResponse(JSON.stringify({ ...data, drop_reason: "" }), category)).toThrow("drop_reason");
    expect(() => parseSemanticReviewResponse(JSON.stringify({ ...data, drop_remaining: false }), category)).toThrow("遗漏候选");
  });

  test("只更新本次成功类目，未审和失败类目的已定模板保持原定义", () => {
    const old = buildAttributeConsensus([observation("a", "19", [property("length", "长度", { type: "number", unit: "mm" })]), observation("b", "19", [property("length", "长度", { type: "number", unit: "mm" })])]);
    const reviews = old.categories.map((category) => parseSemanticReviewResponse(JSON.stringify({ category_id: category.category.id, decisions: [{ key: "length", action: "keep" }] }), category));
    const previous = applySemanticReviews(old, reviews);
    const changed = buildAttributeConsensus([observation("a", "27", [property("length", "长度", { type: "number", unit: "m" })]), observation("b", "27", [property("length", "长度", { type: "number", unit: "m" })])]);
    const incoming = parseSemanticReviewResponse(JSON.stringify({ category_id: "a", decisions: [{ key: "length", action: "keep" }] }), changed.categories[0]!);
    const merged = applySuccessfulSemanticReviews(changed, [incoming], previous);
    expect(merged.categories.find((c) => c.category.id === "a")?.properties[0]?.unit).toBe("m");
    expect(merged.categories.find((c) => c.category.id === "b")).toEqual(previous.categories.find((c) => c.category.id === "b"));
    expect(applySuccessfulSemanticReviews(changed, [], previous).categories).toEqual(previous.categories);
  });

  test("抽样覆盖普通、多定义和大输入且顺序可复现", () => {
    const ordinary = buildAttributeConsensus([observation("ordinary", "19", [property("x")])]).categories[0]!;
    const conflict = conflicting().categories[0]!;
    const large = buildAttributeConsensus([observation("large", "19", Array.from({ length: 90 }, (_, i) => property(`f${i}`)))]).categories[0]!;
    const categories = [ordinary, conflict, large];
    expect(sampleReviewCategories(categories, 3).map((c) => reviewCategoryStats(c).risk)).toEqual(["large", "conflict", "ordinary"]);
    expect(sampleReviewCategories([...categories].reverse(), 3)).toEqual(sampleReviewCategories(categories, 3));
    expect(sampleReviewCategories(categories, 99)).toHaveLength(3);
  });

  test("输入指纹含定义、证据和协议，相同输入可跳过重复复审", () => {
    const category = conflicting().categories[0]!;
    const input = { category, evidenceText: "证据 A" };
    const first = semanticReviewInputFingerprint(buildSemanticReviewPrompt(input));
    expect(semanticReviewInputFingerprint(buildSemanticReviewPrompt({ ...input, category: prepareReviewCategory(category) }))).toBe(first);
    expect(semanticReviewInputFingerprint(buildSemanticReviewPrompt({ ...input, evidenceText: "证据 B" }))).not.toBe(first);
    expect(semanticReviewInputFingerprint(buildSemanticReviewPrompt(input), "新协议")).not.toBe(first);
  });
});
