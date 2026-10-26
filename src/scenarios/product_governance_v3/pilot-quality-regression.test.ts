import {test, expect, beforeAll, afterAll} from "bun:test";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import recordings from "./fixtures/pilot-wash-tissue-ab-20261023.json";
import {hash, jsonClone, type AttributeDefinition, type AttributeBinding} from "./core.ts";
import {ROOT, loadRelease, type Release} from "./release.ts";
import {prepareBatch, batchTask} from "./batch.ts";
import {ToolRegistry} from "./tools.ts";
import {DataSnapshot} from "./snapshot.ts";
import {assemble} from "./context.ts";
import {checkResult} from "./checks.ts";
import {sharedDefinitionErrors, modelingDecisionErrors, uniqueDefinitions, definitionFingerprint, QUANTITY_RESPONSIBILITY} from "./modeling-contract.ts";
import {attribute, binding, fixtureSnapshot, fixtureTask, fixtureOutput, withFixtureDecisions, scriptedFetch, finalMessage, functionCall} from "./fixtures.ts";
import {Budget} from "./budget.ts";
import {ResponsesClient} from "./responses.ts";
import {runStage, BATCH_CORRECTIONS} from "./runner.ts";

let release: Release, temp: string, serial = 0;
beforeAll(async () => { release = await loadRelease(); temp = await mkdtemp(join(tmpdir(), "pgv3-pilot-quality-")); });
afterAll(async () => { await rm(temp, {recursive: true, force: true}); });
const next = () => join(temp, String(++serial));
const sample = (arm: string, phase = "family-seed", prefix = "640") => jsonClone(recordings.samples.find(s => s.arm === arm && s.phase === phase && s.categoryId.startsWith(prefix))!);
async function context(s = sample("high")) {
  const p = await prepareBatch({categoryId: s.categoryId, outDir: next(), runId: "offline-ab-replay", concurrency: 1,
    treePath: join(ROOT, "profiles/clean-paper-tree.json")}, release);
  const data = jsonClone(p.snapshot);
  const registered = jsonClone(recordings.registryFamily) as any; registered.runId = p.runId;
  if (!data.families.some(f => f.id === registered.id)) data.families.push(registered);
  const snapshot = new DataSnapshot(data), task = batchTask(p, s.categoryId, s.phase as "family-seed" | "leaf"), plan = await assemble(release, snapshot, task);
  // Replay real knowledge provenance without any network. The original quoted versions remain available.
  for (const ref of [...s.result.attributes, ...s.result.extensionCandidates].flatMap(i => i.references)) {
    if (ref.kind !== "knowledge") throw Error("unexpected SKU evidence in modeling recording");
    expect(release.knowledge[ref.id]!.sha256).toBe(ref.version);
    let offset: number | null = 0;
    do { const r = await plan.tools.call("knowledge_read", {id: ref.id, offset, length: 8000}); offset = r.nextOffset; } while (offset !== null);
  }
  return {p, snapshot, task, plan};
}

test("both real arms retain result provenance; missing decision contracts cannot silently pass", async () => {
  for (const s of recordings.samples) expect(hash(s.result)).toBe(s.provenance.resultHash);
  const s = sample("high"), {task, plan} = await context(s);
  const result = checkResult(task, s.result, plan.tools);
  expect(result.errors.some(e => e.message.includes("decisions"))).toBe(true);
  expect(Object.hasOwn(s.result, "decisions")).toBe(false);
});

test("cross-family shared identity catches all four real low collisions and preserves high reuse", async () => {
  const {snapshot, task, plan} = await context();
  const low = sample("low").result, high = sample("high").result;
  expect(sharedDefinitionErrors(low.attributes as any, snapshot.data, task.runId).map(e => e.objectId).sort()).toEqual([
    "roll.fragrance", "roll.layers", "roll.raw_material", "roll.sheet_size",
  ]);
  expect(checkResult(task, withFixtureDecisions(low), plan.tools).errors.filter(e => e.ruleId === "R03")).toHaveLength(4);
  expect(sharedDefinitionErrors(high.attributes as any, snapshot.data, task.runId)).toEqual([]);
  const copied = jsonClone(high.attributes as any[]); copied[0].rationale += " 补充业务用途"; copied[0].references = [];
  expect(sharedDefinitionErrors(copied, snapshot.data, task.runId)).toEqual([]);
  expect(definitionFingerprint(copied[0])).toBe(definitionFingerprint(high.attributes[0] as any));
});

test("the attribute pool refuses ambiguous IDs before a query can hide a conflicting version", async () => {
  const data = fixtureSnapshot(), task = fixtureTask("family-modeling");
  const conflict = attribute({definition: "另一计量对象"});
  data.attributes[0] = conflict;
  const registry = new ToolRegistry(new DataSnapshot(data), release, task);
  expect((await registry.call("search_attribute_pool", {query: "层数", categoryId: null, limit: 20, cursor: null})).items).toHaveLength(1);
  await expect(registry.call("search_attribute_pool", {query: "另一计量对象", categoryId: null, limit: 20, cursor: null})).rejects.toThrow("conflicting shared definitions");
  await expect(assemble(release, new DataSnapshot(data), task)).rejects.toThrow("conflicting shared definitions");
  expect(() => uniqueDefinitions([attribute(), {...attribute(), rationale: "different rationale"}])).not.toThrow();
  data.families.push({...jsonClone(data.families[0]!), id: "foreign-candidate", status: "candidate", runId: "another-run", attributes: [conflict], bindings: [binding(conflict.id)]});
  data.attributes[0] = attribute();
  expect((await assemble(release, new DataSnapshot(data), task)).tools).toBeDefined();
});

test("required necessity checks the real high contradiction even if the model claims confirmed", async () => {
  const s = sample("high", "leaf"), {snapshot} = await context(s);
  // Explicit synthetic decision annotations; all recorded business fields and unresolved text are unchanged.
  const annotated = withFixtureDecisions(s.result);
  expect(annotated.bindings.find(b => b.attributeId === "roll.layers")!.requiredness).toBe("required");
  expect(modelingDecisionErrors(annotated as any, snapshot.data).some(e => e.ruleId === "R02" && e.objectId === "roll.layers" && e.message.includes("unresolved"))).toBe(true);
  annotated.unresolved = [];
  const decision = annotated.decisions.find(d => d.objectId === "roll.layers")!;
  decision.requiredNecessity = "pending";
  expect(modelingDecisionErrors(annotated as any, snapshot.data).some(e => e.ruleId === "R02")).toBe(true);
  decision.requiredNecessity = "confirmed"; decision.valueEvidence = "missing";
  expect(modelingDecisionErrors(annotated as any, snapshot.data).filter(e => e.ruleId === "R02")).toEqual([]);
  annotated.unresolved = ["香型的必填必要性待业务确认；层数的精度依据待核实"];
  expect(modelingDecisionErrors(annotated as any, snapshot.data).filter(e => e.ruleId === "R02")).toEqual([]);
});

test("quantity ownership maps both packaging levels without requiring sampled SKU values", async () => {
  const {snapshot} = await context(), recorded = sample("high").result;
  const proposal = withFixtureDecisions({...recorded, attributes: recorded.attributes as AttributeDefinition[], bindings: recorded.bindings as AttributeBinding[]}), d = proposal.decisions.find(d => d.objectId === "facial.package_count")!;
  expect(modelingDecisionErrors(proposal as any, snapshot.data)).toEqual([]);
  expect(d.quantity!.relation).toBe("conditional");
  for (const mutate of [
    (q: any) => {q.relation = "distinct";},
    (q: any) => {q.sameWhen = null;},
    (q: any) => {q.overlapAction = "not_applicable";},
    (q: any) => {q.systemFieldKeys = ["invented.nativeField"];},
  ]) {
    const bad = jsonClone(proposal); mutate(bad.decisions.find(d => d.objectId === "facial.package_count")!.quantity);
    expect(modelingDecisionErrors(bad as any, snapshot.data).some(e => e.ruleId === "R01")).toBe(true);
  }
  d.quantity!.relation = "same";
  expect(modelingDecisionErrors(proposal as any, snapshot.data).some(e => e.ruleId === "R01")).toBe(true);
  proposal.attributes = proposal.attributes.filter(a => a.id !== d.objectId);
  proposal.bindings = proposal.bindings.filter(b => b.attributeId !== d.objectId);
  d.disposition = "system_owned";
  expect(modelingDecisionErrors(proposal as any, snapshot.data)).toEqual([]);
  d.quantity!.relation = "unresolved";
  expect(modelingDecisionErrors(proposal as any, snapshot.data).some(e => e.ruleId === "R01")).toBe(true);
});

test("low sample-coverage admission basis is separated from professional definition and optional filling", async () => {
  const s = sample("low", "leaf", "7a1"), {snapshot} = await context(s), output = withFixtureDecisions(s.result);
  const grammage = output.extensionCandidates.find(c => c.name === "克重")!;
  expect(grammage.activationCriteria).toContain("多数商品标识可取得");
  const d = output.decisions.find(d => d.objectId === grammage.id)!;
  d.admissionBasis = "sample_availability";
  expect(modelingDecisionErrors(output as any, snapshot.data).some(e => e.ruleId === "R07" && e.objectId === grammage.id)).toBe(true);
  d.admissionBasis = "business_need"; d.valueEvidence = "missing";
  expect(modelingDecisionErrors(output as any, snapshot.data)).toEqual([]);
  output.decisions[0]!.professionalReadiness = "pending";
  expect(modelingDecisionErrors(output as any, snapshot.data).some(e => e.ruleId === "R07")).toBe(true);
});

test("real high quantity omission and conditional plans remain explicit review questions, never invented values", async () => {
  const s = sample("high", "leaf", "7a1");
  expect(s.result.attributes.some(a => a.name === "每包数量")).toBe(false);
  expect(s.result.unresolved.some(t => t.includes("最小计量单位") && t.includes("每包"))).toBe(true);
  const {plan, snapshot} = await context(s);
  const annotated = withFixtureDecisions(s.result);
  expect(modelingDecisionErrors(annotated as any, snapshot.data).some(e => e.ruleId === "R01" && e.objectId === "quantity-responsibility")).toBe(true);
  expect(plan.input.sharedContext.quantityResponsibility).toEqual(QUANTITY_RESPONSIBILITY);
  expect(plan.instructions).toContain("不能用sample_availability");
  expect(plan.instructions).toContain("同ID必须保持已有定义");
});

test("actual request and bounded correction loop carry decisions, skill, tools and program feedback", async () => {
  const data = fixtureSnapshot(), task = fixtureTask("family-modeling"), good = fixtureOutput("family-modeling"), bad = jsonClone(good);
  bad.bindings[1].requiredness = "required"; bad.bindings[1].differenceReason = "提案仍待核实";
  bad.decisions[1].requiredNecessity = "pending";
  const mock = scriptedFetch([
    body => {
      expect(body.instructions).toContain("decisions");
      const context = JSON.parse(body.input[0].content).sharedContext;
      expect(context.quantityResponsibility.examples).toHaveLength(2);
      expect(JSON.stringify(body.text.format.schema)).toContain("requiredNecessity");
      return [functionCall("search_attribute_pool", {query: "层数", categoryId: null, limit: 10, cursor: null})];
    }, body => {
      expect(JSON.parse(body.input.at(-2).output).items.some((a: any) => a.id === "fixture-layers")).toBe(true);
      return [finalMessage(bad)];
    }, body => {
      expect(JSON.parse(body.input.at(-2).content).errors.some((e: any) => e.ruleId === "R02")).toBe(true);
      return [finalMessage(good)];
    },
  ]);
  const dir = next(), client = new ResponsesClient({mode: "offline", transportId: "pilot-quality-test", fetch: mock.fetch}, dir, new Budget(dir, 0, "offline-zero"));
  const artifact = await runStage({release, snapshot: new DataSnapshot(data), task, client, outDir: dir, corrections: BATCH_CORRECTIONS});
  expect(artifact.checks.errors).toEqual([]); expect(artifact.feedback).toHaveLength(1);
  expect(artifact.result).toEqual(good); expect(artifact.businessRepairs).toBe(0); expect(artifact.productionWrites).toBe(0);
  expect(artifact.checks.executedChecks).toContain("shared-definition-identity");
  expect(mock.requests).toHaveLength(3);
});
