import { withFixtureDecisions, preCoreReplaySnapshot } from "./fixtures.ts";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import recordings from "./fixtures/rules-20261023-recordings.json";
import { ROOT, loadRelease, type Release } from "./release.ts";
import { prepareBatch, batchTask, buildBatchReview, type BatchJob } from "./batch.ts";
import { DataSnapshot } from "./snapshot.ts";
import { jsonClone, type Family, type Task, type AttributeBinding } from "./core.ts";
import { assemble } from "./context.ts";
import { checkResult } from "./checks.ts";
import { proposalCounts, proposalReadiness } from "./proposal-readiness.ts";
import { runStage, BATCH_CORRECTIONS } from "./runner.ts";
import { ResponsesClient } from "./responses.ts";
import { Budget } from "./budget.ts";
import { scriptedFetch, finalMessage, attribute, binding } from "./fixtures.ts";
import { progressLogger } from "./progress.ts";

let release: Release, temp: string, serial = 0;
beforeAll(async () => { release = await loadRelease(); temp = await mkdtemp(join(tmpdir(), "pgv3-recorded-")); });
afterAll(async () => { await rm(temp, { recursive: true, force: true }); });
const next = () => join(temp, String(serial++));
async function plan(categoryId: string) {
  const p = await prepareBatch({ categoryId, outDir: next(), runId: recordings.provenance.runId,
    concurrency: 2, treePath: join(ROOT, "profiles/clean-paper-tree.json") }, release);
  return { ...p, snapshot: preCoreReplaySnapshot(p.snapshot) };
}
async function replay(snapshot: DataSnapshot, task: Task, script: Parameters<typeof scriptedFetch>[0]) {
  // These recordings predate the delta wire protocol. Exercise their original
  // full-output contract explicitly; no runtime conversion of historical values.
  const candidate = { ...(task.candidate as any) }; delete candidate.modelingContractVersion;
  task = { ...task, candidate };
  const dir = next(), mock = scriptedFetch(script), client = new ResponsesClient({
    mode: "offline", transportId: "recorded-rules-20261023", fetch: mock.fetch,
  }, dir, new Budget(dir, 0, "offline-zero"));
  const artifact = await runStage({ release, snapshot, task, client, outDir: dir, corrections: BATCH_CORRECTIONS });
  expect(artifact.productionWrites).toBe(0); expect(artifact.businessRepairs).toBe(0);
  return { artifact, mock, client };
}

for (const [i, id] of ["7a1ea510-8777-46ba-bfa0-955b472a0d61", "640b5b8b-9d6e-4784-a8e2-53c291f0b7f7"].entries()) {
  test(`recorded string-null group ${i}: atomic rejection then bounded model correction, no coercion`, async () => {
    const p = await plan(id), snapshot = new DataSnapshot(p.snapshot), task = batchTask(p, id, i ? "family-seed" : "leaf");
    const original = jsonClone(recordings.invalidToolGroups[i]!.output);
    // Only the follow-up is synthetic. Keep the first provider call group verbatim.
    const corrected = original.map((c: any, n) => ({ ...c, call_id: "corrected-" + n,
      arguments: JSON.stringify({ ...JSON.parse(c.arguments), categoryId: JSON.parse(c.arguments).categoryId === "null"
        ? null : JSON.parse(c.arguments).categoryId }) }));
    const a = attribute({ id: "synthetic-followup", name: "模拟回归参数", conceptKey: "synthetic.followup" });
    const output = { categoryId: id, baselineVersion: null, attributes: [a],
      bindings: [binding(a.id, { categoryId: id })], extensionCandidates: [], unresolved: ["纠错后的最终方案为构造数据，不是新的模型业务结果"] };
    const { artifact, mock } = await replay(snapshot, task, [original as any, (request) => {
      const feedback = request.input.filter((x: any) => x.type === "function_call_output");
      expect(feedback).toHaveLength(original.length);
      expect(feedback.every((x: any) => JSON.parse(x.output).ok === false)).toBe(true);
      expect(JSON.stringify(feedback)).toContain("JSON null");
      return corrected;
    }, [finalMessage(withFixtureDecisions(output))]]);
    expect(artifact.checks.errors).toEqual([]);
    expect(artifact.feedback).toHaveLength(1);
    expect(artifact.feedback[0]!.code).toBe("tool_arguments");
    expect(artifact.toolEvents.filter(e => e.origin === "model")).toHaveLength(original.length);
    expect(artifact.toolCount).toBe(original.length);
    expect(mock.requests).toHaveLength(3);
    expect(artifact.result).toEqual(withFixtureDecisions(output));
  });
}

test("all category-ID arguments validate membership before reads; optional null remains literal null", async () => {
  const p = await plan(recordings.emptyIndependent.categoryId), task = batchTask(p, p.categoryIds[0]!, "leaf"),
    { tools } = await assemble(release, new DataSnapshot(p.snapshot), task);
  for (const [name, args, key] of [
    ["categories_search", { query: "纸", scopeId: null, limit: 5, cursor: null }, "scopeId"],
    ["categories_get", { id: task.categoryId }, "id"],
    ["categories_children", { id: task.categoryId, mode: "leaves", limit: 5, cursor: null }, "id"],
    ["find_related_categories", { id: task.categoryId, limit: 5, cursor: null }, "id"],
    ["get_family_context", { categoryId: task.categoryId, limit: 5, cursor: null }, "categoryId"],
    ["search_attribute_pool", { query: "原料", categoryId: null, limit: 5, cursor: null }, "categoryId"],
  ] as const) {
    expect(() => tools.validateCall(name, args)).not.toThrow();
    for (const bad of ["null", "undefined", "invented-category"])
      expect(() => tools.validateCall(name, { ...args, [key]: bad })).toThrow("unknown category ID");
  }
  await expect(tools.call("sources_read", { id: "invented-source", offset: 0, length: 10 })).rejects.toThrow();
  await expect(tools.call("write_product", {})).rejects.toThrow("not allowed");
});

test("repeated semantic argument errors stop after two feedback rounds, not an unbounded unknown-ID retry", async () => {
  const p = await plan(recordings.emptyIndependent.categoryId), task = batchTask(p, p.categoryIds[0]!, "leaf"),
    calls = [0, 1, 2].map(n => [{ type: "function_call", name: "categories_get", call_id: "bad-" + n, arguments: '{"id":"null"}' }]);
  const mock = scriptedFetch(calls), dir = next(), client = new ResponsesClient({ mode: "offline", transportId: "bounded-invalid-id", fetch: mock.fetch }, dir, new Budget(dir, 0, "offline-zero"));
  await expect(runStage({ release, snapshot: new DataSnapshot(p.snapshot), task, client, outDir: dir, corrections: BATCH_CORRECTIONS })).rejects.toThrow();
  expect(mock.requests).toHaveLength(3);
});

async function centerPlan() {
  const id = recordings.center.result.categoryId, p = jsonClone(await plan(id));
  p.snapshot.families.push(jsonClone(recordings.center.family) as Family);
  const snapshot = new DataSnapshot(p.snapshot), task = batchTask(p, id, "leaf");
  return { p, snapshot, task, assembled: await assemble(release, snapshot, task) };
}
// The annotations are synthetic; historical attributes/bindings/references stay unchanged.
test("recorded center-roll final with explicit decision annotations passes with unchanged business values and real baseline knowledge prefetch", async () => {
  const { snapshot, task, assembled } = await centerPlan(), knowledgeId = "small-roll-paper-research-20261022";
  expect(snapshot.knowledgeRequirements(task).some(r => r.knowledgeIds.includes(knowledgeId))).toBe(false);
  expect(assembled.tools.knowledgeReadIds.has(knowledgeId)).toBe(true);
  expect(assembled.input.sharedContext.knowledge.some(k => k.id === knowledgeId)).toBe(true);
  expect(assembled.manifest.knowledge.some(k => k.id === knowledgeId)).toBe(true);
  const { artifact } = await replay(snapshot, task, [[finalMessage(withFixtureDecisions(recordings.center.result))]]);
  expect(artifact.checks.errors).toEqual([]);
  expect(artifact.result).toEqual(withFixtureDecisions(recordings.center.result));
  expect(artifact.feedback).toHaveLength(0);
});
test("provenance may change independently of disposition; wrong citations and changed activation stay blocked", async () => {
  const { task, assembled } = await centerPlan();
  const original = jsonClone(recordings.center.result);
  const check = (result: any) => checkResult(task, withFixtureDecisions(result), assembled.tools);
  for (const field of ["deferReason", "activationCriteria", "potentialUse", "scope", "name"] as const) {
    const changed = jsonClone(original); changed.extensionCandidates[0]![field] += " 改动";
    expect(check(changed).errors.some(e => e.ruleId === "R03")).toBe(true);
  }
  const falseQuote = jsonClone(original);
  falseQuote.extensionCandidates[0]!.references[0]!.quote = "伪造未读原文";
  expect(check(falseQuote).errors.some(e => e.ruleId === "R11")).toBe(true);
  expect(check(falseQuote).errors.some(e => e.ruleId === "R03")).toBe(false);
  const omitted = jsonClone(original); omitted.extensionCandidates.pop();
  expect(check(omitted).errors.some(e => e.ruleId === "R03")).toBe(true);
});
test("baseline references with unavailable versions/IDs/quotes fail before a dependent request", async () => {
  for (const field of ["version", "id", "quote"] as const) {
    const { p, task } = await centerPlan(), snapshot = jsonClone(p.snapshot);
    snapshot.families.at(-1)!.extensionCandidates![0]!.references[0]![field] = "not-the-frozen-reference";
    await expect(assemble(release, new DataSnapshot(snapshot), task)).rejects.toThrow();
  }
});

test("recorded coreless response loses false binding errors but still corrects a real extension change", async () => {
  const original = recordings.coreless.result, p = await plan(original.categoryId), task = batchTask(p, original.categoryId, "leaf"),
    snapshot = new DataSnapshot(p.snapshot), { tools } = await assemble(release, snapshot, task);
  const errors = checkResult(task, withFixtureDecisions(original), tools).errors;
  expect(errors).toHaveLength(1);
  expect(errors[0]!.objectId).toBe("coverage.core_diameter");
  expect(errors[0]!.message).toContain("extension disposition");
  const { artifact } = await replay(snapshot, task, [[finalMessage(withFixtureDecisions(original))], [finalMessage(withFixtureDecisions(recordings.coreless.finalResult))]]);
  expect(artifact.checks.errors).toEqual([]); expect(artifact.feedback).toHaveLength(1);
  expect(artifact.result).toEqual(withFixtureDecisions(recordings.coreless.finalResult));
  const punctuation = jsonClone(recordings.coreless.finalResult);
  punctuation.bindings.forEach(b => { b.requirednessReason += "。"; });
  expect(checkResult(task, withFixtureDecisions(punctuation), tools).errors).toEqual([]);
  for (const mutate of [
    (r: any) => { r.bindings[0].requiredness = "required"; },
    (r: any) => { r.bindings[0].isPublic = !r.bindings[0].isPublic; },
    (r: any) => { r.attributes.find((a: any) => a.numberConfig).numberConfig.precision = 6; },
  ]) {
    const changed = jsonClone(recordings.coreless.finalResult);
    (changed.bindings as AttributeBinding[]).forEach(b => { b.differenceReason = null; });
    mutate(changed);
    expect(checkResult(task, withFixtureDecisions(changed), tools).errors.some(e => e.ruleId === "R03")).toBe(true);
  }
});

test("independent empty recording stays visible as a gap; inheritance still requires a usable baseline", async () => {
  const original = recordings.emptyIndependent, p = await plan(original.categoryId), task = batchTask(p, original.categoryId, "leaf"),
    snapshot = new DataSnapshot(p.snapshot), { artifact, mock } = await replay(snapshot, task, [[finalMessage(withFixtureDecisions(original))]]);
  expect(JSON.parse(mock.requests[0]!.input[0].content).sharedContext.modelingMode).toBe("independent_proposal");
  const job: BatchJob = { phase: "leaf", categoryId: task.categoryId, familyId: null, status: artifact.checks.status, code: null, error: null, artifact };
  expect(proposalReadiness(job)).toBe("no_admitted_attributes");
  expect(proposalCounts([job])).toEqual({ proposalsPendingHuman: 0, noAdmittedAttributes: 1 });
  const view = buildBatchReview(p, [job], snapshot, "offline");
  expect(view.issues[0]![1]).toBe("零属性，建模缺口待审"); expect(view.attributes).toEqual([]);
  const lines: string[] = []; progressLogger("human", x => lines.push(x))({ event: "finished", status: job.status, proposalReadiness: proposalReadiness(job) });
  expect(lines[0]).toContain("零属性");
  const badTask = { ...task, candidate: { ...task.candidate as object, modelingMode: "inherited_leaf" } };
  const blockedMock = scriptedFetch([]), dir = next(), client = new ResponsesClient({ mode: "offline", transportId: "no-baseline", fetch: blockedMock.fetch }, dir, new Budget(dir, 0, "offline-zero"));
  await expect(runStage({ release, snapshot, task: badTask, client, outDir: dir })).rejects.toThrow("completed usable baseline");
  expect(blockedMock.requests).toHaveLength(0);
});
