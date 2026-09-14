import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SQL } from "bun";
import type { AiService } from "../src/ai/service.ts";
import { writeJsonFile, writeTextFile } from "../src/facilities/json/files.ts";
import { normalizeCategories } from "../src/scenarios/category_governance/category-tree.ts";
import { parseGovernanceResponsePartial } from "../src/scenarios/category_governance/template-codec.ts";
import { normalizeGovernanceRunId, planGovernanceRetry } from "../src/scenarios/category_governance/retry.ts";
import { runGovernance } from "../src/scenarios/category_governance/runner.ts";
import { shortCategoryId } from "../src/scenarios/category_governance/util.ts";

const document = normalizeCategories({ items: [
  { id: "root", name: "标准类目" },
  { id: "a", name: "纸", fatherId: "root" },
  { id: "b", name: "管", fatherId: "root" },
  { id: "c", name: "箱", fatherId: "root" },
] }, "v1");
const targets = document.nodes.filter((node) => node.isLeaf);
const hash = createHash("sha256").update(JSON.stringify(document)).digest("hex");
const directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
const response = (ids: string[], missingUnitIds: string[] = []) => ({
  v: 1,
  a: {
    ok: ["material", "材质", "t", "", null, [], "", null, null, "category"],
    bad: ["diameter", "直径", "n", "", null, [], "", null, null, "category"],
  },
  c: Object.fromEntries(ids.map((id) => [id, [[], [missingUnitIds.includes(id) ? "bad" : "ok"], []]])),
});
async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "governance-retry-"));
  directories.push(dir);
  await writeJsonFile(join(dir, "context/v1/category-tree.json"), document);
  return dir;
}
function mockDatabase() {
  const insertedIds: string[] = [];
  const query = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?");
    if (sql.includes("INSERT INTO governance_runs_v1")) return [{ id: 9 }];
    if (sql.includes("INSERT INTO attribute_templates_v1")) insertedIds.push(String(values[2]));
    return [];
  };
  return { database: Object.assign(query, { begin: async (fn: (tx: typeof query) => Promise<void>) => fn(query) }) as unknown as SQL, insertedIds };
}
const options = { version: "v1", groupDepth: 1, batchSize: 12, concurrency: 2, attempts: 2, dryRun: false, provider: "deepseek", model: "flash", jdEvidenceEnabled: false };

describe("治理失败恢复", () => {
  test("只修复末尾闭合符；字符串截断和正文语法错误仍拒绝", () => {
    const valid = JSON.stringify(response(["a"]));
    const broken = valid.replace(/\]\}\}$/u, "}}}");
    const parsed = parseGovernanceResponsePartial(broken, [targets[0]!]);
    expect(parsed.results.map((r) => r.category.id)).toEqual(["a"]);
    expect(parsed.repairedClosingDelimiters).toBe(true);
    expect(() => parseGovernanceResponsePartial('{"a":{"x":["材质未完', targets)).toThrow();
    expect(() => parseGovernanceResponsePartial(valid.replace('"material","材质"', '"material" "材质"'), targets)).toThrow();
    expect(() => parseGovernanceResponsePartial(valid.slice(0, -2), targets)).toThrow();
  });

  test("隔离未知引用、遗漏和坏单位，忽略无关辅助键但不把它当目标", () => {
    const data = response(["a", "b"], ["b"]);
    Object.assign(data.c, { __unused__: "非类目说明" });
    const parsed = parseGovernanceResponsePartial(JSON.stringify(data), targets);
    expect(parsed.results.map((r) => r.category.id)).toEqual(["a"]);
    expect(parsed.errors).toEqual([{ categoryId: "b", error: "数字属性 直径 必须填写 unit" }, { categoryId: "c", error: "缺少目标类目" }]);
    expect(parsed.ignoredCategoryIds).toEqual(["__unused__"]);
    data.c.b = [[], ["missing"], []];
    expect(parseGovernanceResponsePartial(JSON.stringify(data), targets).errors[0]?.error).toContain("未知属性引用");
  });

  test("完整 ID 和短 ID 重复时拒绝歧义；功率因数无量纲", () => {
    const data = response(["a", shortCategoryId("a")]);
    expect(parseGovernanceResponsePartial(JSON.stringify(data), [targets[0]!]).results).toHaveLength(0);
    const unit = { v: 1, a: { x: ["length", "长度", "n", "", ["mm"], [], "", null, null, "category"], y: ["power_factor", "功率因数", "n", "", null, [], "", null, null, "category"] }, c: { a: [[], ["x", "y"], []] } };
    expect(parseGovernanceResponsePartial(JSON.stringify(unit), [targets[0]!]).results[0]?.properties.map((p) => p.unit)).toEqual(["mm", null]);
    unit.a.x[4] = ["mm", "cm"];
    expect(parseGovernanceResponsePartial(JSON.stringify(unit), [targets[0]!]).errors[0]?.error).toContain("单个单位");
  });

  test("不能为通过校验而丢弃非空的额外字段或把必填星号猜成单位", () => {
    const ambiguous = { v: 1, a: { x: ["material", "材质", "t", "*", [], "说明", null, null, "category"] as unknown[] }, c: { a: [[], ["x"], []] } };
    expect(parseGovernanceResponsePartial(JSON.stringify(ambiguous), [targets[0]!]).errors).toHaveLength(1);
    ambiguous.a.x = ["capacity", "容量", "n", "", null, "L", [], ["不可丢弃"], "说明", null, null, "category"];
    expect(parseGovernanceResponsePartial(JSON.stringify(ambiguous), [targets[0]!]).errors).toHaveLength(1);
  });

  test("沿来源链免费恢复，精确按历史请求 ID 选择；上下文变更拒绝混用", async () => {
    const root = await workspace();
    const outputRoot = join(root, "output/v1");
    for (const [run, ids, retryRunId] of [[7, ["a", "b", "c"], null], [8, ["a", "b"], "7"]] as const) {
      await writeJsonFile(join(outputRoot, `run-${run}/manifest.json`), { version: "v1", groupDepth: 1, retryRunId, source: { contextSha256: hash }, errors: [{ key: "任意旧批次-80" }] });
      await writeJsonFile(join(outputRoot, `run-${run}/任意旧批次-80/attempt-001.request.json`), { categoryIds: ids });
      await writeTextFile(join(outputRoot, `run-${run}/任意旧批次-80/attempt-001.raw.txt`), JSON.stringify(response([...ids], run === 8 ? ["b"] : ["a"])));
    }
    const plan = await planGovernanceRetry({ outputRoot, runId: "run-8", document, contextSha256: hash });
    expect(plan.groups[0]?.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect([...plan.recovered.keys()].sort()).toEqual(["a", "b"]);
    expect(plan.recovered.get("b")?.source.runId).toBe("7");
    expect(plan.recovered.has("c")).toBe(false);
    expect(() => normalizeGovernanceRunId("../x")).toThrow();
    await expect(planGovernanceRetry({ outputRoot, runId: "8", document, contextSha256: "changed" })).rejects.toThrow("上下文不同");
    let calls = 0;
    const db = mockDatabase();
    const result = await runGovernance({ ...options, workspace: root, database: db.database, ai: { chat: async () => { calls += 1; throw new Error("不应请求 AI"); } } as unknown as AiService, retryRunId: "8", batchSize: 1 });
    expect(calls).toBe(0);
    expect(result.recoveredCategoryCount).toBe(2);
    expect(result.failedCategoryCount).toBe(0);
    expect(db.insertedIds.sort()).toEqual(["a", "b"]);
  });

  test("一次请求的成功类目落盘入库，后续只发失败类目；新 run 可继续缩小补跑", async () => {
    const root = await workspace();
    const db = mockDatabase();
    let calls = 0;
    const ai = { async chat(_provider: string, _model: string, request: { thinking: unknown }) {
      expect(request.thinking).toEqual({ type: "disabled" });
      calls += 1;
      return { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(calls === 1 ? response(["a", "b", "c"], ["b", "c"]) : response(["b", "c"], ["c"])) } }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } };
    } } as unknown as AiService;
    const result = await runGovernance({ ...options, workspace: root, database: db.database, ai });
    expect(result.successCount).toBe(2);
    expect(result.failedCategoryCount).toBe(1);
    expect(result.promptTokens).toBe(200);
    expect(db.insertedIds.sort()).toEqual(["a", "b"]);
    const request = await Bun.file(join(result.outputDir, "标准类目-1/attempt-002.request.json")).json();
    expect(request.categoryIds).toEqual(["b", "c"]);
    const file = await Bun.file(join(result.outputDir, "标准类目-1/results.json")).json();
    expect(Object.keys(file.c).sort()).toEqual(["a", "b"]);
    const plan = await planGovernanceRetry({ outputRoot: join(root, "output/v1"), runId: "9", document, contextSha256: hash });
    expect(plan.groups[0]?.nodes.map((n) => n.id)).toEqual(["c"]);
    expect(plan.recovered.size).toBe(0);
  });

  test("补跑按准确目标拆分，原批次命名和 batch-size 改变不影响覆盖", async () => {
    const root = await workspace();
    await writeJsonFile(join(root, "output/v1/run-8/manifest.json"), { version: "v1", groupDepth: 1, errors: [{ key: "旧批次-99", categoryIds: ["b", "c"] }] });
    await writeJsonFile(join(root, "output/v1/run-8/旧批次-99/attempt-001.request.json"), { categoryIds: ["a", "b", "c"] });
    const db = mockDatabase();
    let calls = 0;
    const ai = { async chat() { calls += 1; return { choices: [{ message: { content: JSON.stringify(response(["a", "b", "c"])) } }] }; } } as unknown as AiService;
    const result = await runGovernance({ ...options, workspace: root, database: db.database, ai, retryRunId: "8", retryBatchSize: 1, batchSize: 20 });
    expect(calls).toBe(2);
    expect(db.insertedIds.sort()).toEqual(["b", "c"]);
    expect(result.failedCategoryCount).toBe(0);
  });
});
