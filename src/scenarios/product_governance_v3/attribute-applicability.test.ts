import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import recorded from "./fixtures/pilot-quality-cache-20261026.json";
import { hash, jsonClone, type Task, type Snapshot } from "./core.ts";
import { loadRelease, ROOT, type Release } from "./release.ts";
import { prepareBatch, batchTask, pendingFamily, CLEAN_PAPER_ID, type BatchPlan } from "./batch.ts";
import { attributeApplicabilityErrors, modelingTargets, reuseApplicability, type AttributeApplicabilityReview } from "./attribute-applicability.ts";
import { definitionFingerprint, sharedDefinitionErrors } from "./modeling-contract.ts";
import { fixtureSnapshot, fixtureTask, scriptedFetch, finalMessage, functionCall } from "./fixtures.ts";
import { DataSnapshot } from "./snapshot.ts";
import { assemble } from "./context.ts";
import { checkResult } from "./checks.ts";
import { ToolRegistry } from "./tools.ts";
import { ResponsesClient } from "./responses.ts";
import { Budget } from "./budget.ts";
import { runStage, BATCH_CORRECTIONS } from "./runner.ts";

let release: Release, temp: string, plan: BatchPlan, serial = 0;
const next = () => join(temp, String(serial++));
const seed = recorded.cases.find(c => c.phase === "family-seed")!, wash = recorded.cases.find(c => c.phase === "leaf")!;
beforeAll(async () => {
  release = await loadRelease(); temp = await mkdtemp(join(tmpdir(), "pgv3-applicability-"));
  plan = await prepareBatch({ categoryId: CLEAN_PAPER_ID, outDir: next(), runId: recorded.provenance.runId,
    concurrency: 3, treePath: join(ROOT, "profiles/clean-paper-tree.json") }, release);
});
afterAll(async () => { await rm(temp, { recursive: true, force: true }); });

async function recordedContext(which: typeof seed) {
  const data = jsonClone(plan.snapshot), task = batchTask(plan, which.categoryId, which.phase as "family-seed" | "leaf");
  if (which.phase === "leaf") {
    // Historical generated input only; not a claim that the old seed passes the new gate.
    data.families.push(pendingFamily(plan.groups.find(g => g.id === "facial-tissue")!, { result: seed.result } as any, plan.runId));
  }
  const snapshot = new DataSnapshot(data), context = await assemble(release, snapshot, task);
  for (const id of new Set([...which.result.attributes, ...which.result.extensionCandidates]
    .flatMap(a => a.references).filter(r => r.kind === "knowledge").map(r => r.id))) {
    let offset: number | null = 0;
    do { const read = await context.tools.call("knowledge_read", { id, offset, length: 8000 }); offset = read.nextOffset; } while (offset !== null);
  }
  return { data, task, snapshot, context };
}

test("recorded cross-category reuse keeps exact definitions but fails target applicability in both real outputs", async () => {
  for (const c of [seed, wash]) {
    expect(hash(c.result)).toBe(c.resultHash);
    const { data, task, context } = await recordedContext(c);
    expect(sharedDefinitionErrors(c.result.attributes as any, data, task.runId)).toEqual([]);
    const check = checkResult(task, c.result, context.tools), errors = attributeApplicabilityErrors(c.result.attributes as any, data, task);
    expect(errors.map(e => e.objectId).sort()).toEqual(c.phase === "family-seed"
      ? ["roll.fragrance", "roll.layers", "roll.sheet_size"] : ["facial.pack_count", "roll.sheet_size"]);
    expect(check.errors).toEqual(errors);
    expect(check.executedChecks).toContain("target-category-applicability");
    // The result cannot escape by removing admissions of uncertainty or restating its confidence.
    const confident = { ...jsonClone(c.result), unresolved: [] };
    expect(checkResult(task, confident, context.tools).errors).toEqual(errors);
  }
});

const review = (data: Snapshot, targetCategoryIds: string[], overrides: Partial<AttributeApplicabilityReview> = {}): AttributeApplicabilityReview => ({
  id: "fixture-target-review", attributeId: data.attributes[0]!.id, definitionHash: definitionFingerprint(data.attributes[0]!),
  targetCategoryIds, status: "supported", reviewKind: "fixture", reviewRecordId: "synthetic-review-only",
  reason: "构造测试：不是业务核实或真实适用结论", ...overrides,
});

test("registered family coverage allows normal inheritance; a foreign pool hit requires a frozen target review", () => {
  const data = fixtureSnapshot(), task = fixtureTask("family-modeling"), a = data.attributes[0]!;
  expect(attributeApplicabilityErrors([a], data, task)).toEqual([]);
  const foreign = { ...task, categoryId: "fixture-seat-category" };
  expect(reuseApplicability(a, data, foreign).reusable).toBe(false);
  data.attributeApplicability = [review(data, [foreign.categoryId])];
  expect(attributeApplicabilityErrors([a], new DataSnapshot(data).data, foreign)).toEqual([]);
  data.attributeApplicability[0]!.status = "pending";
  expect(attributeApplicabilityErrors([a], new DataSnapshot(data).data, foreign)).toHaveLength(1);
  // An explicit pending/not-applicable record also overrides a frozen family's prior coverage.
  data.attributeApplicability = [review(data, [task.categoryId], { status: "not_applicable" })];
  expect(attributeApplicabilityErrors([a], new DataSnapshot(data).data, task)).toHaveLength(1);
});

test("family seed scope checks all target members, not only its anchor", () => {
  const data = fixtureSnapshot(), task: Task = { ...fixtureTask("family-modeling"), categoryId: "fixture-seat-category",
    candidate: { kind: "batch_modeling_scope", modelingMode: "family_seed", family: { members: [
      { id: "fixture-seat-category" }, { id: "fixture-bolt-category" },
    ] } } }, a = data.attributes[0]!;
  data.attributeApplicability = [review(data, [task.categoryId])];
  expect(modelingTargets(task, data)).toEqual(["fixture-seat-category", "fixture-bolt-category"]);
  expect(reuseApplicability(a, data, task).missingCategoryIds).toEqual(["fixture-bolt-category"]);
  data.attributeApplicability[0]!.targetCategoryIds.push("fixture-bolt-category");
  expect(attributeApplicabilityErrors([a], new DataSnapshot(data).data, task)).toEqual([]);
  expect(() => modelingTargets({ ...task, candidate: { kind: "batch_modeling_scope", modelingMode: "family_seed", family: null } }, data)).toThrow("explicit target members");
});

test("stale, fake, broad or fixture-only review records cannot authorize business reuse", () => {
  const data = fixtureSnapshot();
  data.attributeApplicability = [review(data, ["fixture-seat-category"], { definitionHash: "stale" })];
  expect(() => new DataSnapshot(data)).toThrow("stale definition fingerprint");
  data.attributeApplicability = [review(data, ["fixture-root"])];
  expect(() => new DataSnapshot(data)).toThrow("exact leaf categories");
  data.attributeApplicability = [review(data, ["fixture-seat-category"], { reviewRecordId: " " })];
  expect(() => new DataSnapshot(data)).toThrow("blank string");
  data.attributeApplicability = [review(data, ["fixture-seat-category"])]; data.kind = "local";
  expect(() => new DataSnapshot(data)).toThrow("fixture applicability review");
});

test("foreign-run, failed and in-progress family records never grant reuse even when membership matches", () => {
  const data = fixtureSnapshot(), task = fixtureTask("family-modeling"), a = data.attributes[0]!;
  for (const status of ["candidate", "failed", "in_progress"] as const) {
    data.families[0]!.status = status; data.families[0]!.runId = "foreign-run";
    expect(attributeApplicabilityErrors([a], data, task)).toHaveLength(1);
  }
  data.families[0]!.status = "candidate"; data.families[0]!.runId = task.runId;
  expect(attributeApplicabilityErrors([a], data, task)).toEqual([]);
});

test("changing only IDs, labels or scope tags cannot bypass reuse, while a genuinely different target proposal remains possible", () => {
  const data = fixtureSnapshot(), task = { ...fixtureTask("family-modeling"), categoryId: "fixture-seat-category" }, a = data.attributes[0]!;
  for (const clone of [ { ...a, id: "new" }, { ...a, id: "new", name: "新名称" },
    { ...a, id: "new", scope: "new-target", conceptKey: "new.concept" } ]) {
    expect(attributeApplicabilityErrors([clone], data, task)[0]!.message).toContain("aliases registered parameter");
  }
  const fresh = { ...a, id: "seat-compatible", conceptKey: "seat.compatibility", scope: "seat-object",
    definition: "构造样例：坐垫纸与指定分配器型号是否适配的独立提案" };
  expect(attributeApplicabilityErrors([fresh], data, task)).toEqual([]);
});

test("pool tools and prefetch expose target coverage without letting search arguments broaden the host scope", async () => {
  const data = fixtureSnapshot(), task = { ...fixtureTask("family-modeling"), categoryId: "fixture-seat-category" },
    tools = new ToolRegistry(new DataSnapshot(data), release, task);
  const found = await tools.call("search_attribute_pool", { query: "是否无芯", categoryId: "fixture-cored-category", cursor: null, limit: 10 });
  expect(found.items).toHaveLength(1);
  expect(found.reuseApplicability[0].targetCategoryIds).toEqual([task.categoryId]);
  expect(found.reuseApplicability[0].reusable).toBe(false);
  const p = await assemble(release, new DataSnapshot(data), fixtureTask("family-modeling"));
  expect((p.input.sharedContext as any).attributePool.reuseApplicability.every((r: any) => r.reusable)).toBe(true);
  expect(p.input.sharedContext.modelingTargetCategoryIds).toEqual([fixtureTask("family-modeling").categoryId]);
});

test("model output cannot invent frozen review records, and review assistance cannot erase applicability errors", async () => {
  const { task, context } = await recordedContext(wash);
  const forged = { ...jsonClone(wash.result), attributeApplicability: [{ status: "supported" }] };
  expect(checkResult(task, forged, context.tools).errors.some(e => e.message.includes("attributeApplicability: unexpected"))).toBe(true);
  const reviewTask: Task = { ...task, stage: "review-assistance", candidate: { stage: "family-modeling", result: wash.result } },
    p = await assemble(release, context.tools.snapshot, reviewTask);
  expect(p.input.candidateProgramChecks!.errors.some(e => e.message.includes("target-category applicability"))).toBe(true);
  const result = checkResult(reviewTask, { categoryId: task.categoryId, findings: [], unresolved: [] }, p.tools);
  expect(result.status).toBe("program_blocked");
});

test("explicit target uncertainty also prevents downstream SKU contract consumption", () => {
  const data = fixtureSnapshot(), task = fixtureTask("sku-filling");
  data.attributeApplicability = [review(data, [task.categoryId], { status: "pending" })];
  expect(() => new DataSnapshot(data).attributes(task)).toThrow("target-category applicability");
});

test("actual mock tool and correction loop blocks the real seed then accepts a clearly synthetic deferred proposal", async () => {
  const { snapshot, task } = await recordedContext(seed), bad = jsonClone(seed.result), good = jsonClone(bad),
    blocked = new Set(attributeApplicabilityErrors(bad.attributes as any, snapshot.data, task).map(e => e.objectId));
  for (const a of good.attributes.filter(a => blocked.has(a.id))) {
    good.extensionCandidates.push({ id: a.id, name: a.name, conceptKey: a.conceptKey, scope: a.scope,
      potentialUse: a.rationale, deferReason: "离线构造：目标范围尚无核实记录", activationCriteria: "核实目标对象适用范围，修订冻结记录后再评估", references: a.references });
    const d = good.decisions.find(d => d.objectId === a.id)!;
    d.disposition = "extension"; d.professionalReadiness = "pending";
  }
  good.attributes = good.attributes.filter(a => !blocked.has(a.id));
  good.bindings = good.bindings.filter(b => !blocked.has(b.attributeId));
  const mock = scriptedFetch([
    [functionCall("knowledge_read", { id: "small-roll-paper-research-20261022", offset: 0, length: 8000 }, "read-source"),
      functionCall("search_attribute_pool", { query: "层数", categoryId: null, cursor: null, limit: 10 }, "search-pool")],
    body => {
      const toolResults = body.input.filter((i: any) => i.type === "function_call_output").map((i: any) => JSON.parse(i.output));
      expect(toolResults.some((r: any) => r.reuseApplicability?.some((a: any) => a.attributeId === "roll.layers" && !a.reusable))).toBe(true);
      return [finalMessage(bad)];
    }, body => {
      expect(JSON.parse(body.input.at(-2).content).errors.filter((e: any) => e.message.includes("target-category applicability"))).toHaveLength(3);
      expect(body.reasoning).toEqual({ effort: "low" });
      return [finalMessage(good)];
    },
  ]);
  const dir = next(), client = new ResponsesClient({ mode: "offline", transportId: "target-applicability-test", fetch: mock.fetch }, dir, new Budget(dir, 0, "offline-zero"));
  const artifact = await runStage({ release, snapshot, task, client, outDir: dir, model: plan.model, limits: plan.limits, corrections: BATCH_CORRECTIONS });
  expect(artifact.feedback).toHaveLength(1); expect(artifact.checks.errors).toEqual([]);
  expect(artifact.result).toEqual(good); expect(mock.requests).toHaveLength(3);
  expect(artifact.productionWrites).toBe(0); expect(artifact.adoption).toBe("pending_human");
  expect(hash(seed.result)).toBe(seed.resultHash);
});
