import { withFixtureDecisions } from "./fixtures.ts";
import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { read, save, hash } from "./core.ts";
import { ROOT, loadRelease, type Release } from "./release.ts";
import { fixtureTask, fixtureOutput, fixtureSnapshot, functionCall, finalMessage, scriptedFetch, attribute, binding } from "./fixtures.ts";
import { DataSnapshot } from "./snapshot.ts";
import { ResponsesClient, type FetchLike } from "./responses.ts";
import { Budget } from "./budget.ts";
import { runStage, BATCH_CORRECTIONS } from "./runner.ts";
import { parseResultJson } from "./result-json.ts";
import { progressLogger } from "./progress.ts";
import { prepareBatch, executeBatch } from "./batch.ts";
import { recheckBatch, correctBatchLeaf } from "./batch-recovery.ts";
import { main } from "./cli.ts";

let temp: string, release: Release, counter = 0;
beforeAll(async () => { temp = await mkdtemp(join(tmpdir(), "pgv3-recovery-")); release = await loadRelease(); });
afterAll(async () => { await rm(temp, { recursive: true, force: true }); });
const next = () => join(temp, String(counter++));
async function stage(script: Parameters<typeof scriptedFetch>[0], limits = {}) {
  const dir = next(), mock = scriptedFetch(script),
    client = new ResponsesClient({ mode: "offline", transportId: "recovery-regression", fetch: mock.fetch },
      dir, new Budget(dir, 0, "offline-zero"));
  const artifact = await runStage({ release, snapshot: new DataSnapshot(fixtureSnapshot()),
    task: fixtureTask("family-modeling"), client, outDir: dir, corrections: BATCH_CORRECTIONS, limits });
  return { artifact, mock, client, dir };
}
const final = () => finalMessage(fixtureOutput("family-modeling"));

test("presentation normalization preserves every business value; ambiguous envelopes and malformed syntax remain rejected", () => {
  const value = { name: "单卷质量", required: false, count: 0, unit: "张/包", unknown: null };
  for (const raw of [JSON.stringify(value), "\uFEFF " + JSON.stringify(value),
    "```json\n" + JSON.stringify(value) + "\n```",
    "以下是候选，仍待人工。\n```json\n" + JSON.stringify(value) + "\n```\n请核实口径。"]) {
    const parsed = parseResultJson(raw);
    expect(parsed.result).toEqual(value);
    expect(parsed.businessValuesModified).toBe(false);
    expect(parsed.rawTextHash).toBe(hash(raw));
  }
  for (const raw of ["前文 {}\n```json\n{}\n```", "```json\n{}\n```\n```json\n{}\n```",
    "```\n{'id': 1}\n```", '{"categoryId":74bb6e57-7174-4a23-a1f3-397aa5d63781}', "介绍 {\"x\":1}"]) {
    expect(() => parseResultJson(raw)).toThrow();
  }
});
test("a real malformed-UUID shape gets paired error outputs; no call in the invalid group executes", async () => {
  const malformed = functionCall("search_attribute_pool", {}, "bad");
  malformed.arguments = '{"query":"材质","categoryId":74bb6e57-7174-4a23-a1f3-397aa5d63781,"limit":30,"cursor":null}';
  const { artifact, mock } = await stage([
    [functionCall("categories_get", { id: "fixture-root" }, "valid-but-group-rejected"), malformed],
    (body) => {
      const outputs = body.input.filter((i: any) => i.type === "function_call_output");
      expect(outputs.map((i: any) => i.call_id)).toEqual(["valid-but-group-rejected", "bad"]);
      expect(outputs.every((i: any) => JSON.parse(i.output).ok === false)).toBe(true);
      return [final()];
    },
  ]);
  expect(artifact.checks.status).toBe("program_pass_pending_human");
  expect(artifact.toolEvents.filter((e) => e.origin === "model")).toHaveLength(0);
  expect(artifact.toolCount).toBe(0);
  expect(artifact.feedback[0]!.code).toBe("tool_arguments");
  expect(mock.requests).toHaveLength(2);
});
test("null/null pool scope returns a recoverable error without pretending a global search succeeded", async () => {
  const { artifact } = await stage([
    [functionCall("search_attribute_pool", { query: null, categoryId: null, limit: 30, cursor: null }, "scope")],
    (body) => {
      expect(JSON.parse(body.input.at(-1).output).error.code).toBe("pool_scope");
      return [final()];
    },
  ]);
  expect(artifact.toolCount).toBe(0);
  expect(artifact.feedback[0]!.code).toBe("pool_scope");
  expect(artifact.checks.status).toBe("program_pass_pending_human");
});
test("oversized tool groups converge to tool_choice=none within the original limits", async () => {
  const { artifact, mock } = await stage([
    [functionCall("categories_get", { id: "fixture-root" }, "a"), functionCall("categories_get", { id: "fixture-root" }, "b")],
    (body) => { expect(body.tool_choice).toBe("none"); return [final()]; },
  ], { maxToolCalls: 1, maxRounds: 2 });
  expect(artifact.toolCount).toBe(0);
  expect(mock.requests).toHaveLength(2);
  expect(artifact.feedback[0]!.code).toBe("tool_budget");
});
test("exhausting reads reserves a final JSON round and does not raise the call cap", async () => {
  const { artifact } = await stage([
    [functionCall("categories_get", { id: "fixture-root" }, "one")],
    (body) => { expect(body.tool_choice).toBe("none"); return [final()]; },
  ], { maxToolCalls: 1, maxRounds: 2 });
  expect(artifact.toolCount).toBe(1);
  expect(artifact.checks.status).toBe("program_pass_pending_human");
});
test("actual display-use violations are returned to the model and only its corrected proposal may pass", async () => {
  const bad = fixtureOutput("family-modeling");
  bad.bindings[0].uses = ["selection"];
  const { artifact, dir } = await stage([
    [finalMessage(bad)],
    (body) => {
      const feedback = JSON.parse(body.input.at(-1).content);
      expect(feedback.kind).toBe("host_contract_feedback");
      expect(feedback.errors.some((e: any) => e.ruleId === "R07")).toBe(true);
      return [final()];
    },
  ]);
  expect(artifact.feedback[0]!.code).toBe("program_checks");
  expect(artifact.checks.errors).toEqual([]);
  const original = await read(join(dir, "requests", artifact.requestKeys[0] + ".response.json"));
  expect(original.response.output[0].content[0].text).toBe(finalMessage(bad).content[0].text);
  expect(artifact.businessRepairs).toBe(0);
});
test("repeated frozen-definition violations stay blocked after at most two correction requests", async () => {
  const bad = fixtureOutput("family-modeling");
  bad.attributes[1].numberConfig.precision = 5;
  const { artifact, mock } = await stage([[finalMessage(bad)], [finalMessage(bad)], [finalMessage(bad)]]);
  expect(mock.requests).toHaveLength(3);
  expect(artifact.feedback).toHaveLength(2);
  expect(artifact.checks.errors.some((e) => e.ruleId === "R03")).toBe(true);
  expect(artifact.adoption).toBe("not_eligible");
});
test("forbidden tools still hard-block with correction enabled", async () => {
  await expect(stage([[functionCall("write_product", {}, "forbidden")]])).rejects.toThrow("not allowed");
});
test("fabricated quotations are not repaired or dropped by bounded correction", async () => {
  const bad = fixtureOutput("family-modeling");
  bad.attributes[0].references = [{ kind: "knowledge", id: "clean-paper-fixture",
    version: release.knowledge["clean-paper-fixture"]!.sha256, quote: "不存在的引文，不能由宿主替换" }];
  const { artifact, mock } = await stage([[finalMessage(bad)], [finalMessage(bad)], [finalMessage(bad)]]);
  expect(mock.requests).toHaveLength(3);
  expect(artifact.checks.errors.some((e) => e.ruleId === "R11")).toBe(true);
  expect((artifact.result as any).attributes[0].references[0].quote).toBe("不存在的引文，不能由宿主替换");
});
test("normal progress is stdout; only blocked progress is stderr", () => {
  const out: string[] = [], err: string[] = [], log = progressLogger("human", (s) => out.push(s), (s) => err.push(s));
  log({ event: "started", phase: "leaf", category: "测试" });
  log({ event: "finished", phase: "leaf", category: "测试", status: "program_pass_pending_human" });
  log({ event: "finished", phase: "leaf", category: "测试", status: "program_blocked", code: "program_checks" });
  expect(out).toHaveLength(2); expect(err).toHaveLength(1);
  expect(err[0]).toContain("program_checks");
});

const LEAF = "f4bb18c7-b736-4fe6-91d1-60c4d05fcee6";
const good = (id = LEAF) => {
  const a = attribute({ id: "synthetic.recovery", name: "模拟参数", conceptKey: "synthetic.recovery", fieldType: "text" });
  return withFixtureDecisions({ categoryId: id, baselineVersion: null, attributes: [a], bindings: [binding(a.id, { categoryId: id })],
    extensionCandidates: [], unresolved: ["构造的历史失败回执，非真实业务结论"] });
};
async function legacy(code: "final_json" | "tool_arguments" = "final_json") {
  const dir = next(), plan = await prepareBatch({ categoryId: LEAF, outDir: dir, runId: "legacy-mock", concurrency: 1,
    treePath: join(ROOT, "profiles/clean-paper-tree.json") }, release);
  const wrapped = finalMessage(good());
  wrapped.content[0].text = "```json\n" + JSON.stringify(good()) + "\n```";
  const mock = scriptedFetch([[wrapped]]), client = new ResponsesClient({
    mode: "offline", transportId: "historical-regression", fetch: mock.fetch,
  }, dir, new Budget(dir, 0, "offline-zero"));
  const result = await executeBatch(plan, release, client), artifact = result.leaves[0]!.artifact!;
  await rm(join(dir, "runs", artifact.runKey + ".result.json"));
  await save(join(dir, "runs", artifact.runKey + ".blocked.json"), { ...artifact, result: undefined,
    status: "program_blocked", code, error: "synthetic old-host block" });
  if (code === "tool_arguments") {
    const key = artifact.requestKeys[0]!, base = join(dir, "requests", key), r = await read(base + ".response.json"),
      call = functionCall("search_attribute_pool", {}, "legacy-bad");
    call.arguments = '{"query":"材质","categoryId":74bb6e57-7174-4a23-a1f3-397aa5d63781,"limit":30,"cursor":null}';
    r.response.output = [call]; r.sha256 = hash(r.response); await save(base + ".response.json", r);
    const receipt = await read(base + ".receipt.json");
    receipt.responseHash = r.sha256; await save(base + ".receipt.json", receipt);
    await save(base + ".transport-response.json", { key, httpStatus: 200, text: JSON.stringify(r.response), sha256: hash(JSON.stringify(r.response)) });
  }
  const blocked = { ...result.leaves[0]!, status: "program_blocked", code, error: "synthetic old-host block", artifact: null };
  await save(join(dir, "batch.results.json"), { ...result, passed: 0, blocked: 1, leaves: [blocked] });
  return { dir, plan, key: artifact.requestKeys[0]!, client };
}
test("offline recovery rebuilds actual reads, rechecks an envelope, preserves original files and never requests HTTP", async () => {
  const { dir } = await legacy(), names = ["batch.identity.json", "batch.results.json", "batch.shared-snapshot.json", "budget.json"],
    before = await Promise.all(names.map(async (n) => hash(await read(join(dir, n))))),
    recovered = await recheckBatch(dir, release);
  expect(recovered.report.passed).toBe(1); expect(recovered.report.additionalPassed).toHaveLength(1);
  expect(recovered.report.newModelRequests).toBe(0); expect(recovered.report.businessRepairs).toBe(0);
  expect(await Promise.all(names.map(async (n) => hash(await read(join(dir, n)))))).toEqual(before);
  const review = await read(join(recovered.report.outDir, "batch.review.json"));
  expect(review.attributes[0][0]).toBe("模拟参数"); expect(review.issues).toHaveLength(1);
});
test("targeted continuation skips eligible categories and shares historical receipts and budget", async () => {
  const { dir, client } = await legacy(), before = client.calls;
  const recovered = await correctBatchLeaf(dir, release, LEAF, client);
  expect(recovered.newModelRequests).toBe(0); expect(client.calls).toBe(before);
  expect("skipped" in recovered && recovered.skipped).toBe("already_program_pass_pending_human");
  await expect(correctBatchLeaf(dir, release, "not-a-leaf", client)).rejects.toThrow("one original leaf");
  const otherDir = next(), other = new ResponsesClient({ mode: "offline", transportId: "historical-regression", fetch: async () => { throw Error("never"); } },
    otherDir, new Budget(otherDir, 0, "offline-zero"));
  await expect(correctBatchLeaf(dir, release, LEAF, other)).rejects.toThrow("original request directory");
});
test("a failed target uses a new recorded correction and replay makes zero additional requests", async () => {
  const { dir, key } = await legacy("tool_arguments"),
    originalRequest = await read(join(dir, "requests", key + ".request.json")), budgetBefore = await read(join(dir, "budget.json"));
  let calls = 0;
  const fetch: FetchLike = async (_url, init) => {
    calls++;
    const body = JSON.parse(init.body), input = JSON.parse(body.input[0].content);
    expect(input.task.candidate.recovery.originalCode).toBe("tool_arguments");
    expect(input.sharedContext.category.node.id).toBe(LEAF);
    expect(body.instructions).toContain("剩余模型工具调用");
    return Response.json({ status: "completed", output: [finalMessage(good())] });
  };
  const client = new ResponsesClient({ mode: "offline", transportId: "historical-regression", fetch },
    dir, new Budget(dir, 0, "offline-zero"));
  const first = await correctBatchLeaf(dir, release, LEAF, client);
  expect(first.newModelRequests).toBe(1); expect(first.passed).toBe(1);
  const second = await correctBatchLeaf(dir, release, LEAF, client);
  expect(second.newModelRequests).toBe(0);
  expect("skipped" in second && second.skipped).toBe("already_program_pass_pending_human"); expect(calls).toBe(1);
  const consolidated = await read(join(second.outDir, "batch.review.json"));
  expect(consolidated.attributes[0][0]).toBe("模拟参数");
  const budgetAfter = await read(join(dir, "budget.json"));
  expect(budgetAfter.entries).toHaveLength(budgetBefore.entries.length + 1);
  expect(budgetAfter.entries[0]).toEqual(budgetBefore.entries[0]);
  expect(await read(join(dir, "requests", key + ".request.json"))).toEqual(originalRequest);
});
test("corrupt responses, changed validators and outcome-unknown requests cannot be recovered or resent", async () => {
  for (const change of ["response", "validator", "input", "unknown"]) {
    const { dir, key } = await legacy();
    if (change === "response") {
      const path = join(dir, "requests", key + ".response.json"), r = await read(path);
      r.response.output[0].content[0].text = "{}"; await save(path, r);
    } else if (change === "validator" || change === "input") {
      const file = (await readdir(join(dir, "runs"))).find((f) => f.endsWith(".manifest.json"))!,
        path = join(dir, "runs", file), manifest = await read(path);
      if (change === "validator") manifest.engineFiles["checks.ts"] = "changed";
      else manifest.inputHash = "changed";
      await save(path, manifest);
    } else await rm(join(dir, "requests", key + ".response.json"));
    const message = change === "unknown" ? "never resend" : change === "response" ? "integrity" :
      change === "input" ? "context identity mismatch" : "material changed";
    await expect(recheckBatch(dir, release)).rejects.toThrow(message);
  }
});
test("targeted recovery creates the failed common baseline first and never dispatches its sibling", async () => {
  const dir = next(), id = "e30ca09a-3e86-4223-b618-d6581ad1489e",
    plan = await prepareBatch({ categoryId: id, outDir: dir, runId: "family-recovery", concurrency: 1,
      treePath: join(ROOT, "profiles/clean-paper-tree.json") }, release);
  const firstMock = scriptedFetch([[functionCall("write_product", {}, "old-seed-failure")]]),
    budget = new Budget(dir, 0, "offline-zero"),
    originalClient = new ResponsesClient({ mode: "offline", transportId: "family-recovery", fetch: firstMock.fetch }, dir, budget);
  const original = await executeBatch(plan, release, originalClient);
  expect(original.leaves[0]!.code).toBe("family_dependency");
  const phases: string[] = [];
  const fetch: FetchLike = async (_url, init) => {
    const body = JSON.parse(init.body), input = JSON.parse(body.input[0].content),
      task = input.task, baseline = input.sharedContext.family.flatMap((p: any) => p.items).find((f: any) => f.usable);
    phases.push(task.candidate.phase);
    expect(task.categoryId).toBe(id);
    const result = good(id);
    if (task.candidate.phase === "leaf") {
      expect(phases).toEqual(["family-seed", "leaf"]);
      expect(baseline.attributes).toEqual(result.attributes);
      result.baselineVersion = baseline.version;
      result.bindings = baseline.bindings.map((b: any) => ({ ...b, categoryId: id, baselineAttributeId: b.attributeId }));
    }
    return Response.json({ status: "completed", output: [finalMessage(withFixtureDecisions(result))] });
  };
  const client = new ResponsesClient({ mode: "offline", transportId: "family-recovery", fetch }, dir, budget);
  const result = await correctBatchLeaf(dir, release, id, client);
  expect(result.newModelRequests).toBe(2); expect(result.passed).toBe(1);
  const rechecked = await recheckBatch(dir, release);
  expect(rechecked.jobs[0]!.status).toBe("program_pass_pending_human");
  expect(rechecked.seeds[0]!.status).toBe("program_pass_pending_human");
  expect(rechecked.report.reusedCorrections).toHaveLength(1);
  const again = await correctBatchLeaf(dir, release, id, client);
  expect(again.newModelRequests).toBe(0);
  expect(phases).toEqual(["family-seed", "leaf"]);
});
test("an unknown correction outcome keeps its receipt and never sends the same request again", async () => {
  const { dir } = await legacy("tool_arguments"), budget = new Budget(dir, 0, "offline-zero");
  let calls = 0;
  const client = new ResponsesClient({ mode: "offline", transportId: "historical-regression", fetch: async () => {
    calls++; throw Error("synthetic dropped response");
  } }, dir, budget);
  const first = await correctBatchLeaf(dir, release, LEAF, client);
  expect(first.blocked).toBe(1);
  const ledger = await budget.status();
  expect(ledger.entries.at(-1)!.status).toBe("outcome_unknown");
  const again = await correctBatchLeaf(dir, release, LEAF, client);
  expect(again.newModelRequests).toBe(0); expect(calls).toBe(1);
  expect("leaf" in again && again.leaf.code).toBe("outcome_unknown");
  expect((await budget.status()).entries).toHaveLength(ledger.entries.length);
});
test("a rejected correction does not silently buy another correction loop when executed again", async () => {
  const { dir } = await legacy("tool_arguments");
  let calls = 0;
  const client = new ResponsesClient({ mode: "offline", transportId: "historical-regression", fetch: async () => {
    calls++;
    const bad = good(); bad.attributes[0]!.name = "品牌";
    return Response.json({ status: "completed", output: [finalMessage(bad)] });
  } }, dir, new Budget(dir, 0, "offline-zero"));
  const first = await correctBatchLeaf(dir, release, LEAF, client);
  expect(first.blocked).toBe(1); expect(calls).toBe(3);
  const rechecked = await recheckBatch(dir, release);
  expect(rechecked.jobs[0]!.code).toBe("program_checks");
  const second = await correctBatchLeaf(dir, release, LEAF, client);
  expect(second.newModelRequests).toBe(0); expect(calls).toBe(3);
  expect("cacheHits" in second && second.cacheHits).toBe(3);
});
test("recovery CLI defaults to offline and refuses a budget reset, parallel full rerun or ancestor target", async () => {
  const { dir } = await legacy();
  const result = await main(["batch-recover", "--out", dir, "--no-excel"]) as any;
  expect(result.mode).toBe("offline_recheck"); expect(result.newModelRequests).toBe(0);
  for (const args of [["--budget-cny", "999"], ["--concurrency", "32"], ["--tree", "another-tree.json"]])
    await expect(main(["batch-recover", "--out", dir, "--no-excel", ...args])).rejects.toThrow("沿用原批次");
  await expect(main(["batch-recover", "--out", dir, "--no-excel", "--execute", "--category-id", "ancestor"])).rejects.toThrow("一个末级类目");
});
