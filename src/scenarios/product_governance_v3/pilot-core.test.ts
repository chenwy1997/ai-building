import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hash, jsonClone, type AttributeDefinition } from "./core.ts";
import { ROOT, loadRelease, type Release } from "./release.ts";
import { prepareBatch, batchTask, pendingFamily, CLEAN_PAPER_ID, type BatchPlan } from "./batch.ts";
import { assemble } from "./context.ts";
import { DataSnapshot } from "./snapshot.ts";
import { checkResult } from "./checks.ts";
import { reuseApplicability, attributeApplicabilityErrors } from "./attribute-applicability.ts";
import { definitionFingerprint, modelingDecisionErrors, needsQuantityMapping } from "./modeling-contract.ts";
import { fixtureCoreAttributes, fixtureWireResult, withFixtureDecisions, binding } from "./fixtures.ts";
import { materializeModelResult } from "./modeling-proposal.ts";
import { PILOT_CATEGORIES } from "./pilot-knowledge.ts";
import { PILOT_CORE_ID, PILOT_CORE_REVIEW, COMPACT_INVENTORY_ID, pilotCoreErrors } from "./pilot-core.ts";
import originalInventory from "./scm-field-responsibilities.json";
import compactInventory from "./knowledge/scm-field-responsibilities-compact-20261026.json";
import nativeCarrier from "./knowledge/native-quantity-carrier-20261026.json";
import historical from "./fixtures/pilot-applicability-20261026.json";

let release: Release, plan: BatchPlan, temp: string;
const [WASH, BOX, SOFT] = PILOT_CATEGORIES.map(c => c.id) as [string, string, string];
beforeAll(async () => {
  release = await loadRelease(); temp = await mkdtemp(join(tmpdir(), "pgv3-core-"));
  plan = await prepareBatch({ categoryId: CLEAN_PAPER_ID, outDir: temp, runId: "core-offline-only", concurrency: 3,
    treePath: join(ROOT, "profiles/clean-paper-tree.json") }, release);
});
afterAll(async () => { await rm(temp, { recursive: true, force: true }); });

test("compact field inventory is lossless and preserves the published historical citation version", async () => {
  expect(compactInventory).toEqual(originalInventory);
  expect(release.knowledge["scm-field-responsibilities-20261022"]!.sha256)
    .toBe("affcf4095798cbb58ba3e80b1431ed821e74e3b6e1bba640a72630c279185319");
  const { input, tools } = await assemble(release, new DataSnapshot(plan.snapshot), batchTask(plan, WASH, "leaf"));
  expect(input.sharedContext.knowledge.filter(k => k.id === COMPACT_INVENTORY_ID).map(k => k.text).join(""))
    .toBe(release.knowledge[COMPACT_INVENTORY_ID]!.body);
  expect(input.sharedContext.knowledge.some(k => k.id === "scm-field-responsibilities-20261022")).toBe(false);
  expect(tools.knowledgeReadIds.has(COMPACT_INVENTORY_ID)).toBe(true);
});

async function sample(categoryId: string, phase: "family-seed" | "leaf" = "leaf") {
  const snapshot = new DataSnapshot(plan.snapshot), task = batchTask(plan, categoryId, phase), context = await assemble(release, snapshot, task);
  const attributes = fixtureCoreAttributes(context.input)!;
  const full = withFixtureDecisions({ categoryId, baselineVersion: null, attributes,
    bindings: attributes.map(a => binding(a.id, { categoryId })), extensionCandidates: [],
    unresolved: ["构造回答，仅验收已确认范围与执行合同；具体SKU单位组合未读"] });
  const wire = fixtureWireResult(full, { input: [{ content: JSON.stringify(context.input) }] });
  const output = materializeModelResult(snapshot, task, wire);
  return { snapshot, task, context, wire, ...output };
}

test("frozen offline assessment reuses exact paper definitions for both tissues, never towels or SKU filling", async () => {
  expect(plan.preflight).toEqual([]);
  const { snapshot, task, context, result } = await sample(BOX, "family-seed");
  for (const source of PILOT_CORE_REVIEW.sourceDefinitions.definitions) {
    const a = source as AttributeDefinition;
    const reviewed = snapshot.data.attributeApplicability!.find(r => r.attributeId === a.id && r.status === "supported")!;
    expect(reviewed.definitionHash).toBe(definitionFingerprint(a));
    expect(reuseApplicability(a, snapshot.data, task).coveredCategoryIds.sort()).toEqual([BOX, SOFT].sort());
    expect(reuseApplicability(a, snapshot.data, batchTask(plan, WASH, "leaf")).reusable).toBe(false);
    expect(reuseApplicability(a, snapshot.data, { ...task, stage: "sku-filling", candidate: null }).reusable).toBe(false);
    expect(reuseApplicability(a, snapshot.data, { ...task, categoryId: "f4bb18c7-b736-4fe6-91d1-60c4d05fcee6", candidate: null }).reusable).toBe(false);
    expect(result.attributes.find((p: any) => p.id === a.id)).toEqual(a);
  }
  const search = await context.tools.call("search_attribute_pool", { query: "单张尺寸", categoryId: BOX, limit: 20, cursor: null });
  expect(search.items.some((a: any) => a.id === "roll.sheet_size")).toBe(true);
  expect(search.reuseApplicability.find((a: any) => a.attributeId === "roll.sheet_size").reusable).toBe(true);
  expect(checkResult(task, result, context.tools).errors).toEqual([]);
});

test("offline authority cannot be manufactured, widened, edited or applied to a stale definition", () => {
  for (const change of [
    (d: any) => { d.attributeApplicability[0].targetCategoryIds.push(WASH); },
    (d: any) => { d.attributeApplicability[0].reason = "模型认为适用"; },
    (d: any) => { d.attributeApplicability[0].reviewRecordId = "invented"; },
    (d: any) => { d.attributeApplicability[0].definitionHash = "stale"; },
  ]) {
    const d = jsonClone(plan.snapshot); change(d);
    expect(() => new DataSnapshot(d)).toThrow("released authorization/evidence record");
  }
});

test("confirmed core omissions and extensions fail; optional compound sizes and conditional quantity pass", async () => {
  for (const id of [WASH, BOX, SOFT]) {
    const { result, context, task, snapshot } = await sample(id, id === BOX ? "family-seed" : "leaf");
    expect(checkResult(task, result, context.tools).errors).toEqual([]);
    const removed = jsonClone(result), omitted = removed.attributes.shift();
    removed.bindings = removed.bindings.filter((b: any) => b.attributeId !== omitted.id);
    removed.decisions = removed.decisions.filter((d: any) => d.objectId !== omitted.id);
    expect(pilotCoreErrors(removed, snapshot.data, task).some(e => e.objectId === omitted.conceptKey)).toBe(true);
    const extra = jsonClone(result);
    extra.attributes.push({ ...extra.attributes[0], id: "extra.usage", conceptKey: "usage.reusable", name: "一次性/可重复使用" });
    expect(pilotCoreErrors(extra, snapshot.data, task).some(e => e.objectId === "extra.usage")).toBe(true);
    const required = jsonClone(result); required.bindings[0].requiredness = "required";
    expect(pilotCoreErrors(required, snapshot.data, task).length).toBeGreaterThan(0);
  }
});

test("same units in the title do not bypass ownership; native aliases resolve to actual carrier defaults", async () => {
  const { result, context, task, snapshot, assembly } = await sample(WASH);
  const q = result.decisions.find((d: any) => d.quantity)!;
  expect(needsQuantityMapping({ name: "内装数量", conceptKey: "custom.content" })).toBe(true);
  expect(needsQuantityMapping({ name: "每盒抽数", conceptKey: "custom.content" })).toBe(true);
  const mapping = assembly.quantityMappings[0];
  expect(mapping.salesUnitField).toBe("saleUnit");
  expect(mapping.salesUnitOwnerKey).toBe("salesUnit");
  expect(mapping.nativeCarrier.categoryKeyConfig).toEqual({ quantityField: "unitMinQuaKey", unitField: "unitMinKey", salesUnitField: "saleUnitKey" });
  expect(mapping.nativeCarrier).toEqual(nativeCarrier.mapping);
  expect(mapping.bindingStatus).toBe("unresolved_until_category_key_config_and_sku_units_are_read");
  for (const relation of ["same", "distinct", "unresolved"]) {
    const wrong = jsonClone(result); wrong.decisions.find((d: any) => d.objectId === q.objectId).quantity.relation = relation;
    expect(checkResult(task, wrong, context.tools).errors.some(e => e.objectId === q.objectId)).toBe(true);
  }
  const missing = jsonClone(result); missing.decisions.find((d: any) => d.objectId === q.objectId).quantity = null;
  expect(modelingDecisionErrors(missing, snapshot.data).some(e => e.ruleId === "R01")).toBe(true);
  const wrongObject = jsonClone(result); wrongObject.decisions.find((d: any) => d.objectId === q.objectId).quantity.countTerms = ["卷"];
  expect(pilotCoreErrors(wrongObject, snapshot.data, task).length).toBeGreaterThan(0);
});

test("the real recorded extra usage attribute and split dimensions cannot satisfy the newly agreed core", async () => {
  for (const old of historical.cases) {
    const before = hash(old.result), snapshot = new DataSnapshot(plan.snapshot),
      task = batchTask(plan, old.categoryId, old.phase as "leaf" | "family-seed");
    const errors = pilotCoreErrors(old.result, snapshot.data, task);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.objectId.includes("sheet_size"))).toBe(true);
    expect(hash(old.result)).toBe(before);
  }
});

test("inherited leaves carry quantity carrier plans, exact definitions and all mandatory knowledge within budget", async () => {
  const seed = await sample(BOX, "family-seed"), data = jsonClone(plan.snapshot);
  const family = pendingFamily(plan.groups.find(g => g.id === "facial-tissue")!, { result: seed.result } as any, plan.runId);
  data.families.push(family);
  const snapshot = new DataSnapshot(data);
  for (const id of [BOX, SOFT]) {
    const task = batchTask(plan, id, "leaf"), context = await assemble(release, snapshot, task);
    const raw = { contractVersion: "modeling-proposal-v1", baselineVersion: family.version, reuse: [], newAttributes: [], newBindings: [],
      newExtensionCandidates: [], decisions: [], revisionRequests: [], unresolved: [] };
    const { result, assembly } = materializeModelResult(snapshot, task, raw);
    expect(result.attributes).toEqual(seed.result.attributes);
    expect(assembly.quantityMappings).toHaveLength(1);
    expect(assembly.quantityMappings[0].inherited).toBe(true);
    expect(checkResult(task, result, context.tools).errors).toEqual([]);
    expect(context.manifest.contextUsage.totalBytes).toBeLessThan(200000);
    const parts = context.input.sharedContext.knowledge.filter(k => k.id === PILOT_CORE_ID);
    expect(parts.map(k => k.text).join("")).toBe(release.knowledge[PILOT_CORE_ID]!.body);
    expect(context.input.sharedContext.knowledgeGaps).toEqual([]);
    // Core-only scope permission cannot be laundered into SKU permission by a family.
    expect(attributeApplicabilityErrors(result.attributes.filter((a: any) => a.id.startsWith("roll.")), snapshot.data,
      { ...task, stage: "sku-filling" }).length).toBe(3);
  }
});
