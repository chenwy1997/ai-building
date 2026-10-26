import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import recorded from "./fixtures/pilot-quality-cache-20261026.json";
import { canonical, hash, jsonClone, STAGES } from "./core.ts";
import { ROOT, loadRelease, ruleResponsibilitiesFor, type Release } from "./release.ts";
import { assemble, joinKnowledgePrefetch } from "./context.ts";
import { serializeContextInput } from "./request-layout.ts";
import { DataSnapshot } from "./snapshot.ts";
import { prepareBatch, pendingFamily, batchTask, CLEAN_PAPER_ID, type BatchPlan } from "./batch.ts";
import { fixtureSnapshot, fixtureTask, finalMessage, functionCall, scriptedFetch, preCoreReplaySnapshot } from "./fixtures.ts";
import { ResponsesClient } from "./responses.ts";
import { Budget } from "./budget.ts";
import { runStage, BATCH_CORRECTIONS } from "./runner.ts";
import { attributeApplicabilityErrors } from "./attribute-applicability.ts";
import { definitionFingerprint } from "./modeling-contract.ts";

let release: Release, temp: string, plan: BatchPlan, serial = 0;
const next = () => join(temp, String(serial++));
const seed = recorded.cases.find(c => c.phase === "family-seed")!;
beforeAll(async () => {
  release = await loadRelease();
  temp = await mkdtemp(join(tmpdir(), "pgv3-generated-context-"));
  plan = await prepareBatch({ categoryId: CLEAN_PAPER_ID, outDir: next(),
    runId: recorded.provenance.runId, concurrency: 3,
    treePath: join(ROOT, "profiles/clean-paper-tree.json") }, release);
  plan = { ...plan, snapshot: preCoreReplaySnapshot(plan.snapshot) };
});
afterAll(async () => { await rm(temp, { recursive: true, force: true }); });

test("prefetch joining preserves exact text and rejects gaps, overlaps, partial reads and changed versions", () => {
  const body = "一段原文\n  保留空格与换行", sha256 = hash(body);
  const pages = [0, 5].map((offset, i) => ({ id: "recorded", kind: "source", version: sha256, sha256,
    offset, end: i ? body.length : 5, totalCharacters: body.length, text: body.slice(offset, i ? body.length : 5),
    truncated: i === 0, nextOffset: i ? null : 5 }));
  const original = hash(pages), merged = joinKnowledgePrefetch(pages);
  expect(merged).toHaveLength(1); expect(merged[0].text).toBe(body); expect(hash(pages)).toBe(original);
  for (const mutate of [
    (p: any[]) => { p[1].offset++; }, (p: any[]) => { p[1].offset--; },
    (p: any[]) => { p.pop(); }, (p: any[]) => { p[1].version = "other"; },
    (p: any[]) => { p[1].text = p[1].text.replace("保留", "改写"); },
  ]) { const p = jsonClone(pages); mutate(p); expect(() => joinKnowledgePrefetch(p)).toThrow(); }
});

for (const stage of STAGES) test(stage + ": one complete responsibility registry remains in instructions with a verifiable reference", async () => {
  const p = await assemble(release, new DataSnapshot(fixtureSnapshot()), fixtureTask(stage)),
    rules = ruleResponsibilitiesFor(stage), ref = p.input.sharedContext.ruleResponsibilities;
  expect(ref).toEqual({ kind: "instructions_reference", source: "instructions.ruleResponsibilities",
    ruleIds: rules.map(r => r.id), sha256: hash(rules) });
  expect(p.instructions.split(JSON.stringify(rules))).toHaveLength(2);
  expect(p.serializedInput).not.toContain(canonical(rules));
  expect(p.manifest.ruleIds).toEqual(ref.ruleIds);
  expect(p.manifest.contextUsage.totalBytes).toBe(Buffer.byteLength(p.instructions + p.serializedInput));
  expect(p.manifest.contextUsage.limitBytes).toBe(200000);
});

test("the recorded generated tissue baseline fits both leaves with every definition, decision and citation intact", async () => {
  expect(hash(seed.result)).toBe(seed.resultHash);
  const group = plan.groups.find(g => g.id === "facial-tissue")!, data = jsonClone(plan.snapshot),
    family = pendingFamily(group, { result: seed.result } as any, plan.runId);
  data.families.push(family);
  const snapshot = new DataSnapshot(data);
  for (const categoryId of group.members) {
    const task = batchTask(plan, categoryId, "leaf"), p = await assemble(release, snapshot, task),
      priorInput = { ...p.input, sharedContext: { ...p.input.sharedContext, ruleResponsibilities: ruleResponsibilitiesFor(task.stage) } };
    // Reproduce the real failure cause using the same generated baseline, not a small synthetic family.
    expect(Buffer.byteLength(p.instructions + serializeContextInput(priorInput))).toBeGreaterThan(200000);
    expect(p.manifest.contextUsage.totalBytes).toBeLessThanOrEqual(200000);
    const supplied = ((p.input.sharedContext as any).family as any[]).flatMap(p => p.items).find(f => f.id === group.id);
    expect(supplied.attributes).toEqual(seed.result.attributes);
    expect(supplied.decisions).toEqual(seed.result.decisions);
    expect(supplied.extensionCandidates).toEqual(seed.result.extensionCandidates);
    expect(supplied.bindings).toEqual(family.bindings);
    for (const a of (p.input.sharedContext as any).attributePool.items) {
      if (a.kind !== "context_definition_reference") continue;
      const [page, f, index] = [...a.source.matchAll(/\[(\d+)\]/g)].map(m => Number(m[1]));
      const full = (p.input.sharedContext as any).family[page!].items[f!].attributes[index!];
      expect(hash(full)).toBe(a.sha256); expect(full.id).toBe(a.id);
    }
    for (const ref of p.input.sharedContext.baselineReferenceDependencies)
      expect(p.tools.referenceError(ref)).toBeNull();
    const knowledgeId = "small-roll-paper-research-20261022",
      chunks = p.input.sharedContext.knowledge.filter(k => k.id === knowledgeId);
    expect(chunks.map(k => k.text).join("")).toBe(release.knowledge[knowledgeId]!.body);
    expect(chunks).toHaveLength(1);
    for (const k of p.input.sharedContext.knowledge) {
      expect(k.text).toBe(release.knowledge[k.id]!.body);
      expect(k.version).toBe(release.knowledge[k.id]!.sha256);
      const reads = p.tools.events.filter(e => e.name === "knowledge_read" && (e.result as any).id === k.id);
      expect(reads.map(e => (e.result as any).text).join("")).toBe(k.text);
      expect(p.manifest.knowledge.filter(m => m.id === k.id)).toHaveLength(reads.length);
    }
    const toolCopy = await p.tools.call("get_family_context", { categoryId, cursor: null, limit: 10 });
    expect(toolCopy.items.find((f: any) => f.id === group.id).decisions).toEqual(seed.result.decisions);
  }
});

test("recorded seed with explicit synthetic target reviews flows through both mock leaf loops without increasing limits", async () => {
  const seedTask = batchTask(plan, seed.categoryId, "family-seed"), group = plan.groups.find(g => g.id === "facial-tissue")!,
    input = jsonClone(plan.snapshot), rejectedIds = new Set(attributeApplicabilityErrors(seed.result.attributes as any, input, seedTask).map(e => e.objectId));
  // Preserve this recording's full-output protocol. New delta loops have their own tests.
  delete (seedTask.candidate as any).modelingContractVersion;
  // The unmodified real result now correctly fails applicability. Only this constructed
  // integration scenario supplies fixture reviews; it does not approve the real proposal.
  input.kind = "fixture";
  input.attributeApplicability = seed.result.attributes.filter(a => rejectedIds.has(a.id)).map(a => ({
    id: "fixture-" + a.id, attributeId: a.id, definitionHash: definitionFingerprint(a as any), targetCategoryIds: group.members,
    status: "supported", reviewKind: "fixture", reviewRecordId: "constructed-context-test", reason: "仅构造验证装配体积与工具循环，不是真实核实结论",
  }));
  const dir = next(),
    seedMock = scriptedFetch([
      [functionCall("knowledge_read", { id: "small-roll-paper-research-20261022", offset: 0, length: 8000 }, "seed-source")],
      [finalMessage(seed.result)],
    ]),
    client = new ResponsesClient({ mode: "offline", transportId: "recorded-context-seed", fetch: seedMock.fetch },
      dir, new Budget(dir, 0, "offline-zero")),
    artifact = await runStage({ release, snapshot: new DataSnapshot(input), task: seedTask, client,
      outDir: dir, corrections: BATCH_CORRECTIONS, model: plan.model, limits: plan.limits });
  expect(artifact.result).toEqual(seed.result);
  expect(artifact.checks.errors).toEqual([]);
  const data = jsonClone(input),
    family = pendingFamily(group, artifact, plan.runId);
  data.families.push(family);
  const snapshot = new DataSnapshot(data);
  for (const categoryId of group.members) {
    const leafDir = next(), task = batchTask(plan, categoryId, "leaf"),
      synthetic = { ...jsonClone(seed.result), categoryId, baselineVersion: family.version,
        bindings: family.bindings.map(b => ({ ...b, categoryId, baselineAttributeId: b.attributeId })),
        unresolved: [...seed.result.unresolved, "离线构造末级响应，仅验证原真实共同方案的上下文装配，不是新模型业务提案"] },
      mock = scriptedFetch([
        [functionCall("categories_get", { id: categoryId }, "leaf-category")],
        (body) => {
          expect(JSON.parse(body.input.at(-2).output).node.id).toBe(categoryId);
          expect(body.reasoning).toEqual({ effort: "low" });
          expect(body.max_output_tokens).toBe(plan.limits.maxOutputTokens);
          return [finalMessage(synthetic)];
        },
      ]),
      leafClient = new ResponsesClient({ mode: "offline", transportId: "generated-context-leaf", fetch: mock.fetch },
        leafDir, new Budget(leafDir, 0, "offline-zero"));
    delete (task.candidate as any).modelingContractVersion;
    const leaf = await runStage({ release, snapshot, task, client: leafClient, outDir: leafDir,
        corrections: BATCH_CORRECTIONS, model: plan.model, limits: plan.limits });
    expect(leaf.checks.errors).toEqual([]);
    expect(leaf.manifest.contextUsage.totalBytes).toBeLessThanOrEqual(200000);
    expect(mock.requests).toHaveLength(2);
    expect(mock.requests[1].instructions).toBe(mock.requests[0].instructions);
    expect(mock.requests[1].input.slice(0, mock.requests[0].input.length)).toEqual(mock.requests[0].input);
    expect(mock.requests.every(b => Buffer.byteLength(canonical(b)) <= plan.limits.maxRequestBytes)).toBe(true);
    expect(leaf.productionWrites).toBe(0);
  }
});

test("an actually oversized dynamic context still blocks and reports component bytes before any HTTP request", async () => {
  const dir = next(), snapshot = new DataSnapshot(plan.snapshot), task = {
    ...batchTask(plan, seed.categoryId, "family-seed"), question: "x".repeat(200001),
  }, client = new ResponsesClient({ mode: "offline", transportId: "oversized-context",
    fetch: async () => { throw Error("must not send oversized or truncated context"); } }, dir, new Budget(dir, 0, "offline-zero"));
  await expect(runStage({ release, snapshot, task, client, outDir: dir })).rejects.toThrow('"limitBytes":200000');
  await expect(assemble(release, snapshot, task)).rejects.toThrow("no content was truncated and no request was sent");
  expect(client.calls).toBe(0);
});
