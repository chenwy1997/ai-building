import { withFixtureDecisions } from "./fixtures.ts";
import { beforeAll, afterAll, test, expect } from "bun:test";
import { mkdtemp, rm, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, loadRelease, type Release } from "./release.ts";
import { read, save, hash, jsonClone, Blocked } from "./core.ts";
import { prepareBatch, executeBatch, mapConcurrent, CLEAN_PAPER_ID, type BatchPlan } from "./batch.ts";
import { Budget } from "./budget.ts";
import { ResponsesClient, type FetchLike } from "./responses.ts";
import { attribute, binding, functionCall, finalMessage, fixtureSnapshot } from "./fixtures.ts";
import { main } from "./cli.ts";

let temp: string, release: Release, count = 0;
const treePath = join(ROOT, "profiles/clean-paper-tree.json");
beforeAll(async () => { temp = await mkdtemp(join(tmpdir(), "pgv3-batch-")); release = await loadRelease(); });
afterAll(async () => { await rm(temp, { recursive: true, force: true }); });
const next = () => join(temp, String(++count));
async function plan(categoryId = CLEAN_PAPER_ID, outDir = next(), concurrency = 3, budgetCny = 200) {
  return prepareBatch({ categoryId, outDir, runId: "offline-batch-test", concurrency, budgetCny, treePath }, release);
}

// Entirely constructed responses, even when testing real category IDs. Never business proposals.
function mock(options: {
  invalidFamily?: string;
  invalidLeaf?: string;
  throwLeaf?: string;
  emptyFamily?: string;
} = {}) {
  const requests: any[] = [], completedSeeds = new Set<string>();
  let active = 0, maxActive = 0;
  const fetch: FetchLike = async (_url, init) => {
    const body = JSON.parse(init.body), input = JSON.parse(body.input[0].content), task = input.task;
    requests.push(body);
    expect(body.model).toBe("deepseek-flash");
    expect(body.reasoning.effort).toBe("low");
    expect(body.instructions).toContain("建模正反例");
    expect(body.instructions).toContain("业务");
    expect(body.tools.some((t: any) => t.name === "categories_search")).toBe(true);
    expect(input.sharedContext.knowledge.some((k: any) => k.id === "clean-paper-admission-20261023")).toBe(true);
    expect(input.sharedContext.systemFields.some((f: any) => f.key === "brandId")).toBe(true);
    expect(task.productId).toBeNull();
    active++; maxActive = Math.max(maxActive, active);
    await Bun.sleep(3);
    active--;
    const scope = task.candidate, isSeed = scope.phase === "family-seed";
    if (!isSeed && scope.family && scope.family.id !== "small-toilet-roll")
      expect(completedSeeds.has(scope.family.id)).toBe(true);
    if (!isSeed && options.throwLeaf === task.categoryId) throw new Error("mock connection dropped; outcome unknown");
    if (body.input.length === 2) {
      return Response.json({ status: "completed", output: [functionCall("categories_get", { id: task.categoryId }, "category-read")] });
    }
    if (body.input.at(-2).type === "function_call_output") {
      expect(body.input.at(-2).call_id).toBe("category-read");
      expect(JSON.parse(body.input.at(-2).output).node.id).toBe(task.categoryId);
    } else expect(JSON.parse(body.input.at(-2).content).kind).toBe("host_contract_feedback");
    const baseline = input.sharedContext.family.flatMap((p: any) => p.items).find((f: any) => f.usable);
    const attrs = baseline ? jsonClone(baseline.attributes) : [attribute({
      id: "mock." + (scope.family?.id ?? task.categoryId), name: "模拟验收参数", conceptKey: "mock." + (scope.family?.id ?? task.categoryId),
      definition: "离线构造参数，仅验收工具及批次依赖，不是业务定义", scope: "offline-mock-only", fieldType: "text",
    })];
    const bindings = attrs.map((a: any) => ({
      ...(baseline?.bindings.find((b: any) => b.attributeId === a.id && b.categoryId === task.categoryId) ??
        baseline?.bindings.find((b: any) => b.attributeId === a.id && b.categoryId === null) ?? binding(a.id)),
      categoryId: task.categoryId, baselineAttributeId: baseline ? a.id : null,
    }));
    if ((isSeed && scope.family?.id === options.invalidFamily) || (!isSeed && task.categoryId === options.invalidLeaf))
      attrs[0].name = "品牌";
    const empty = isSeed && options.emptyFamily === scope.family?.id;
    const result = { categoryId: task.categoryId, baselineVersion: baseline?.version ?? null,
      attributes: empty ? [] : attrs, bindings: empty ? [] : bindings,
      extensionCandidates: baseline?.extensionCandidates ?? [], unresolved: ["模拟验收，非DeepSeek真实产出或业务质量评估"] };
    if (isSeed) completedSeeds.add(scope.family.id);
    return Response.json({ status: "completed", output: [finalMessage(withFixtureDecisions(result))], usage: { input_tokens: 100, output_tokens: 100 } });
  };
  return { fetch, requests, completedSeeds, get maxActive() { return maxActive; } };
}
function clientFor(p: BatchPlan, fetch: FetchLike, budget = new Budget(p.outDir, 0, "offline-zero")) {
  return new ResponsesClient({ mode: "offline", transportId: "batch-offline-mock-v1", fetch }, p.outDir, budget);
}

test("preview expands the real clean-paper subtree into exactly 21 leaf jobs and two family preparations", async () => {
  const p = await plan();
  expect(p.preflight).toEqual([]);
  expect(p.categoryIds.length).toBe(21);
  expect(p.maximumStageTasks).toBe(23);
  expect(p.maximumRequests).toBe(138);
  expect(p.groups.filter((g) => g.needsSeed).length).toBe(2);
  expect(p.snapshot.sources).toEqual([]);
  expect(p.snapshot.products).toEqual([]);
  expect(p.snapshot.knowledgeIds.some((id) => id.includes("fixture"))).toBe(false);
  expect(p.snapshot.families[0]!.status).toBe("candidate");
  expect(p.snapshot.families[0]!.attributes.length).toBe(7);
  expect(p.snapshot.families[0]!.extensionCandidates!.length).toBe(6);
  expect(await Bun.file(join(p.outDir, "budget.json")).exists()).toBe(false);
});
test("root ID and concurrency are real CLI parameters; preview needs no credential or HTTP", async () => {
  const result = await main(["batch", "--category-id", "2cddadee-39ff-4a45-9ac7-0f0df34c06f4", "--tree", treePath, "--out", next(), "--concurrency", "32"]) as any;
  expect(result.leafCount).toBe(3);
  expect(result.concurrency).toBe(32);
  expect(result.networkCalls).toBe(0);
  expect(result.ready).toBe(true);
});
test("leaf selection keeps sibling context without scheduling siblings outside the root", async () => {
  const p = await plan("15216d47-17c6-4b18-9391-83097f6f7447");
  expect(p.categoryIds).toEqual(["15216d47-17c6-4b18-9391-83097f6f7447"]);
  expect(p.groups[0]!.members.length).toBe(2);
  expect(p.maximumStageTasks).toBe(1);
});
test("invalid CLI parameters and wrong category namespaces do not create an executable batch", async () => {
  for (const concurrency of [0, -1, 1.5, 129, NaN])
    await expect(plan(CLEAN_PAPER_ID, next(), concurrency)).rejects.toThrow("concurrency");
  await expect(plan("not-a-category")).rejects.toThrow("unknown category");
  await expect(main(["batch", "--category-id", CLEAN_PAPER_ID, "--stage", "sku-filling", "--out", next()])).rejects.toThrow("只产出");
  await expect(main(["batch", "--category-id", CLEAN_PAPER_ID, "--concurreny", "32"])).rejects.toThrow();
  await expect(plan(CLEAN_PAPER_ID, next(), 2, Infinity)).rejects.toThrow("budget-cny");
});
test("explicit snapshots require appropriate knowledge and cannot import fixture data", async () => {
  const path = join(next(), "input.json");
  await save(path, fixtureSnapshot());
  await expect(prepareBatch({ categoryId: "fixture-root", snapshotPath: path, runId: "offline-batch-test", outDir: next(), concurrency: 1 }, release)).rejects.toThrow("local business");
  const original = await plan(), snapshot = jsonClone(original.snapshot);
  snapshot.knowledgeRequirements = [];
  await save(path, snapshot);
  const p = await prepareBatch({ categoryId: CLEAN_PAPER_ID, snapshotPath: path, runId: original.runId, outDir: next(), concurrency: 1 }, release);
  expect(p.preflight.length).toBe(21);
  const m = mock(), client = clientFor(p, m.fetch);
  await expect(executeBatch(p, release, client)).rejects.toThrow("preflight");
  expect(m.requests.length).toBe(0);
});
test("a foreign pending family cannot be silently replaced by independent batch generation", async () => {
  const original = await plan(), snapshot = jsonClone(original.snapshot);
  snapshot.families[0]!.runId = "another-human-review-batch";
  const file = join(next(), "input.json"); await save(file, snapshot);
  const p = await prepareBatch({ categoryId: snapshot.families[0]!.members[0]!, snapshotPath: file,
    runId: "offline-batch-test", concurrency: 2, outDir: next() }, release);
  expect(p.preflight.some((e) => e.code === "family_dependency")).toBe(true);
});
test("one global pool enforces the requested concurrency cap", async () => {
  let active = 0, max = 0;
  const values = await mapConcurrent(Array.from({ length: 17 }, (_, i) => i), 4, async (i) => {
    active++; max = Math.max(max, active); await Bun.sleep(2); active--; return i * 2;
  });
  expect(max).toBe(4);
  expect(values).toEqual(Array.from({ length: 17 }, (_, i) => i * 2));
});
test("an unexpected worker failure drains in-flight work and stops dispatching more paid work", async () => {
  let started = 0, finished = 0;
  await expect(mapConcurrent([0, 1, 2, 3, 4, 5], 2, async (i) => {
    started++;
    if (i === 0) { await Bun.sleep(1); throw Error("mock persistence failed"); }
    await Bun.sleep(8); finished++;
  })).rejects.toThrow("mock persistence failed");
  expect(started).toBe(2); expect(finished).toBe(1);
});
test("23 mocked tasks use actual context, tool execution and checks; all leaves see completed frozen families", async () => {
  const out = process.env.PGV3_BATCH_ACCEPTANCE_OUT ?? next(), p = await plan(CLEAN_PAPER_ID, out, 4), m = mock();
  const result = await executeBatch(p, release, clientFor(p, m.fetch));
  expect(result.total).toBe(21); expect(result.passed).toBe(21); expect(result.blocked).toBe(0);
  expect(result.familySeeds.length).toBe(2);
  expect(result.mockCallsThisExecution).toBe(46);
  expect(result.networkCallsThisExecution).toBe(0);
  expect(m.maxActive).toBeLessThanOrEqual(4);
  expect(result.leaves.every((j) => j.artifact?.toolCount === 1)).toBe(true);
  expect(result.leaves.every((j) => j.artifact?.manifest.skill.length === 2)).toBe(true);
  expect(result.leaves.every((j) => j.artifact?.checks.executedChecks.includes("family-contract"))).toBe(true);
  const shared = await read(join(out, "batch.shared-snapshot.json"));
  expect(shared.snapshot.families.length).toBe(3);
  expect(shared.snapshot.families.every((f: any) => f.status === "candidate")).toBe(true);
  const view = await read(join(out, "batch.review.json"));
  expect(view.issues.length).toBe(21);
  expect(view.attributes.length).toBe(33); // Seven each for the two roll leaves; one constructed field for the other 19.
  expect(view.attributes.every((r: any[]) => r[5] === "" && r[6] === "")).toBe(true);
  expect(view.mode).toBe("offline");
  expect(result.productionWrites).toBe(0); expect(result.skuFillingRequests).toBe(0);
});
test("failed family preparation blocks just its two descendants, and failure rows remain visible", async () => {
  const p = await plan(), m = mock({ invalidFamily: "jumbo-toilet-roll" });
  const result = await executeBatch(p, release, clientFor(p, m.fetch));
  expect(result.passed).toBe(19); expect(result.blocked).toBe(2);
  expect(result.leaves.filter((j) => j.code === "family_dependency").length).toBe(2);
  const view = await read(join(p.outDir, "batch.review.json"));
  expect(view.issues.length).toBe(21);
  expect(view.attributes.some((r: any[]) => ["大卷纸", "中心抽大卷纸"].includes(r[1]))).toBe(false);
});
test("an empty shared definition remains a review gap rather than an invented usable baseline", async () => {
  const p = await plan(), m = mock({ emptyFamily: "facial-tissue" });
  const result = await executeBatch(p, release, clientFor(p, m.fetch));
  expect(result.leaves.filter((j) => j.code === "family_dependency").length).toBe(2);
  expect(result.passed).toBe(19);
});
test("a leaf program violation is quarantined, never blended into the reviewable attribute rows", async () => {
  const id = "f4bb18c7-b736-4fe6-91d1-60c4d05fcee6", p = await plan(id), m = mock({ invalidLeaf: id });
  const result = await executeBatch(p, release, clientFor(p, m.fetch));
  expect(result.blocked).toBe(1); expect(result.leaves[0]!.code).toBe("program_checks");
  expect(result.leaves[0]!.artifact!.checks.errors.some((e) => e.ruleId === "R01")).toBe(true);
  const view = await read(join(p.outDir, "batch.review.json"));
  expect(view.attributes).toEqual([]); expect(view.issues.length).toBe(1);
});
test("same-dir resume replays durable requests without model calls or changed family versions", async () => {
  const p = await plan(), m = mock();
  const first = await executeBatch(p, release, clientFor(p, m.fetch));
  const second = await executeBatch(p, release, clientFor(p, async () => { throw Error("resume must not send"); }));
  expect(second.mockCallsThisExecution).toBe(0); expect(second.cacheHitsThisExecution).toBe(46);
  expect(second.sharedSnapshotVersion).toBe(first.sharedSnapshotVersion);
  expect(second.leaves.map((j) => j.artifact?.runKey)).toEqual(first.leaves.map((j) => j.artifact?.runKey));
  expect(second.budget.entries.length).toBe(46);
});
test("an unknown transport outcome cannot be resent on resume", async () => {
  const id = "f4bb18c7-b736-4fe6-91d1-60c4d05fcee6", p = await plan(id), m = mock({ throwLeaf: id });
  const first = await executeBatch(p, release, clientFor(p, m.fetch));
  expect(first.blocked).toBe(1);
  const second = await executeBatch(p, release, clientFor(p, async () => { throw Error("must not resend"); }));
  expect(second.mockCallsThisExecution).toBe(0);
  expect(second.leaves[0]!.code).toBe("outcome_unknown");
  expect(second.budget.entries[0]!.status).toBe("outcome_unknown");
});
test("all workers share cumulative reservations; exhaustion stops new work and survives resume", async () => {
  class MeteredMockBudget extends Budget {
    override reserve(id: string, _amount: number) { return super.reserve(id, 1.3); }
  }
  const p = await plan(), m = mock(), budget = new MeteredMockBudget(p.outDir, 2.6, "offline-metered");
  const result = await executeBatch(p, release, clientFor(p, m.fetch, budget));
  expect(result.budget.entries.length).toBe(2);
  expect(result.budget.committedUpperBoundCny).toBe(2.6);
  expect(result.mockCallsThisExecution).toBe(2);
  expect(result.leaves.length).toBe(21);
  const second = await executeBatch(p, release, clientFor(p, async () => { throw Error("budget cannot reset"); }, budget));
  expect(second.mockCallsThisExecution).toBe(0);
  expect(second.budget.committedUpperBoundCny).toBe(2.6);
});
test("concurrency can change during resume, while budget, model, tree and source inputs stay frozen", async () => {
  const p = await plan(), same = await prepareBatch({ categoryId: CLEAN_PAPER_ID, outDir: p.outDir,
    runId: p.runId, concurrency: 32, treePath }, release);
  expect(same.id).toBe(p.id);
  await expect(prepareBatch({ categoryId: CLEAN_PAPER_ID, outDir: p.outDir, runId: p.runId,
    concurrency: 32, budgetCny: 201, treePath }, release)).rejects.toThrow("frozen batch");
  const changed = await read(treePath); changed.nodes.find((n: any) => n.name === "坐垫纸").aliases.push("数据改变");
  const path = join(next(), "tree.json"); await save(path, changed);
  await expect(prepareBatch({ categoryId: CLEAN_PAPER_ID, outDir: p.outDir, runId: p.runId,
    concurrency: 32, treePath: path }, release)).rejects.toThrow("frozen batch");
});
test("an execution directory cannot mix offline recordings and paid transport identities", async () => {
  const p = await plan("f4bb18c7-b736-4fe6-91d1-60c4d05fcee6"), m = mock();
  await executeBatch(p, release, clientFor(p, m.fetch));
  const different = new ResponsesClient({ mode: "offline", transportId: "different-transport", fetch: m.fetch }, p.outDir, new Budget(p.outDir, 0, "offline-zero"));
  await expect(executeBatch(p, release, different)).rejects.toThrow("frozen batch");
});
test("changed paid model settings or a tampered plan cannot bypass the batch's cost identity", async () => {
  const p = await plan("f4bb18c7-b736-4fe6-91d1-60c4d05fcee6"), m = mock();
  const changed = jsonClone(p); changed.model.model = "deepseek-v4-pro";
  await expect(executeBatch(changed, release, clientFor(p, m.fetch))).rejects.toThrow("configuration integrity");
  expect(m.requests.length).toBe(0);
});
test("request files contain contract, context and tool-return history; no authorization header is persisted", async () => {
  const p = await plan("15216d47-17c6-4b18-9391-83097f6f7447"), m = mock();
  await executeBatch(p, release, clientFor(p, m.fetch));
  const files = (await readdir(join(p.outDir, "requests"))).filter((f) => f.endsWith(".request.json"));
  expect(files.length).toBe(2);
  const bodies = await Promise.all(files.map((f) => readFile(join(p.outDir, "requests", f), "utf8")));
  expect(bodies.every((s) => !s.includes('"authorization"') && !s.includes("Bearer "))).toBe(true);
  expect(bodies.some((s) => s.includes("function_call_output"))).toBe(true);
  expect(bodies.every((s) => s.includes("extensionCandidates") && s.includes("是否无芯"))).toBe(true);
});
test("bad Excel configuration is refused by the CLI before preparing or requesting a paid batch", async () => {
  const out = next();
  await expect(main(["batch", "--category-id", CLEAN_PAPER_ID, "--out", out,
    "--freeze-through", "不存在的表=属性", "--execute"])).rejects.toThrow("unknown layout sheet");
  expect(await Bun.file(join(out, "batch.identity.json")).exists()).toBe(false);
  await expect(main(["batch", "--category-id", CLEAN_PAPER_ID, "--out", next(),
    "--freeze-left", "100", "--execute"])).rejects.toThrow("frozen prefix");
});
test("actual CLI execute branch reaches Responses, tool loop, checks and exit code with fully injected HTTP", async () => {
  const dir = next(), preload = join(dir, "mock-http.mjs"), out = join(dir, "batch");
  await save(join(dir, "synthetic-marker.json"), { onlyForTesting: true, liveNetworkCalls: 0 });
  await writeFile(preload, `
    import {attribute,binding,functionCall,finalMessage,withFixtureDecisions} from ${JSON.stringify(join(ROOT, "fixtures.ts"))};
    globalThis.fetch=async (url,init)=>{
      if(url!=="https://api.deepseek.com/responses" || init.headers.authorization!=="Bearer offline-synthetic-credential") throw Error("unexpected transport/credential");
      if(process.env.PGV3_SYNTHETIC_FAILURE==="401")return new Response("synthetic unauthorized",{status:401});
      const body=JSON.parse(init.body), input=JSON.parse(body.input[0].content), id=input.task.categoryId;
      if(body.input.length===2)return Response.json({status:"completed",output:[functionCall("categories_get",{id},"cli-call")]});
      if(body.input.at(-2).call_id!=="cli-call")throw Error("tool result not paired");
      const a=attribute({id:"synthetic.cli",name:"模拟CLI验收参数",conceptKey:"synthetic.cli",scope:"synthetic-only",fieldType:"text"});
      return Response.json({status:"completed",output:[finalMessage(withFixtureDecisions({categoryId:id,baselineVersion:null,attributes:[a],bindings:[binding(a.id,{categoryId:id})],extensionCandidates:[],unresolved:["仅模拟CLI验收，无真实模型或业务结论"]}))],usage:{input_tokens:1,output_tokens:1}});
    };
  `);
  const child = Bun.spawn([process.execPath, "--preload", preload, join(ROOT, "cli.ts"), "batch",
    "--category-id", "f4bb18c7-b736-4fe6-91d1-60c4d05fcee6", "--tree", treePath,
    "--out", out, "--concurrency", "32", "--no-excel", "--log-format", "quiet", "--execute"], {
    stdout: "pipe", stderr: "pipe", env: { DEEPSEEK_API_KEY: "offline-synthetic-credential" },
  });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(stderr).toBe("");
  expect(exit).toBe(0);
  const result = JSON.parse(stdout);
  expect(result.passed).toBe(1); expect(result.requests).toBe(2); expect(result.productionWrites).toBe(0);
  expect(result.reservedCny).toBe(2.6);
  const stored = await read(join(out, "batch.results.json"));
  expect(stored.leaves[0].artifact.toolCount).toBe(1);
  expect(stored.leaves[0].artifact.checks.status).toBe("program_pass_pending_human");
  const receipts = (await readdir(join(out, "requests"))).filter((f) => f.endsWith(".request.json"));
  for (const file of receipts) expect(await readFile(join(out, "requests", file), "utf8")).not.toContain("offline-synthetic-credential");
  const failedOut = join(dir, "failed-batch"), failed = Bun.spawn([process.execPath, "--preload", preload, join(ROOT, "cli.ts"), "batch",
    "--category-id", "f4bb18c7-b736-4fe6-91d1-60c4d05fcee6", "--tree", treePath,
    "--out", failedOut, "--no-excel", "--log-format", "quiet", "--execute"], {
    stdout: "pipe", stderr: "pipe", env: { DEEPSEEK_API_KEY: "offline-synthetic-credential", PGV3_SYNTHETIC_FAILURE: "401" },
  });
  const [failedCode, failedStdout] = await Promise.all([failed.exited, new Response(failed.stdout).text(), new Response(failed.stderr).text()]);
  expect(failedCode).toBe(2);
  expect(JSON.parse(failedStdout).blocked).toBe(1);
  const failureView = await read(join(failedOut, "batch.review.json"));
  expect(failureView.mode).toBe("network"); // A failed real transport attempt must never be relabeled as an offline mock.
  expect(failureView.attributes).toEqual([]);
  expect(failureView.issues[0][6]).toBe("http_error");
}, 15000);
