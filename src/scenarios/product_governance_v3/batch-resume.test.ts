import { beforeAll, afterAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import recording from "./fixtures/clean-paper-full-stop-20261026.json";
import { Blocked, hash, read, save, jsonClone } from "./core.ts";
import { ROOT, loadRelease, type Release } from "./release.ts";
import { prepareBatch, executeBatch, CLEAN_PAPER_ID } from "./batch.ts";
import { prepareRerun } from "./batch-rerun.ts";
import { prepareResume, executeResume } from "./batch-resume.ts";
import { runStage, BATCH_CORRECTIONS } from "./runner.ts";
import { DataSnapshot } from "./snapshot.ts";
import { ResponsesClient, type FetchLike } from "./responses.ts";
import { Budget } from "./budget.ts";
import { fixtureTask, fixtureSnapshot, fixtureOutput, attribute, binding, finalMessage, functionCall,
  scriptedFetch, fixtureWireResult, withFixtureDecisions, fixtureCoreAttributes } from "./fixtures.ts";
import { familyCoverage } from "./family-coverage.ts";
import { main } from "./cli.ts";
import { progressLogger } from "./progress.ts";
import { verifiedReplayClient } from "./transcript-replay.ts";
import { resumableFailure } from "./runtime-errors.ts";

let temp: string, release: Release, seq = 0;
const round = "recorded-full-stop", CURSOR = recording.leaves.find(j => j.code === "stage_error")!.categoryId,
  budgetIds = recording.leaves.filter(j => j.code === "budget_exhausted").map(j => j.categoryId),
  emptyIds = recording.leaves.filter(j => j.admittedAttributeCount === 0).map(j => j.categoryId);
beforeAll(async () => { temp = await mkdtemp(join(tmpdir(), "pgv3-resume-")); release = await loadRelease(); });
afterAll(async () => { await rm(temp, { recursive: true, force: true }); });
const next = () => join(temp, String(++seq));
const client = (dir: string, fetch: FetchLike) => new ResponsesClient({ mode: "offline", transportId: "resume-fixture", fetch },
  dir, new Budget(dir, 0, "offline-zero"));
function finalFor(body: any) {
  const input = JSON.parse(body.input[0].content), task = input.task,
    family = input.sharedContext.family.flatMap((p: any) => p.items).find((f: any) => f.usable),
    scope = task.candidate.family?.id ?? task.categoryId,
    attributes = family?.attributes ?? fixtureCoreAttributes(input) ?? (emptyIds.includes(task.categoryId) ? [] : [attribute({
      id: "test.resume." + scope, name: "构造验收参数", conceptKey: "test.resume." + scope,
      scope: "test.resume." + scope, fieldType: "text", definition: "离线构造参数，仅对象" + scope + "适用" })]);
  const bindings = attributes.map((a: any) => ({
    ...(family?.bindings.find((b: any) => b.attributeId === a.id && b.categoryId === null) ?? binding(a.id)),
    categoryId: task.categoryId, baselineAttributeId: family ? a.id : null }));
  return finalMessage(fixtureWireResult(withFixtureDecisions({ categoryId: task.categoryId, baselineVersion: family?.version ?? null,
    attributes, bindings, extensionCandidates: family?.extensionCandidates ?? [], unresolved: ["构造验收，不是新的真实模型业务结果"] }), body));
}

test("real string-null cursors get paired bounded feedback; valid parallel reads and actual cursor:null retries are retained", async () => {
  const dir = next(), p = await prepareBatch({ categoryId: CURSOR, runId: "cursor-recording", outDir: dir,
    treePath: join(ROOT, "profiles/clean-paper-tree.json"), concurrency: 1 }, release),
    calls = recording.cursorCalls, mock = scriptedFetch([
      jsonClone(calls), body => {
        const outputs = body.input.filter((i: any) => i.type === "function_call_output");
        expect(outputs.map((o: any) => o.call_id)).toEqual(calls.map(c => c.call_id));
        for (const output of outputs.slice(0, 2)) {
          expect(JSON.parse(output.output).error.code).toBe("tool_arguments");
          expect(JSON.parse(output.output).error.message).toContain("not the string");
        }
        expect(JSON.parse(outputs[2].output).id).toBe("small-roll-paper-research-20261022");
        return [functionCall("search_attribute_pool", { ...JSON.parse(calls[0]!.arguments), cursor: null }, "corrected-cursor")];
      }, body => {
        expect(body.input.filter((i: any) => i.type === "function_call_output").at(-1).call_id).toBe("corrected-cursor");
        return [finalFor(body)];
      }]), c = client(dir, mock.fetch), result = await executeBatch(p, release, c);
  expect(result.leaves[0]!.code).toBeNull(); expect(mock.requests).toHaveLength(3);
  const a = result.leaves[0]!.artifact!;
  expect(a.feedback.map(f => f.code)).toEqual(["tool_arguments"]); expect(a.toolCount).toBe(2);
  expect(a.toolEvents.filter(e => e.origin === "model").map(e => e.name)).toEqual(["knowledge_read", "search_attribute_pool"]);
});

test("wrong or stale cursors do not silently restart, grant pages, or receive unlimited corrections", async () => {
  const dir = next(), mock = scriptedFetch(["null", "bad-cursor", "stale-cursor"].map((cursor, n) => [
    functionCall("get_family_context", { categoryId: fixtureTask("family-modeling").categoryId, limit: 10, cursor }, "bad-" + n)]));
  await expect(runStage({ release, snapshot: new DataSnapshot(fixtureSnapshot()), task: fixtureTask("family-modeling"),
    client: client(dir, mock.fetch), outDir: dir, corrections: BATCH_CORRECTIONS })).rejects.toThrow("bounded correction limit");
  expect(mock.requests).toHaveLength(3);
  const file = (await readdir(join(dir, "runs"))).find(f => f.endsWith(".blocked.json"))!, a = await read(join(dir, "runs", file));
  expect(a.code).toBe("tool_arguments"); expect(a.feedback).toHaveLength(2); expect(a.toolCount).toBe(0);
});

// Recorded scope/status distribution and cursor response; model finals, transport,
// ledger and injected stop points are constructed. No paid request is replayed to
// a provider. Exercise both pre-request and mid-loop budget exhaustion.
async function stoppedRound() {
  const dir = next(), files = { ...release.files, "runner.ts": hash("prior cursor host") }, old = { ...release, files, id: hash(files) },
    root = await prepareBatch({ categoryId: CLEAN_PAPER_ID, runId: "resume-root", outDir: dir,
      concurrency: 32, treePath: join(ROOT, "profiles/clean-paper-tree.json") }, old);
  await save(join(dir, "execution.identity.json"), { batchId: root.id, mode: "offline", transportId: "resume-fixture", budgetCny: 0, pricingId: "offline-zero" });
  await new Budget(dir, 0, "offline-zero").init(); await mkdir(join(dir, "requests"));
  const { plan } = await prepareRerun({ directory: dir, roundName: round, concurrency: 32 }, old),
    c = client(dir, async (_u, init) => {
      const body = JSON.parse(init.body), task = JSON.parse(body.input[0].content).task;
      if (task.candidate.phase === "leaf" && task.categoryId === CURSOR)
        return Response.json({ status: "completed", output: recording.cursorCalls });
      if (task.candidate.phase === "leaf" && budgetIds.includes(task.categoryId))
        return Response.json({ status: "completed", output: [functionCall("categories_get", { id: task.categoryId }, "read-before-stop")] });
      return Response.json({ status: "completed", output: [finalFor(body)] });
    }), real = c.request.bind(c);
  c.request = async (body: any, identity) => {
    const task = JSON.parse(body.input[0].content).task;
    if (task.candidate.phase === "leaf") {
      if (budgetIds.includes(task.categoryId) && (task.categoryId === budgetIds[0] || body.input.length > 2))
        throw new Blocked("budget_exhausted", "batch cumulative reservation exceeds limit");
      if (task.categoryId === CURSOR && body.input.length > 2) throw Error("cursor does not match query/version");
    }
    return real(body, identity);
  };
  const result = await executeBatch(plan, old, c);
  // All leaf workers enter together; a zero-request budget stop may stop workers
  // that have not entered yet. They are still explicitly budget-related blocks.
  expect(result.familySeeds.every(j => j.status === "program_pass_pending_human")).toBe(true);
  expect(result.passed).toBe(9); expect(result.blocked).toBe(12); expect(result.noAdmittedAttributes).toBe(2);
  return { dir, plan, result };
}
const opts = (dir: string) => ({ directory: dir, fromRound: round, concurrency: 32, reasoningEffort: "low" as const });

test("full stopped batch replays within remaining limits, keeps successes and baselines, merges all leaves and never repurchases on repeat", async () => {
  const s = await stoppedRound(), sourceFiles = ["batch.identity.json", "batch.results.json", "batch.shared-snapshot.json"],
    before = await Promise.all(sourceFiles.map(p => read(join(s.plan.outDir, p)).then(hash))),
    ledgerBefore = hash(await read(join(s.dir, "budget.json"))), preview = await prepareResume(opts(s.dir), release);
  expect(preview.ready).toBe(true); expect(preview.familySeedsToRun).toEqual([]);
  expect(preview.targets).toHaveLength(recording.leaves.filter(j => j.status === "program_blocked").length);
  expect(preview.familyCoverage.groupedLeaves).toBe(6);
  expect(preview.familyCoverage.ungroupedLeaves).toBe(15); expect(preview.familyCoverage.automaticGrouping).toBe(false);
  expect(hash(await read(join(s.dir, "budget.json")))).toBe(ledgerBefore);
  const requests: any[] = [], c = client(s.dir, async (_u, init) => {
    const body = JSON.parse(init.body), task = JSON.parse(body.input[0].content).task;
    requests.push(body); expect(task.candidate.phase).toBe("leaf");
    expect(preview.targets.map(t => t.categoryId)).toContain(task.categoryId); expect(body.reasoning.effort).toBe("low");
    return Response.json({ status: "completed", output: [finalFor(body)] });
  });
  const result = await executeResume(opts(s.dir), release, c);
  expect(result.blocked).toBe(0); expect(result.total).toBe(21);
  expect(requests).toHaveLength(preview.targets.length);
  const aggregate = await read(join(result.outDir, "resume.results.json"));
  for (const prior of s.result.leaves.filter(j => j.status === "program_pass_pending_human"))
    expect(aggregate.leaves.find((j: any) => j.categoryId === prior.categoryId)).toEqual(prior);
  expect(aggregate.familySeeds).toEqual(s.result.familySeeds);
  const review = await read(join(result.outDir, "batch.review.json")); expect(review.issues).toHaveLength(21);
  const again = client(s.dir, () => { throw Error("no repeat HTTP"); });
  await executeResume(opts(s.dir), release, again); expect(again.calls).toBe(0);
  await expect(prepareResume(opts(s.dir), { ...release, id: "different-host-after-execution" })).rejects.toThrow("fixed resume");
  expect(await Promise.all(sourceFiles.map(p => read(join(s.plan.outDir, p)).then(hash)))).toEqual(before);
  expect(await Bun.file(join(result.outDir, "budget.json")).exists()).toBe(false);
});

test("resume refuses changed thinking, business rules, scope/reset options and unknown paid outcomes before transport", async () => {
  const s = await stoppedRound();
  await expect(prepareResume({ ...opts(s.dir), reasoningEffort: "high" }, release)).rejects.toThrow("original model/reasoning");
  await expect(prepareResume(opts(s.dir), { ...release, files: { ...release.files, "checks.ts": "changed" } })).rejects.toThrow("material changed");
  const args = ["batch-resume", "--out", s.dir, "--from-round", round];
  await expect(main([...args, "--category-ids", CURSOR])).rejects.toThrow("不能更换");
  await expect(main([...args, "--budget-cny", "1000"])).rejects.toThrow("不能更换");
  await expect(main([...args, "--execute"])).rejects.toThrow("构造离线批次不能");
  const ledger = await read(join(s.dir, "budget.json")); ledger.entries[0].status = "outcome_unknown";
  await save(join(s.dir, "budget.json"), ledger);
  await expect(prepareResume(opts(s.dir), release)).rejects.toThrow("unresolved paid outcome");
});

test("recorded reservation cap is independent of wallet; raising total to 1000 preserves history and is idempotent", async () => {
  const dir = next(), b = new Budget(dir, recording.budget.limitCny, "recorded-reservation"),
    { reservedCny, perRequestCny } = recording.budget;
  await b.init(); await b.reserve("historical", reservedCny); await b.finish("historical", "completed", null);
  await expect(b.reserve("next", perRequestCny)).rejects.toThrow("cumulative reservation");
  const before = (await read(b.path)).entries;
  await b.setRemaining(1000 - reservedCny, "user-total-1000", "explicit user request");
  expect((await b.status()).limitCny).toBe(1000); expect((await b.status()).entries).toEqual(before);
  await b.reserve("next", perRequestCny); const committed = hash(await read(b.path));
  await b.setRemaining(1000 - reservedCny, "user-total-1000", "explicit user request");
  expect(hash(await read(b.path))).toBe(committed);
  const messages: string[] = []; progressLogger("human", () => {}, s => messages.push(s))({ status: "program_blocked", code: "budget_exhausted" });
  expect(messages[0]).toContain("不代表账号余额不足");
});

test("generic replay rejects changed body/identity before dispatch and generic stop classification never guesses retryability", async () => {
  const body = { input: [{ role: "user", content: "unrelated stage, no category-specific logic" }], max_output_tokens: 100 },
    identity = { releaseId: "rules", snapshotVersion: "snapshot" }, transportId = "offline-replay-fixture", mode = "offline" as const,
    request = { body, identity, mode, transportId, key: hash({ body, identity, mode, transportId }) },
    response = { status: "completed", output: [finalMessage({ result: "recorded" })] },
    transcript = [{ request, response, responseHash: hash(response) }];
  for (const changed of [{ body: { ...body, max_output_tokens: 101 }, identity }, { body, identity: { ...identity, snapshotVersion: "other" } }]) {
    const replay = verifiedReplayClient({ client: null, mode, transportId, transcript });
    await expect(replay.client.request(changed.body, changed.identity)).rejects.toThrow("differs from paid transcript");
    expect(replay.consumed()).toBe(0);
  }
  const replay = verifiedReplayClient({ client: null, mode, transportId, transcript });
  expect((await replay.client.request(body, identity)).response).toEqual(response);
  await expect(replay.client.request(body, identity)).rejects.toThrow("requires explicit");
  for (const code of ["http_error", "outcome_unknown", "program_checks", "stage_error", "family_dependency"])
    expect(resumableFailure({ status: "program_blocked", code, error: "unrecognized failure" })).toBeNull();
  expect(resumableFailure({ status: "program_pass_pending_human", code: "budget_exhausted", error: null })).toBeNull();
});
