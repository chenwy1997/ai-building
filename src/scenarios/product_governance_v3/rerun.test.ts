import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { read, save, hash, jsonClone, lock } from "./core.ts";
import { ROOT, loadRelease, type Release } from "./release.ts";
import { prepareBatch, executeBatch, CLEAN_PAPER_ID, type BatchPlan } from "./batch.ts";
import { prepareRerun } from "./batch-rerun.ts";
import { ResponsesClient, type FetchLike } from "./responses.ts";
import { Budget } from "./budget.ts";
import { attribute, binding, finalMessage, functionCall } from "./fixtures.ts";
import { main } from "./cli.ts";

let temp: string, release: Release, count = 0;
const LEAF = "f4bb18c7-b736-4fe6-91d1-60c4d05fcee6", ROLL = "67adeef9-8c1f-47e2-ad72-462ad35a5a75";
beforeAll(async () => { temp = await mkdtemp(join(tmpdir(), "pgv3-rerun-")); release = await loadRelease(); });
afterAll(async () => { await rm(temp, { recursive: true, force: true }); });
function earlierRelease() {
  const files = { ...release.files, "cli.ts": hash("constructed prior CLI release") };
  return { ...release, files, id: hash(files) } as Release;
}
const client = (directory: string, fetch: FetchLike, budget = new Budget(directory, 0, "offline-zero")) =>
  new ResponsesClient({ mode: "offline", transportId: "rerun-regression", fetch }, directory, budget);
function mock(options: { tool?: boolean; reject?: boolean; badExplanationOnce?: boolean; changedDefinition?: boolean } = {}) {
  const requests: any[] = [], seeds = new Set<string>();
  let active = 0, maximum = 0;
  const fetch: FetchLike = async (_url, init) => {
    const body = JSON.parse(init.body), input = JSON.parse(body.input[0].content), task = input.task;
    requests.push(body); active++; maximum = Math.max(maximum, active); await Bun.sleep(2); active--;
    const scope = task.candidate, seed = scope.phase === "family-seed";
    if (!seed && scope.family && scope.family.id !== "small-toilet-roll") expect(seeds.has(scope.family.id)).toBe(true);
    if (options.tool && body.input.length === 1)
      return Response.json({ status: "completed", output: [functionCall("categories_get", { id: task.categoryId }, "read-category")] });
    if (body.input.at(-1).type === "function_call_output") {
      expect(body.input.at(-1).call_id).toBe("read-category");
      expect(JSON.parse(body.input.at(-1).output).node.id).toBe(task.categoryId);
    }
    const family = input.sharedContext.family.flatMap((p: any) => p.items).find((f: any) => f.usable);
    const attributes = family ? jsonClone(family.attributes) : [attribute({ id: "test.rerun." + (scope.family?.id ?? task.categoryId),
      name: "构造验收参数", conceptKey: "test.rerun." + (scope.family?.id ?? task.categoryId), fieldType: "text" })];
    const bindings = attributes.map((a: any) => ({
      ...(family?.bindings.find((b: any) => b.attributeId === a.id && b.categoryId === task.categoryId) ??
        family?.bindings.find((b: any) => b.attributeId === a.id && b.categoryId === null) ?? binding(a.id)),
      categoryId: task.categoryId, baselineAttributeId: family ? a.id : null }));
    if (options.reject) attributes[0].name = "品牌";
    if (options.changedDefinition) attributes.find((a: any) => a.id === "roll.declared_mass").numberConfig.precision = 2;
    const badExplanation = options.badExplanationOnce && requests.length === 1;
    if (options.badExplanationOnce) {
      expect(input.sharedContext.currentBaselineConfiguration.items.find((a: any) => a.attributeId === "roll.declared_mass").facts["numberConfig.precision"]).toBe(3);
      if (!badExplanation) expect(JSON.parse(body.input.at(-1).content).errors.some((e: any) => e.ruleId === "R08")).toBe(true);
    }
    if (seed) seeds.add(scope.family.id);
    return Response.json({ status: "completed", output: [finalMessage({ categoryId: task.categoryId,
      baselineVersion: family?.version ?? null, attributes, bindings, extensionCandidates: family?.extensionCandidates ?? [],
      unresolved: [badExplanation ? "单卷重量精度均留null" : "构造验收，非真实DeepSeek业务结果；精度依据仍待核实"] })] });
  };
  return { fetch, requests, get maximum() { return maximum; } };
}
async function original(categoryId = LEAF, budget?: (dir: string) => Budget) {
  const dir = join(temp, String(++count)), old = earlierRelease(), p = await prepareBatch({ categoryId, outDir: dir,
    runId: "original-rerun-test", treePath: join(ROOT, "profiles/clean-paper-tree.json"), concurrency: 3 }, old), m = mock();
  await executeBatch(p, old, client(dir, m.fetch, budget?.(dir)));
  return { dir, p };
}
const prepare = (dir: string, options: Partial<Parameters<typeof prepareRerun>[0]> = {}) =>
  prepareRerun({ directory: dir, roundName: "rules-20261023", concurrency: 4, ...options }, release);

test("full rerun previews all 21 leaves and two seeds without reusing historical proposals or resetting accounting", async () => {
  const { dir } = await original(CLEAN_PAPER_ID), names = ["batch.identity.json", "batch.results.json", "batch.review.json", "budget.json"],
    before = await Promise.all(names.map(async (name) => hash(await read(join(dir, name))))), r = await prepare(dir);
  expect(r.preview.leafCount).toBe(21); expect(r.preview.familySeeds).toHaveLength(2);
  expect(r.preview.sourceProposalsReused).toBe(0); expect(r.preview.originalRequestCount).toBe(23);
  expect(r.preview.preservedReviewedBaselineFamilies).toEqual(["small-toilet-roll"]);
  expect(r.preview.networkCalls).toBe(0); expect(r.preview.ready).toBe(true);
  expect(r.plan.accounting!.directory).toBe(dir);
  expect(r.plan.snapshot.families).toHaveLength(1);
  expect(r.plan.snapshot.families[0]!.runId).toBe(r.plan.runId);
  expect(await Promise.all(names.map(async (name) => hash(await read(join(dir, name)))))).toEqual(before);
  expect(await Bun.file(join(r.plan.outDir, "budget.json")).exists()).toBe(false);
});

test("new round really regenerates passed leaves with current context, tools, seed barrier and requested concurrency", async () => {
  const { dir } = await original(CLEAN_PAPER_ID), r = await prepare(dir), m = mock({ tool: true });
  const result = await executeBatch(r.plan, release, client(dir, m.fetch));
  expect(result.total).toBe(21); expect(result.passed).toBe(21); expect(result.familySeeds).toHaveLength(2);
  expect(result.mockCallsThisExecution).toBe(46); expect(result.networkCallsThisExecution).toBe(0);
  expect(m.maximum).toBeLessThanOrEqual(4); expect(m.maximum).toBeGreaterThan(1);
  for (const body of m.requests) {
    const input = JSON.parse(body.input[0].content);
    expect(input.task.runId).toBe(r.plan.runId);
    expect(input.sharedContext.releaseId).toBe(release.id);
    expect(input.sharedContext.currentBaselineConfiguration).toBeDefined();
    expect(body.instructions).toContain("配置事实、业务疑点与说明一致性");
    expect(body.instructions).toContain("建模正反例");
    expect(body.tools.some((t: any) => t.name === "categories_search")).toBe(true);
    expect(input.sharedContext.knowledge.some((k: any) => k.id === "clean-paper-admission-20261023")).toBe(true);
  }
  expect((await read(join(dir, "budget.json"))).entries).toHaveLength(23 + 46);
  expect(await Bun.file(join(r.plan.outDir, "budget.json")).exists()).toBe(false);
  expect((await read(join(r.plan.outDir, "batch.review.json"))).issues).toHaveLength(21);
  const resumed = await prepare(dir, { concurrency: 32 });
  expect(resumed.plan.id).toBe(r.plan.id);
  const replay = await executeBatch(resumed.plan, release, client(dir, async () => { throw Error("must not call HTTP again"); }));
  expect(replay.mockCallsThisExecution).toBe(0); expect(replay.cacheHitsThisExecution).toBe(46);
  expect(replay.sharedSnapshotVersion).toBe(result.sharedSnapshotVersion);
});

test("failed new-round proposals replay rather than silently buying another correction loop", async () => {
  const { dir } = await original(), r = await prepare(dir), m = mock({ reject: true });
  const first = await executeBatch(r.plan, release, client(dir, m.fetch));
  expect(first.blocked).toBe(1); expect(m.requests).toHaveLength(3);
  const again = await executeBatch((await prepare(dir)).plan, release, client(dir, async () => { throw Error("do not repay"); }));
  expect(again.mockCallsThisExecution).toBe(0); expect(again.cacheHitsThisExecution).toBe(3);
  expect((await read(join(dir, "budget.json"))).entries).toHaveLength(4);
});

test("the current R08 feedback corrects explanations without changing the frozen roll definition", async () => {
  const { dir } = await original(ROLL), r = await prepare(dir), m = mock({ badExplanationOnce: true });
  const result = await executeBatch(r.plan, release, client(dir, m.fetch));
  expect(m.requests).toHaveLength(2); expect(result.passed).toBe(1);
  expect(result.leaves[0]!.artifact!.feedback[0]!.code).toBe("program_checks");
  expect((result.leaves[0]!.artifact!.result as any).attributes.find((a: any) => a.id === "roll.declared_mass").numberConfig.precision).toBe(3);
});

test("full rerun does not weaken R03 when a model changes a reviewed shared definition", async () => {
  const { dir } = await original(ROLL), r = await prepare(dir), m = mock({ changedDefinition: true });
  const result = await executeBatch(r.plan, release, client(dir, m.fetch));
  expect(result.blocked).toBe(1); expect(m.requests).toHaveLength(3);
  expect(result.leaves[0]!.artifact!.checks.errors.some((e) => e.ruleId === "R03")).toBe(true);
});

test("same round freezes release and selected scope but permits concurrency changes", async () => {
  const { dir } = await original(CLEAN_PAPER_ID), r = await prepare(dir), changed = earlierRelease();
  expect((await prepare(dir, { concurrency: 32 })).plan.id).toBe(r.plan.id);
  await expect(prepareRerun({ directory: dir, roundName: "rules-20261023", concurrency: 32 }, changed)).rejects.toThrow("already has different frozen");
  await expect(prepare(dir, { categoryId: LEAF })).rejects.toThrow("already has different frozen");
  await expect(prepare(dir, { roundName: "../escape" })).rejects.toThrow("--round");
  await expect(prepare(dir, { concurrency: 0 })).rejects.toThrow("concurrency");
  await expect(prepare(r.plan.outDir)).rejects.toThrow();
});

test("an explicitly different round still shares the original accumulated ledger", async () => {
  const { dir } = await original(), first = await prepare(dir);
  await executeBatch(first.plan, release, client(dir, mock().fetch));
  const second = await prepare(dir, { roundName: "explicit-second-round" });
  expect(second.preview.originalRequestCount).toBe(2);
  await executeBatch(second.plan, release, client(dir, mock().fetch));
  expect((await read(join(dir, "budget.json"))).entries).toHaveLength(3);
  expect((await read(join(dir, "batch.results.json"))).total).toBe(1);
});

test("unknown source outcomes, tampered response hashes and missing reservations cannot be hidden by a new round", async () => {
  for (const change of ["unknown", "response", "ledger", "source"]) {
    const { dir } = await original(), budget = await read(join(dir, "budget.json")), key = budget.entries[0].id;
    if (change === "unknown") { budget.entries[0].status = "outcome_unknown"; await save(join(dir, "budget.json"), budget); }
    if (change === "ledger") { budget.entries = []; await save(join(dir, "budget.json"), budget); }
    if (change === "response") { const path = join(dir, "requests", key + ".response.json"), record = await read(path); record.response.output = []; await save(path, record); }
    if (change === "source") { const path = join(dir, "batch.identity.json"), value = await read(path); value.runId = "tampered"; await save(path, value); }
    await expect(prepare(dir)).rejects.toThrow();
  }
});

test("unknown new-round outcomes retain their reservation and cannot be rebought through prepare", async () => {
  const { dir } = await original(), r = await prepare(dir);
  const result = await executeBatch(r.plan, release, client(dir, async () => { throw Error("synthetic disconnected transport"); }));
  expect(result.blocked).toBe(1);
  expect((await read(join(dir, "budget.json"))).entries.at(-1).status).toBe("outcome_unknown");
  await expect(prepare(dir)).rejects.toThrow("unresolved paid outcome");
});

test("rerun cannot spend a child ledger or change its parent accounting identity", async () => {
  const { dir } = await original(), r = await prepare(dir);
  const wrong = client(r.plan.outDir, async () => { throw Error("never"); });
  await expect(executeBatch(r.plan, release, wrong)).rejects.toThrow("same output directory and budget");
  const idPath = join(r.plan.outDir, "rerun.identity.json"), record = await read(idPath);
  record.sourceBatchId = "wrong"; await save(idPath, record);
  await expect(executeBatch(r.plan, release, client(dir, mock().fetch))).rejects.toThrow("frozen identity");
});

test("the original cumulative budget caps a full rerun and stops subsequent paid dispatch", async () => {
  class Metered extends Budget { override reserve(id: string, _amount: number) { return super.reserve(id, 1.3); } }
  const { dir } = await original(LEAF, (dir) => new Metered(dir, 2.6, "offline-metered"));
  const r = await prepare(dir), budget = new Metered(dir, 2.6, "offline-metered"), m = mock({ reject: true });
  expect(r.preview.cumulativeReservedCny).toBe(1.3); expect(r.preview.remainingReservationCny).toBe(1.3);
  const result = await executeBatch(r.plan, release, client(dir, m.fetch, budget));
  expect(m.requests).toHaveLength(1); expect(result.blocked).toBe(1);
  expect(result.budget.committedUpperBoundCny).toBe(2.6);
  const second = await executeBatch((await prepare(dir)).plan, release, client(dir, async () => { throw Error("budget cannot reset"); }, budget));
  expect(second.mockCallsThisExecution).toBe(0);
});

test("rerun holds the original process lock, even when output goes into a child round", async () => {
  const { dir } = await original(), r = await prepare(dir), m = mock();
  let entered!: () => void, unlock!: () => void, previewFinished = false;
  const acquired = new Promise<void>((r) => { entered = r; }), gate = new Promise<void>((r) => { unlock = r; });
  const holder = lock(join(dir, "execution.lock"), async () => { entered(); await gate; });
  await acquired;
  const preview = prepare(dir).then((r) => { previewFinished = true; return r; });
  const execution = executeBatch(r.plan, release, client(dir, m.fetch));
  await Bun.sleep(60);
  expect(previewFinished).toBe(false); expect(m.requests).toHaveLength(0);
  unlock(); await holder;
  await Promise.all([preview, execution]);
  expect(m.requests).toHaveLength(1);
});

test("CLI preview requires no credentials, accepts category/concurrency and rejects source or budget replacement", async () => {
  const { dir } = await original(CLEAN_PAPER_ID);
  const result: any = await main(["batch-rerun", "--out", dir, "--round", "preview-only", "--category-id", LEAF, "--concurrency", "32", "--no-excel"]);
  expect(result.mode).toBe("new_round_preview"); expect(result.leafCount).toBe(1); expect(result.concurrency).toBe(32);
  expect(result.networkCalls).toBe(0);
  await expect(main(["batch-rerun", "--out", dir])).rejects.toThrow("--round required");
  for (const args of [["--budget-cny", "999"], ["--tree", "new-tree.json"], ["--stage", "sku-filling"]])
    await expect(main(["batch-rerun", "--out", dir, "--round", "new", ...args])).rejects.toThrow("沿用原批次资料和累计预算");
  await expect(main(["batch-rerun", "--out", dir, "--round", "preview-only", "--category-id", LEAF, "--execute"])).rejects.toThrow("构造离线批次");
});
