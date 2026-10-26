import { beforeAll, afterAll, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import recording from "./fixtures/pilot-tissue-context-20261026.json";
import { read, save, hash, jsonClone, canonical } from "./core.ts";
import { loadRelease, type Release } from "./release.ts";
import { DataSnapshot } from "./snapshot.ts";
import { assemble } from "./context.ts";
import { assembleStageContext, HISTORY_HEADROOM_BYTES } from "./stage-context.ts";
import { batchTask, pendingFamily, executeBatch, type BatchPlan, type BatchJob } from "./batch.ts";
import { prepareRerun } from "./batch-rerun.ts";
import { prepareContinuation } from "./batch-continuation.ts";
import { Budget } from "./budget.ts";
import { ResponsesClient } from "./responses.ts";
import { runStage, BATCH_CORRECTIONS } from "./runner.ts";
import { scriptedFetch, finalMessage, functionCall, fixtureWireResult } from "./fixtures.ts";
import { main } from "./cli.ts";

let temp: string, release: Release, seq = 0;
const BOX = "640b5b8b-9d6e-4784-a8e2-53c291f0b7f7", SOFT = "ce3a9f67-613c-4707-bf3a-95193edb8a2d",
  WASH = "7a1ea510-8777-46ba-bfa0-955b472a0d61", ids = [BOX, SOFT], round = "recorded-tissue-context";
const next = () => join(temp, String(++seq));
const recordedPlan = () => {
  const plan: any = jsonClone(recording.plan);
  plan.snapshot.tree = JSON.parse(gunzipSync(Buffer.from(recording.snapshotTreeGzipBase64, "base64")).toString("utf8"));
  return plan as BatchPlan;
};
const priorHost = () => ({ ...release, files: { ...release.files, "context.ts": recording.plan.releaseId },
  id: recording.plan.releaseId });
const client = (dir: string, fetch: any) => new ResponsesClient({ mode: "offline", transportId: "context-continuation-fixture", fetch },
  dir, new Budget(dir, 0, "offline-zero"));
beforeAll(async () => { temp = await mkdtemp(join(tmpdir(), "pgv3-continuation-")); release = await loadRelease(); });
afterAll(async () => { await rm(temp, { recursive: true, force: true }); });

test("recorded 200664-byte full context reproduces the exact old failure and fits the unchanged request cap with history space", async () => {
  const plan = recordedPlan(), { id, ...identity } = plan;
  expect(hash(identity)).toBe(id); expect(hash(plan.snapshot)).toBe(plan.inputVersion);
  const data = jsonClone(plan.snapshot); data.families.push(recording.expectedFamily as any);
  const snapshot = new DataSnapshot(data), historical = { ...release, id: plan.releaseId };
  expect(snapshot.version).toBe(recording.provenance.sourceSharedVersion);
  for (const categoryId of ids) {
    const task = batchTask(plan, categoryId, "leaf");
    await expect(assemble(historical, snapshot, task, 200000)).rejects.toThrow('"totalBytes":200664');
    const complete = await assemble(historical, snapshot, task, Number.MAX_SAFE_INTEGER),
      context = await assembleStageContext({ release: historical, snapshot, task,
        model: plan.model, limits: plan.limits, corrections: BATCH_CORRECTIONS });
    expect(context.input).toEqual(complete.input); expect(context.serializedInput).toBe(complete.serializedInput);
    expect(context.manifest.contextUsage.totalBytes).toBe(200664);
    expect(context.manifest.requestCapacity.maxRequestBytes).toBe(350000);
    expect(context.manifest.requestCapacity.availableHistoryBytes).toBeGreaterThanOrEqual(HISTORY_HEADROOM_BYTES);
    expect(context.input.sharedContext.systemFields).toEqual(plan.snapshot.systemFields);
    const family = (context.input.sharedContext as any).family.flatMap((p: any) => p.items).find((f: any) => f.id === "facial-tissue");
    for (const field of ["attributes", "bindings", "decisions", "extensionCandidates", "reviewIssues"])
      expect(family[field]).toEqual((recording.expectedFamily as any)[field]);
    for (const k of context.input.sharedContext.knowledge) expect(k.text).toBe(release.knowledge[k.id]!.body);
    for (const ref of context.input.sharedContext.baselineReferenceDependencies) expect(context.tools.referenceError(ref)).toBeNull();
  }
});

test("source-only fit is insufficient when the complete request has no history headroom; no truncation or HTTP", async () => {
  const plan = recordedPlan(), snapshot = new DataSnapshot(plan.snapshot), task = batchTask(plan, BOX, "family-seed"),
    options = { release, snapshot, task, model: plan.model, limits: plan.limits, corrections: BATCH_CORRECTIONS },
    full = await assembleStageContext(options), limit = full.manifest.requestCapacity.initialRequestBytes + HISTORY_HEADROOM_BYTES - 1,
    dir = next(), c = client(dir, () => { throw Error("no HTTP"); });
  await expect(runStage({ ...options, limits: { ...plan.limits, maxRequestBytes: limit }, client: c, outDir: dir }))
    .rejects.toThrow("insufficient history capacity");
  expect(c.calls).toBe(0); expect(await Bun.file(join(dir, "budget.json")).exists()).toBe(false);
});

test("a tight request limit retains the generated baseline and blocks leaves at the post-seed barrier before transport", async () => {
  const p: any = recordedPlan(), dir = next(); delete p.accounting;
  p.releaseId = release.id; p.outDir = dir; p.concurrency = 2; p.preflight = [];
  const seedContext = await assembleStageContext({ release, snapshot: new DataSnapshot(p.snapshot), task: batchTask(p, BOX, "family-seed"),
    model: p.model, limits: p.limits, corrections: BATCH_CORRECTIONS });
  const shared = jsonClone(p.snapshot); shared.families.push(recording.expectedFamily as any);
  const leafContext = await assembleStageContext({ release, snapshot: new DataSnapshot(shared), task: batchTask(p, BOX, "leaf"),
    model: p.model, limits: p.limits, corrections: BATCH_CORRECTIONS });
  expect(leafContext.manifest.requestCapacity.initialRequestBytes).toBeGreaterThan(seedContext.manifest.requestCapacity.initialRequestBytes);
  p.limits.maxRequestBytes = Math.floor((seedContext.manifest.requestCapacity.initialRequestBytes +
    leafContext.manifest.requestCapacity.initialRequestBytes) / 2) + HISTORY_HEADROOM_BYTES;
  const { id: _id, outDir: _out, concurrency: _c, preflight: _p, ...identity } = p;
  p.id = hash(identity);
  const raw = JSON.parse((recording.responses.at(-1)!.output.find((o: any) => o.type === "message") as any).content[0].text);
  raw.unresolved.push("synthetic capacity growth: " + "x".repeat(2000));
  const mock = scriptedFetch([[finalMessage(raw)]]), result = await executeBatch(p, release, client(dir, mock.fetch));
  expect(result.familySeeds[0]!.status).toBe("program_pass_pending_human");
  expect(result.leaves.map(j => j.code)).toEqual(["context_budget", "context_budget"]);
  expect(mock.requests).toHaveLength(1);
  const preflight = await read(join(dir, "batch.leaf-preflight.json"));
  expect(preflight.leaves.every((l: any) => l.error.includes("no content was truncated"))).toBe(true);
  const savedShared = await read(join(dir, "batch.shared-snapshot.json"));
  expect(savedShared.snapshot.families.at(-1).reviewIssues.at(-1)).toBe(raw.unresolved.at(-1));
});

// Recreate the historical boundary with the actual four recorded model responses.
// Only transport/ledger/location are constructed; all seed proposals and the full
// original tree/material input stay verbatim. Source leaves were never requested.
async function sourceRound() {
  const directory = next(), sourcePlan = recordedPlan() as any, historical = priorHost();
  delete sourcePlan.accounting;
  sourcePlan.releaseId = historical.id; sourcePlan.runId = "offline-original-root";
  for (const family of sourcePlan.snapshot.families) if (family.status === "candidate") family.runId = sourcePlan.runId;
  sourcePlan.inputVersion = hash(sourcePlan.snapshot);
  sourcePlan.categoryIds = [WASH, ...ids]; sourcePlan.outDir = directory;
  const { id: _id, outDir: _out, concurrency: _c, preflight: _p, ...identity } = sourcePlan;
  sourcePlan.id = hash(identity);
  await save(join(directory, "batch.identity.json"), { ...identity, id: sourcePlan.id });
  await save(join(directory, "execution.identity.json"), { batchId: sourcePlan.id, mode: "offline",
    transportId: "context-continuation-fixture", budgetCny: 0, pricingId: "offline-zero" });
  await new Budget(directory, 0, "offline-zero").init(); await mkdir(join(directory, "requests"));
  // A separate already-passed wash artifact must never become a continuation target.
  await save(join(directory, "preserved-wash.json"), { categoryId: WASH, status: "program_pass_pending_human", sentinel: "unchanged" });
  const { plan, execution } = await prepareRerun({ directory, roundName: round, categoryIds: ids, concurrency: 2 }, historical),
    m = scriptedFetch(recording.responses.map(r => r.output as any)), c = client(directory, m.fetch),
    artifact = await runStage({ release: historical, snapshot: new DataSnapshot(plan.snapshot), task: batchTask(plan, BOX, "family-seed"),
      client: c, outDir: plan.outDir, model: plan.model, limits: plan.limits, corrections: BATCH_CORRECTIONS });
  expect(artifact.checks.errors).toEqual([]); expect(artifact.result).toEqual(recording.expectedResult);
  expect(artifact.feedback.map(f => f.code)).toEqual(["final_json", "program_checks"]);
  const family = pendingFamily(plan.groups[0]!, artifact, plan.runId), data = jsonClone(plan.snapshot);
  data.families.push(family); const snapshot = new DataSnapshot(data);
  const seed: BatchJob = { phase: "family-seed", categoryId: BOX, familyId: "facial-tissue",
    status: "program_pass_pending_human", code: null, error: null, artifact };
  const leaves: BatchJob[] = ids.map(categoryId => ({ phase: "leaf", categoryId, familyId: "facial-tissue", status: "program_blocked",
    code: "context_budget", error: "recorded pre-transport context exceeded 200000 bytes", artifact: null }));
  await save(join(plan.outDir, "execution.identity.json"), { ...execution, batchId: plan.id, accountingDirectory: directory, originalBatchId: sourcePlan.id });
  await save(join(plan.outDir, "batch.shared-snapshot.json"), { batchId: plan.id, version: snapshot.version, snapshot: snapshot.data });
  await save(join(plan.outDir, "batch.results.json"), { batchId: plan.id, releaseId: plan.releaseId, mode: "offline",
    sharedSnapshotVersion: snapshot.version, familySeeds: [seed], leaves, budget: await c.budget.status(), passed: 0 });
  return { directory, plan, family, artifact };
}
const prepare = (directory: string, extra: Partial<Parameters<typeof prepareContinuation>[0]> = {}, r = release) =>
  prepareContinuation({ directory, fromRound: round, categoryIds: ids, concurrency: 2, reasoningEffort: "low", ...extra }, r);

test("continuation reuses the real checked seed; only two leaf tool/correction loops run; repeats do not buy requests", async () => {
  const source = await sourceRound(), paths = ["budget.json", "preserved-wash.json", "reruns/" + round + "/batch.results.json",
    "reruns/" + round + "/batch.shared-snapshot.json"], before = await Promise.all(paths.map(p => read(join(source.directory, p)).then(hash))),
    continued = await prepare(source.directory);
  expect(continued.preview.ready).toBe(true); expect(continued.preview.familySeeds).toEqual([]);
  expect(continued.preview.reusedBaselines[0]!.version).toBe(source.family.version);
  expect(continued.preview.reusedBaselines[0]!.status).toBe("candidate");
  expect(continued.plan.runId).toBe(source.plan.runId);
  expect(continued.plan.maximumRequests).toBe(12);
  expect(continued.plan.snapshot.families.find(f => f.id === "facial-tissue")).toEqual(source.family);
  expect(await Promise.all(paths.map(p => read(join(source.directory, p)).then(hash)))).toEqual(before);
  const requests: any[] = [], counts = new Map<string, number>();
  const c = client(source.directory, async (_url: any, init: any) => {
    const body = JSON.parse(init.body), input = JSON.parse(body.input[0].content), task = input.task;
    requests.push(body); expect(ids).toContain(task.categoryId); expect(task.candidate.phase).toBe("leaf");
    expect(body.reasoning.effort).toBe("low");
    const n = (counts.get(task.categoryId) ?? 0) + 1; counts.set(task.categoryId, n);
    if (n === 1) return Response.json({ status: "completed", output: [functionCall("get_family_context", { categoryId: task.categoryId, limit: 10, cursor: null }, "read-family")] });
    if (n === 2) {
      expect(body.input.at(-2).type).toBe("function_call_output");
      expect(JSON.parse(body.input.at(-2).output).items.find((f: any) => f.id === "facial-tissue").attributes).toEqual(source.family.attributes);
      return Response.json({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "{broken-json" }] }] });
    }
    expect(JSON.parse(body.input.at(-2).content).code).toBe("final_json");
    const family = source.family, full = { categoryId: task.categoryId, baselineVersion: family.version, attributes: family.attributes,
      bindings: family.bindings.map(b => ({ ...b, categoryId: task.categoryId, baselineAttributeId: b.attributeId })),
      extensionCandidates: family.extensionCandidates, decisions: family.decisions, unresolved: family.reviewIssues };
    return Response.json({ status: "completed", output: [finalMessage(fixtureWireResult(full, body))] });
  });
  const result = await executeBatch(continued.plan, release, c);
  expect(result.leaves.map(j => ({ code: j.code, error: j.error }))).toEqual(ids.map(() => ({ code: null, error: null })));
  expect(result.passed).toBe(2); expect(result.familySeeds).toEqual([]); expect(requests).toHaveLength(6);
  for (const id of ids) {
    const reqs = requests.filter(b => JSON.parse(b.input[0].content).task.categoryId === id);
    for (let i = 1; i < reqs.length; i++) {
      expect(reqs[i].input.slice(0, reqs[i - 1].input.length)).toEqual(reqs[i - 1].input);
      expect(reqs[i].instructions).toBe(reqs[0].instructions);
    }
    expect(result.leaves.find(j => j.categoryId === id)!.artifact!.feedback.map(f => f.code)).toEqual(["final_json"]);
  }
  expect(requests.every(b => Buffer.byteLength(canonical(b)) <= source.plan.limits.maxRequestBytes)).toBe(true);
  expect((await read(join(continued.plan.outDir, "batch.leaf-preflight.json"))).leaves.every((p: any) => p.status === "ready")).toBe(true);
  const saved = await prepare(source.directory, { concurrency: 1 }), replay = await executeBatch(saved.plan, release,
    client(source.directory, () => { throw Error("no repeat HTTP"); }));
  expect(saved.plan.id).toBe(continued.plan.id); expect(replay.mockCallsThisExecution).toBe(0); expect(replay.cacheHitsThisExecution).toBe(6);
  expect((await read(join(source.directory, "budget.json"))).entries).toHaveLength(10);
  expect(await Promise.all(paths.slice(1).map(p => read(join(source.directory, p)).then(hash)))).toEqual(before.slice(1));
  expect(await Bun.file(join(continued.plan.outDir, "budget.json")).exists()).toBe(false);
});

test("scope, thinking, business drift, missing receipts, changed baselines and fixed continuation identities block before HTTP", async () => {
  const source = await sourceRound();
  await expect(prepare(source.directory, { categoryIds: [WASH] })).rejects.toThrow("source-round leaf");
  await expect(prepare(source.directory, { reasoningEffort: "high" })).rejects.toThrow("inherits");
  await expect(prepare(source.directory, { fromRound: "../escape" })).rejects.toThrow("--from-round");
  await expect(prepare(source.directory, { categoryIds: [BOX, BOX] })).rejects.toThrow("无重复");
  await expect(prepare(source.directory, {}, { ...release, files: { ...release.files, "checks.ts": "business-drift" } }))
    .rejects.toThrow("business/check/read material changed");
  await prepare(source.directory);
  await expect(prepare(source.directory, { categoryIds: [BOX] })).rejects.toThrow("different frozen");
  const sharedPath = join(source.plan.outDir, "batch.shared-snapshot.json"), shared = await read(sharedPath),
    resultPath = join(source.plan.outDir, "batch.results.json"), results = await read(resultPath);
  const altered = jsonClone(shared); altered.snapshot.families.at(-1).status = "reviewed";
  altered.version = hash(altered.snapshot); await save(sharedPath, altered);
  await save(resultPath, { ...results, sharedSnapshotVersion: altered.version });
  await expect(prepare(source.directory)).rejects.toThrow();
  await save(sharedPath, shared); await save(resultPath, results);
  const receiptPath = join(source.directory, "requests", source.artifact.requestKeys[0] + ".receipt.json");
  const receipt = await read(receiptPath); await save(receiptPath, { ...receipt, responseHash: "corrupt" });
  await expect(prepare(source.directory)).rejects.toThrow("integrity mismatch");
});

test("CLI preview uses the root ledger, preserves low, and rejects reset or scope-expansion options", async () => {
  const source = await sourceRound(), args = ["batch-continue", "--out", source.directory, "--from-round", round,
    "--category-ids", ids.join(","), "--reasoning-effort", "low", "--concurrency", "2"];
  const preview: any = await main(args); expect(preview.ready).toBe(true); expect(preview.networkCalls).toBe(0);
  expect(preview.categories.map((c: any) => c.name)).toEqual(["盒装抽纸", "软包抽纸"]);
  await expect(main([...args, "--budget-cny", "100"])).rejects.toThrow();
  await expect(main([...args, "--round", "buy-again"])).rejects.toThrow();
  await expect(main([...args, "--category-id", WASH])).rejects.toThrow();
  await expect(main([...args, "--execute"])).rejects.toThrow("构造离线批次不能");
});
