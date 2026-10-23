import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configurationFacts, configurationSummary, configurationBasisNotes,
  reviewConfigurationStatements, modelConfigurationReview, projectConfigurationReview } from "./scripts/configuration-review.mjs";
import { attribute, binding, fixtureSnapshot, fixtureTask, fixtureOutput, finalMessage, scriptedFetch } from "./fixtures.ts";
import { hash, read, jsonClone } from "./core.ts";
import { loadRelease, type Release } from "./release.ts";
import { DataSnapshot } from "./snapshot.ts";
import { assemble } from "./context.ts";
import { checkResult } from "./checks.ts";
import { runStage, BATCH_CORRECTIONS } from "./runner.ts";
import { ResponsesClient } from "./responses.ts";
import { Budget } from "./budget.ts";

const mass = () => attribute({ id: "test-mass", name: "单卷重量", fieldType: "number", unit: "g",
  numberConfig: { isInt: false, precision: 3, min: 0, max: null } });
const layers = () => attribute({ id: "test-layers", name: "层数", fieldType: "number", unit: "层",
  numberConfig: { isInt: true, precision: null, min: 1, max: null } });
const actualMiss = "层数与单卷重量的精度/上限等专业阈值未获已读资料支持，均留 null，待专业查证后另提共享基线修订。";
const review = (text: string, attrs = [mass(), layers()]) => reviewConfigurationStatements(attrs,
  attrs.map((a) => binding(a.id)), [text]);
let release: Release, temp: string;
beforeAll(async () => { release = await loadRelease(); temp = await mkdtemp(join(tmpdir(), "pgv3-explanations-")); });
afterAll(async () => { await rm(temp, { recursive: true, force: true }); });

test("host summaries preserve configured precision, null, zero and false without claiming professional confirmation", () => {
  const a = mass(), b = binding(a.id), facts = configurationFacts(a, b), text = configurationSummary(a, b);
  expect(facts["numberConfig.precision"]).toBe(3);
  expect(facts["numberConfig.min"]).toBe(0);
  expect(facts.searchable).toBe(false);
  for (const part of ["小数精度=3", "下限=0", "上限=未设置（null）", "搜索=否", "选填"])
    expect(text).toContain(part);
  expect(text).not.toContain("无限制");
  expect(configurationBasisNotes(a).join()).toContain("合同未逐字段登记精度依据");
  expect(configurationBasisNotes(layers())).toEqual([]);
});
test("text, option and date summaries do not invent number constraints", () => {
  const text = attribute({ fieldType: "text" }), option = attribute({ fieldType: "option", enumValues: ["甲", "乙"], multi: true });
  expect(configurationSummary(text)).toContain("去首尾空白=是");
  expect(configurationSummary(option)).toContain("枚举=甲、乙");
  expect(configurationSummary(option)).toContain("多选=是");
  expect(configurationSummary(attribute({ fieldType: "date" }))).not.toContain("小数精度");
});
test("the actual missed collective-null assertion identifies only the conflicting weight precision", () => {
  const report = review(actualMiss);
  expect(report.claims).toHaveLength(4);
  expect(report.conflicts).toHaveLength(1);
  expect(report.conflicts[0]).toMatchObject({ attributeId: "test-mass", field: "numberConfig.precision", claimed: null, actual: 3 });
  expect(report.businessValuesModified).toBe(false);
});
test("explicit numeric precision and bounds compare exact values, including zero", () => {
  expect(review("单卷重量精度为2").conflicts[0]).toMatchObject({ claimed: 2, actual: 3 });
  expect(review("单卷重量下限为0").conflicts).toEqual([]);
  expect(review("单卷重量下限为null").conflicts[0]).toMatchObject({ claimed: null, actual: 0 });
  expect(review("单卷重量上限为500").conflicts[0]).toMatchObject({ claimed: 500, actual: null });
  expect(review("单卷重量保留3位小数").conflicts).toEqual([]);
  expect(review("单卷重量精度未设置").conflicts[0]).toMatchObject({ claimed: null, actual: 3 });
  expect(review("单卷重量的精度和上限均未设置").conflicts).toHaveLength(1);
});
test("global claims have a numeric scope and do not invent constraints for boolean fields", () => {
  const report = review("所有数值属性精度均为null", [mass(), layers(), attribute()]);
  expect(report.claims).toHaveLength(2);
  expect(report.conflicts).toHaveLength(1);
});
test("questions, recommendations and hypothetical examples remain unresolved human questions", () => {
  for (const text of ["单卷重量精度是否应改为null？", "建议单卷重量精度设为null", "单卷重量精度待核实",
    "需核实单卷重量3位精度的依据，必要时另提共享修订", "如果单卷重量精度为null", "例如：单卷重量精度为null",
    "原说明：单卷重量精度为null", "旧方案单卷重量精度为null", "不能写单卷重量精度为null"])
    expect(review(text).conflicts).toEqual([]);
});
test("a present-tense assertion before a proposed revision is still checked", () => {
  expect(review("单卷重量当前精度为2，建议改为null").conflicts).toHaveLength(1);
});
test("scope does not leak between attributes or sentences", () => {
  expect(review("层数精度为null，单卷重量精度为3。层数上限为null。").conflicts).toEqual([]);
  expect(review("精度为null").unscoped).toHaveLength(1);
  expect(review("精度为null").conflicts).toEqual([]);
});
test("requiredness, search, public and type assertions use actual binding and definition fields", () => {
  for (const text of ["单卷重量填写要求为必填", "单卷重量搜索开关为true", "单卷重量公开属性为否", "单卷重量字段类型为文本"])
    expect(review(text).conflicts).toHaveLength(1);
  expect(review("单卷重量填写要求为选填，搜索开关为false，公开属性为是").conflicts).toEqual([]);
  expect(review("是否无芯字段类型为文本", [attribute()]).conflicts).toHaveLength(1);
});
test("attribute and binding explanations have their own object scope", () => {
  const a = mass(), b = binding(a.id, { requirednessReason: "填写要求为必填" });
  a.rationale = "当前精度为2";
  const report = modelConfigurationReview({ attributes: [a], bindings: [b], unresolved: [] });
  expect(report.conflicts.map((c) => c.field)).toEqual(["numberConfig.precision", "requiredness"]);
});
test("configuration assertions are part of the real request, result checker and bounded correction loop", async () => {
  const dir = join(temp, "correction"), good = fixtureOutput("family-modeling"), bad = jsonClone(good);
  bad.unresolved = ["层数精度为3"];
  const originalDefinitions = hash(bad.attributes), originalBindings = hash(bad.bindings);
  const mock = scriptedFetch([
    (body) => {
      expect(body.instructions).toContain("配置事实、业务疑点与说明一致性");
      expect(body.instructions).toContain("unresolved写业务问题");
      const context = JSON.parse(body.input[0].content).sharedContext.currentBaselineConfiguration;
      expect(context.source).toBe("frozen_contract_host_projection");
      expect(context.items.find((a: any) => a.name === "层数").facts["numberConfig.precision"]).toBeNull();
      return [finalMessage(bad)];
    },
    (body) => {
      const feedback = JSON.parse(body.input.at(-1).content);
      expect(feedback.errors.some((e: any) => e.ruleId === "R08" && e.message.includes("configuration explanation"))).toBe(true);
      return [finalMessage(good)];
    },
  ]);
  const client = new ResponsesClient({ mode: "offline", transportId: "explanation-regression", fetch: mock.fetch }, dir, new Budget(dir, 0, "offline-zero"));
  const artifact = await runStage({ release, snapshot: new DataSnapshot(fixtureSnapshot()), task: fixtureTask("family-modeling"),
    client, outDir: dir, corrections: BATCH_CORRECTIONS });
  expect(artifact.checks.errors).toEqual([]);
  expect(artifact.checks.executedChecks).toContain("configuration-explanations");
  expect(artifact.feedback).toHaveLength(1);
  expect(mock.requests).toHaveLength(2);
  expect(hash((artifact.result as any).attributes)).toBe(originalDefinitions);
  expect(hash((artifact.result as any).bindings)).toBe(originalBindings);
  expect(artifact.businessRepairs).toBe(0);
  const raw = await read(join(dir, "requests", artifact.requestKeys[0] + ".response.json"));
  expect(raw.response.output[0].content[0].text).toContain("层数精度为3");
});
test("bad explanations stay blocked without correction; a review model cannot erase the candidate error", async () => {
  const bad = fixtureOutput("family-modeling"); bad.unresolved = ["层数精度为3"];
  const task = fixtureTask("family-modeling"), snapshot = new DataSnapshot(fixtureSnapshot()), plan = await assemble(release, snapshot, task);
  expect(checkResult(task, bad, plan.tools).errors.some((e) => e.ruleId === "R08")).toBe(true);
  const reviewTask = { ...fixtureTask("review-assistance"), candidate: { stage: "family-modeling", result: bad } },
    reviewPlan = await assemble(release, snapshot, reviewTask), result = fixtureOutput("review-assistance");
  result.findings = [];
  expect(reviewPlan.input.candidateProgramChecks?.errors.some((e) => e.ruleId === "R08")).toBe(true);
  expect(checkResult(reviewTask, result, reviewPlan.tools).status).toBe("program_blocked");
});

function historicalReview() {
  const a = mass(), b = binding(a.id, { categoryId: "historical-leaf" }), config = { ...a, references: undefined, ...b };
  return { format: 1, categoryCount: 1, productionWrites: 0, adoption: "pending_human",
    attributes: [[a.name, "构造类目", "选填", "数值 / g", a.rationale, "同意", "原有人工意见", a.definition, b.requirednessReason,
      "", "族", "路径", a.id, a.conceptKey, a.scope, JSON.stringify(config), "引用"]],
    extensions: [], issues: [["构造类目", "程序通过，待人工审阅", actualMiss, "保留意见", 1, "族", "", "路径", "historical-leaf", "run", "old-release"]] };
}
test("the export projection preserves source values and opinions while separating current facts and conflicting prose", () => {
  const input = historicalReview(), before = JSON.stringify(input), projected = projectConfigurationReview(input);
  expect(JSON.stringify(input)).toBe(before);
  expect(projected.attributes[0].slice(0, 17)).toEqual(input.attributes[0]);
  expect(projected.attributes[0][17]).toContain("小数精度=3");
  expect(projected.issues[0][1]).toBe("说明冲突，待复审");
  expect(projected.issues[0][2]).toContain("小数精度当前=3位");
  expect(projected.issues[0][2]).not.toContain("均留 null");
  expect(projected.issues[0][3]).toBe("保留意见");
  expect(projected.issues[0][11]).toBe(actualMiss);
  expect(projected.configurationAudit).toMatchObject({ historical: true, contractRevalidated: false, newModelRequests: 0,
    businessValuesModified: false, conflictCount: 1 });
  expect(projected.configuration[0][5]).toContain("均留 null");
});
test("the exporter refuses mismatched row/config identities instead of prettifying a corrupt review", () => {
  const input = historicalReview(); input.attributes[0]![0] = "别的属性";
  expect(() => projectConfigurationReview(input)).toThrow("identity mismatch");
});
test("audit projection never silently drops an orphan or duplicate attribute or category", () => {
  const orphan = historicalReview(); orphan.issues[0]![8] = "different-category";
  expect(() => projectConfigurationReview(orphan)).toThrow("identity mismatch");
  const duplicate = historicalReview(); duplicate.attributes.push(jsonClone(duplicate.attributes[0]!));
  expect(() => projectConfigurationReview(duplicate)).toThrow("identity mismatch");
  const categories = historicalReview(); categories.issues.push(jsonClone(categories.issues[0]!));
  expect(() => projectConfigurationReview(categories)).toThrow("duplicate review category");
});
