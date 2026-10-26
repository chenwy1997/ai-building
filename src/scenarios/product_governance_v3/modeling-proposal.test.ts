import { beforeAll, afterAll, test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import recorded from "./fixtures/pilot-applicability-20261026.json";
import { hash, jsonClone, type Family, type Task } from "./core.ts";
import { loadRelease, ROOT, type Release } from "./release.ts";
import { DataSnapshot } from "./snapshot.ts";
import { assemble } from "./context.ts";
import { checkResult } from "./checks.ts";
import { activationGateConflicts, definitionFingerprint } from "./modeling-contract.ts";
import { materializeModelResult, modelOutputSchema, MODELING_PROPOSAL_VERSION } from "./modeling-proposal.ts";
import { attributeSearchMatch } from "./attribute-retrieval.ts";
import { prepareBatch, batchTask, pendingFamily, executeBatch, type BatchPlan } from "./batch.ts";
import { fixtureSnapshot, fixtureTask, fixtureOutput, attribute, binding, withFixtureDecisions, fixtureWireResult, fixtureCoreAttributes, scriptedFetch, finalMessage, functionCall, preCoreReplaySnapshot } from "./fixtures.ts";
import { PILOT_CATEGORIES, PILOT_KNOWLEDGE_ID } from "./pilot-knowledge.ts";
import { runStage, BATCH_CORRECTIONS } from "./runner.ts";
import { ResponsesClient } from "./responses.ts";
import { Budget } from "./budget.ts";
import { recheckBatch } from "./batch-recovery.ts";

let release: Release, temp: string, serial = 0;
const next = () => join(temp, String(serial++));
beforeAll(async () => { release = await loadRelease(); temp = await mkdtemp(join(tmpdir(), "pgv3-proposal-")); });
afterAll(async () => { await rm(temp, { recursive: true, force: true }); });
const empty = (baselineVersion: string | null) => ({ contractVersion: MODELING_PROPOSAL_VERSION, baselineVersion,
  reuse: [], newAttributes: [], newBindings: [], newExtensionCandidates: [], decisions: [], revisionRequests: [], unresolved: [] } as any);
function constructed() {
  const data = fixtureSnapshot(), task: Task = { ...fixtureTask("family-modeling"),
    candidate: { modelingContractVersion: MODELING_PROPOSAL_VERSION, modelingMode: "inherited_leaf" } };
  data.families[0]!.decisions = fixtureOutput("family-modeling").decisions;
  data.families[0]!.reviewIssues = ["构造的未决专业问题，仅供回归；不能丢失"];
  return { snapshot: new DataSnapshot(data), task };
}

test("reference-only output preserves every frozen definition, setting, decision and unresolved issue", async () => {
  const { snapshot, task } = constructed(), base = snapshot.baseline(task)!, raw = empty(base.version);
  raw.revisionRequests = [{ objectId: base.attributes[0]!.id, kind: "binding", proposal: "建议改为选填", reason: "业务强制填写必要性另审" }];
  const { result, assembly } = materializeModelResult(snapshot, task, raw), context = await assemble(release, snapshot, task);
  expect(result.attributes).toEqual(base.attributes); expect(result.decisions).toEqual(base.decisions);
  expect(result.bindings.every((b: any) => b.categoryId === task.categoryId && b.baselineAttributeId === b.attributeId)).toBe(true);
  expect(result.bindings[0].requiredness).toBe(base.bindings[0]!.requiredness);
  expect(result.unresolved).toContain(base.reviewIssues![0]);
  expect(result.unresolved.some((s: string) => s.includes("未应用"))).toBe(true);
  expect(assembly.appliedRevisionRequests).toBe(0); expect(assembly.businessApprovals).toBe(0);
  expect(checkResult(task, result, context.tools).errors).toEqual([]);
  expect(hash(base)).toBe(assembly.baseline.contentHash);
});

test("reference expansion cannot accept stale versions, copied objects, frozen edits, invented reviews or unknown protocols", () => {
  const { snapshot, task } = constructed(), base = snapshot.baseline(task)!;
  for (const mutate of [
    (p: any) => { p.baselineVersion = "stale"; },
    (p: any) => { p.newBindings = [{ ...base.bindings[0] }]; },
    (p: any) => { p.decisions = [{ ...base.decisions![0] }]; },
    (p: any) => { p.attributeApplicability = [{ status: "supported" }]; },
    (p: any) => { p.reuse = [{ attributeId: base.attributes[0]!.id, definitionHash: definitionFingerprint(base.attributes[0]!) }]; },
  ]) {
    const p = empty(base.version); mutate(p);
    expect(() => materializeModelResult(snapshot, task, p)).toThrow();
  }
  expect(() => modelOutputSchema({ ...task, candidate: { modelingContractVersion: "future-version" } })).toThrow("unsupported");
});

test("pool references expand exact values but still fail cross-category applicability", async () => {
  const { snapshot, task } = constructed(), a = snapshot.baseline(task)!.attributes[0]!,
    foreign = { ...task, categoryId: "fixture-seat-category", candidate: { modelingContractVersion: MODELING_PROPOSAL_VERSION } },
    p = empty(null);
  p.reuse = [{ attributeId: a.id, definitionHash: definitionFingerprint(a) }];
  const full = withFixtureDecisions({ attributes: [a], bindings: [binding(a.id)], extensionCandidates: [] });
  p.newBindings = full.bindings.map(({ categoryId, baselineAttributeId, ...b }) => b);
  p.decisions = full.decisions.map(({ admissionBasis, requirednessBasis, ...d }) => d);
  const output = materializeModelResult(snapshot, foreign, p), context = await assemble(release, snapshot, foreign);
  expect(output.result.attributes).toEqual([a]);
  expect(checkResult(foreign, output.result, context.tools).errors.some(e => e.message.includes("target"))).toBe(true);
  p.reuse[0].definitionHash = "stale";
  expect(() => materializeModelResult(snapshot, foreign, p)).toThrow("stale");
});

test("missing historical decisions are requested explicitly, never silently confirmed", async () => {
  const data = fixtureSnapshot(), task = constructed().task;
  delete data.families[0]!.decisions;
  const snapshot = new DataSnapshot(data), p = empty(snapshot.baseline(task)!.version),
    context = await assemble(release, snapshot, task), output = materializeModelResult(snapshot, task, p);
  expect(context.input.sharedContext.modelingProposal!.assessmentNeededIds.length).toBe(data.families[0]!.attributes.length);
  expect(output.result.decisions).toEqual([]);
  expect(checkResult(task, output.result, context.tools).errors.some(e => e.message.includes("missing structured"))).toBe(true);
});

test("an unrelated conflicting pool ID cannot poison reference-only family inheritance", () => {
  const { snapshot, task } = constructed(), data = jsonClone(snapshot.data), a = attribute({ id: "unrelated", name: "外部参数" });
  data.families.push({ id: "unrelated-family", version: "test", status: "confirmed", runId: null,
    members: ["fixture-seat-category"], attributes: [a], bindings: [binding(a.id)] });
  data.attributes.push({ ...a, definition: "同ID的另一个冲突定义，仅构造消歧反例" });
  const input = new DataSnapshot(data);
  expect(materializeModelResult(input, task, empty(input.baseline(task)!.version)).result.attributes).toEqual(snapshot.baseline(task)!.attributes);
});

test("real conditional quantity is rendered by the host without model-supplied field keys or free-text conditions", () => {
  const wash = recorded.cases.find(c => c.categoryId === PILOT_CATEGORIES[0].id)!,
    real = wash.result.decisions.find(d => d.quantity?.measure === "contents_per_package")!;
  expect(hash(wash.result)).toBe(wash.resultHash);
  const { snapshot, task } = constructed(), p = empty(snapshot.baseline(task)!.version);
  const { admissionBasis, requirednessBasis, quantity, ...decision } = real;
  const { systemFieldKeys, denominator, sameWhen, differentWhen, overlapAction, ...q } = quantity!;
  p.decisions = [{ ...decision, quantity: q }];
  const { result, assembly } = materializeModelResult(snapshot, task, p), mapped = result.decisions.at(-1).quantity;
  expect(mapped.systemFieldKeys).toEqual(["unitMin"]);
  expect(mapped.sameWhen).toContain("由unitMinQua读取数量");
  expect(mapped.sameWhen).toContain("销售单位saleUnit");
  expect(mapped.differentWhen).toContain("待核实");
  expect(mapped.overlapAction).toBe("reuse_system_field");
  expect(assembly.quantityMappings[0].execution).toBe("planning_only_requires_verified_sku_units");
  p.decisions[0].quantity.systemFieldKeys = ["unitMinQua"];
  expect(() => materializeModelResult(snapshot, task, p)).toThrow("quantity");
});

test("recorded shared-copy failures are eliminated by reference without silently adopting recorded business decisions", async () => {
  const seed = recorded.cases.find(c => c.phase === "family-seed")!, soft = recorded.cases.at(-1)!;
  expect(hash(seed.result)).toBe(seed.resultHash); expect(hash(soft.result)).toBe(soft.resultHash);
  expect(soft.feedback.some(f => JSON.stringify(f).includes("R03"))).toBe(true);
  const plan = await prepareBatch({ categoryId: PILOT_CATEGORIES[1].id, outDir: next(), runId: "recorded-negative-review",
    concurrency: 1, treePath: join(ROOT, "profiles/clean-paper-tree.json") }, release);
  const family = pendingFamily(plan.groups[0]!, { result: seed.result } as any, plan.runId), data = preCoreReplaySnapshot(plan.snapshot);
  data.families.push(family);
  const snapshot = new DataSnapshot(data), task = batchTask(plan, PILOT_CATEGORIES[2].id, "leaf"), raw = empty(family.version),
    { result } = materializeModelResult(snapshot, task, raw), context = await assemble(release, snapshot, task), checks = checkResult(task, result, context.tools);
  expect(result.attributes).toEqual(seed.result.attributes);
  expect(result.extensionCandidates).toEqual(seed.result.extensionCandidates);
  expect(JSON.stringify(raw).length).toBeLessThan(JSON.stringify(soft.result).length / 5);
  expect(checks.errors.some(e => e.ruleId === "R03")).toBe(false);
  // Host references must NOT bless the historical fragrance activation defect.
  expect(checks.errors.some(e => e.objectId === "ext.facial.fragrance" && e.ruleId === "R07")).toBe(true);
});

test("real activation defects are blocked; professional research and explicitly independent value preparation remain valid", () => {
  for (const [id, categoryId] of [["ext.facial.fragrance", PILOT_CATEGORIES[1].id], ["wash_towel.grammage", PILOT_CATEGORIES[0].id]]) {
    const c = recorded.cases.find(c => c.categoryId === categoryId)!.result.extensionCandidates.find(c => c.id === id)!;
    expect(activationGateConflicts(c.activationCriteria)).toHaveLength(1);
  }
  for (const text of ["明确成品/单层克重、计量状态及选型用途", "SKU资料可得性不作为准入条件", "必填必要性与候选启用无关；核实计数对象", "核实包装标注中的专业术语口径"])
    expect(activationGateConflicts(text)).toEqual([]);
});

test("related-term retrieval recalls sizes and material, without declaring synonyms or changing permission", () => {
  expect(attributeSearchMatch(attribute({ name: "纸张尺寸", definition: "单张纸展开的组合尺寸" }), "单张尺寸")?.kind).toBe("related_term_candidate_only");
  expect(attributeSearchMatch(attribute({ name: "原料", definition: "纸张纤维原料" }), "材质")?.kind).toBe("related_term_candidate_only");
  expect(attributeSearchMatch(attribute({ name: "是否无芯" }), "未知相关词")).toBeNull();
});

test("the actual model loop carries the delta schema, full knowledge, paired tool history and bounded feedback", async () => {
  const { snapshot, task } = constructed(), base = snapshot.baseline(task)!, bad = empty("stale"), good = empty(base.version);
  const mock = scriptedFetch([
    body => {
      expect(body.text.format.schema.properties.newAttributes).toBeDefined();
      expect(body.text.format.schema.properties.attributes).toBeUndefined();
      expect(JSON.parse(body.input[0].content).sharedContext.modelingProposal.version).toBe(MODELING_PROPOSAL_VERSION);
      return [functionCall("search_attribute_pool", { query: "层数", categoryId: null, limit: 10, cursor: null }, "pool")];
    }, body => {
      expect(JSON.parse(body.input.at(-2).output).items.length).toBeGreaterThan(0);
      return [finalMessage(bad)];
    }, body => {
      expect(JSON.parse(body.input.at(-2).content).code).toBe("proposal_contract");
      return [finalMessage(good)];
    },
  ]);
  const dir = next(), client = new ResponsesClient({ mode: "offline", transportId: "delta-loop-test", fetch: mock.fetch }, dir, new Budget(dir, 0, "offline-zero"));
  const artifact = await runStage({ release, snapshot, task, client, outDir: dir, corrections: BATCH_CORRECTIONS, model: { model: "deepseek-flash", reasoningEffort: "low" } });
  expect(artifact.feedback).toHaveLength(1); expect(artifact.checks.errors).toEqual([]);
  expect(artifact.modelProposal).toEqual(good); expect(artifact.assembly.resultHash).toBe(hash(artifact.result));
  expect(artifact.nativeProjections.length).toBe(base.attributes.length);
  expect(client.mode).toBe("offline");
  for (let i = 1; i < mock.requests.length; i++) expect(mock.requests[i].input.slice(0, mock.requests[i - 1].input.length)).toEqual(mock.requests[i - 1].input);
});

test("three real category IDs receive the dedicated frozen knowledge in actual requests and recover expanded results without HTTP", async () => {
  const outDir = next(), original = await prepareBatch({ categoryId: "77e31cf2-8331-4c73-ab10-823d2d1d7ab0", outDir,
    runId: "three-class-delta-acceptance", concurrency: 3, treePath: join(ROOT, "profiles/clean-paper-tree.json") }, release);
  // Restrict this synthetic integration input before freezing it. This is not a
  // paid round or a migration of a production batch.
  const p = { ...original, categoryIds: PILOT_CATEGORIES.map(c => c.id), groups: original.groups.filter(g => g.id === "facial-tissue") } as BatchPlan;
  p.maximumStageTasks = 4; p.maximumRequests = 24; p.maximumReservationCny = 31.2;
  const { id, outDir: _out, concurrency, preflight, ...identity } = p; p.id = hash(identity);
  const { save } = await import("./core.ts");
  await save(join(outDir, "batch.identity.json"), { ...identity, id: p.id });
  const seen: any[] = [];
  const fetch = async (_url: string, init: any) => {
    const body = JSON.parse(init.body), input = JSON.parse(body.input[0].content), task = input.task;
    seen.push(body);
    const segments = input.sharedContext.knowledge.filter((k: any) => k.id === PILOT_KNOWLEDGE_ID);
    expect(segments.map((k: any) => k.text).join("")).toBe(release.knowledge[PILOT_KNOWLEDGE_ID]!.body);
    expect(input.sharedContext.knowledgeRequirements.some((r: any) => r.knowledgeIds.includes(PILOT_KNOWLEDGE_ID))).toBe(true);
    if (body.input.length === 2) return Response.json({ status: "completed", output: [functionCall("categories_get", { id: task.categoryId })] });
    expect(body.input.some((i: any) => i.type === "function_call_output")).toBe(true);
    const base = input.sharedContext.family.flatMap((p: any) => p.items).find((f: any) => f.usable);
    let raw: any = empty(base?.version ?? null);
    if (!base) {
      const a = attribute({ id: "synthetic." + task.categoryId, name: "模拟独立参数", conceptKey: "synthetic." + task.categoryId,
        definition: "仅为" + task.categoryId + "构造的测试定义", scope: "synthetic." + task.categoryId, fieldType: "text" });
      const attributes = fixtureCoreAttributes(input) ?? [a];
      raw = fixtureWireResult(withFixtureDecisions({ categoryId: task.categoryId, baselineVersion: null, attributes,
        bindings: attributes.map(a => binding(a.id, { categoryId: task.categoryId })), extensionCandidates: [], unresolved: ["模拟接线，非业务质量结论"] }), body);
    }
    return Response.json({ status: "completed", output: [finalMessage(raw)] });
  };
  const budget = new Budget(outDir, 0, "offline-zero"), client = new ResponsesClient({ mode: "offline", transportId: "three-class-delta", fetch }, outDir, budget);
  const result = await executeBatch(p, release, client);
  expect(result.passed).toBe(3); expect(result.blocked).toBe(0); expect(seen).toHaveLength(8);
  expect(result.networkCallsThisExecution).toBe(0); expect(result.productionWrites).toBe(0);
  expect(result.leaves.every(j => j.artifact!.feedback.length === 0)).toBe(true);
  const before = hash(await budget.status()), replay = await recheckBatch(outDir, release);
  expect(replay.jobs.every(j => j.status === "program_pass_pending_human")).toBe(true);
  expect(hash(await budget.status())).toBe(before); expect(seen).toHaveLength(8);
});
