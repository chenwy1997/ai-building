import { join, resolve } from "node:path";
import { read, save, exists, hash, lock, jsonClone, Blocked } from "./core.ts";
import type { Release } from "./release.ts";
import { DataSnapshot } from "./snapshot.ts";
import { batchTask, pendingFamily, validateBatchOptions, type BatchPlan } from "./batch.ts";
import { recheckUnlocked } from "./batch-recovery.ts";
import { validateBatchAccounting } from "./batch-accounting.ts";
import { assembleStageContext } from "./stage-context.ts";
import { BATCH_CORRECTIONS, type ModelOptions } from "./runner.ts";
import { effectiveBudgetLimit } from "./budget.ts";

export interface ContinuationOptions {
  directory: string; fromRound: string; categoryIds: string[];
  concurrency: number; reasoningEffort?: ModelOptions["reasoningEffort"];
}
async function frozen(path: string, value: unknown) {
  if (await exists(path)) {
    if (hash(await read(path)) !== hash(value))
      throw new Blocked("continuation_identity_drift", "continuation already has different frozen rules/scope/input; do not rename to buy another loop: " + path);
  } else await save(path, value);
}

// Same logical run and candidate scope. Only jobs blocked before any model request
// are eligible; this is not a new rules rerun or permission to buy another attempt.
export async function prepareContinuation(options: ContinuationOptions, release: Release) {
  const directory = resolve(options.directory);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(options.fromRound)) throw Error("invalid --from-round");
  if (!options.categoryIds?.length || options.categoryIds.some(id => !id.trim()) ||
      new Set(options.categoryIds).size !== options.categoryIds.length)
    throw Error("--category-ids须为非空、无重复的末级ID列表");
  return lock(join(directory, "execution.lock"), async () => {
    const root = await validateBatchAccounting(directory), sourceDir = join(directory, "reruns", options.fromRound),
      sourceIdentity = await read(join(sourceDir, "batch.identity.json"));
    if (sourceIdentity.accounting?.directory !== directory || sourceIdentity.accounting?.originalBatchId !== root.sourceId)
      throw new Blocked("continuation_scope", "source round must belong to this original accounting root");
    const checked = await recheckUnlocked(sourceDir, release), source = checked.original as BatchPlan;
    if (options.reasoningEffort !== undefined && options.reasoningEffort !== source.model.reasoningEffort)
      throw new Blocked("continuation_identity_drift", "continuation inherits the source model/reasoning; changing it requires an explicit new experiment");
    validateBatchOptions({ categoryId: source.root.id, runId: source.runId, outDir: directory, concurrency: options.concurrency });
    const categoryIds = source.categoryIds.filter(id => options.categoryIds.includes(id));
    if (categoryIds.length !== options.categoryIds.length) throw new Blocked("continuation_scope", "only source-round leaf IDs may continue");
    for (const id of categoryIds) {
      const job = checked.historicalJobs.find(j => j.categoryId === id),
        trace = checked.report.traces.find(t => t.phase === "leaf" && t.categoryId === id);
      if (job?.status !== "program_blocked" || job.code !== "context_budget" || job.artifact || trace?.originalRequestKeys.length !== 0)
        throw new Blocked("continuation_scope", "only verified pre-request context_budget leaves may continue; preserve successes and inspect paid failures: " + id);
    }
    // Reconstruct all shared input from the original snapshot plus the checked
    // seed outputs. Merely trusting a rehashed shared file could omit sources.
    const expectedShared = jsonClone(source.snapshot);
    for (const group of source.groups.filter(g => g.needsSeed)) {
      const seed = checked.seeds.find(j => j.familyId === group.id);
      if (seed?.status === "program_pass_pending_human" && seed.artifact && (seed.artifact.result as any).attributes.length)
        expectedShared.families.push(pendingFamily(group, seed.artifact, source.runId));
    }
    if (hash(expectedShared) !== hash(checked.shared))
      throw new Blocked("continuation_context_drift", "shared input differs from complete original sources plus checked baselines");
    const snapshot = new DataSnapshot(checked.shared),
      groups = source.groups.filter(g => g.members.some(id => categoryIds.includes(id)));
    const reusedBaselines = groups.map(group => {
      const family = snapshot.data.families.find(f => f.id === group.id), seed = checked.seeds.find(j => j.familyId === group.id);
      if (!group.needsSeed || seed?.status !== "program_pass_pending_human" || !seed.artifact || !family?.attributes.length ||
          hash(pendingFamily(group, seed.artifact, source.runId)) !== hash(family))
        throw new Blocked("continuation_baseline", "source baseline must match the complete revalidated successful seed: " + group.id);
      return { id: family.id, version: family.version, status: family.status, runId: family.runId,
        sourceRunKey: checked.report.traces.find(t => t.phase === "family-seed" && t.categoryId === group.seedCategoryId)?.originalRunKey,
        requestKeys: seed.artifact.requestKeys, familyHash: hash(family) };
    });
    const outDir = join(directory, "continuations", options.fromRound),
      continuation = { format: 1, roundName: options.fromRound, sourceBatchId: root.sourceId,
        sourceRoundBatchId: source.id, sourceFingerprint: checked.sourceFingerprint,
        sourceReleaseId: source.releaseId, releaseId: release.id, snapshotVersion: snapshot.version,
        categoryIds, runId: source.runId, model: source.model, limits: source.limits,
        reusedBaselines, budgetLimitCny: root.execution.budgetCny, pricingId: root.execution.pricingId,
        reserveCny: source.reserveCny, transportId: root.execution.transportId, mode: root.execution.mode },
      continuationId = hash(continuation);
    const plan: BatchPlan = { ...source, id: "", releaseId: release.id, snapshot: snapshot.data,
      inputVersion: snapshot.version, categoryIds, groups: groups.map(g => ({ ...g, needsSeed: false })),
      outDir, concurrency: options.concurrency, preflight: [],
      accounting: { directory, originalBatchId: root.sourceId, roundName: options.fromRound, roundId: continuationId, kind: "continuation" },
      maximumStageTasks: categoryIds.length, maximumRequests: categoryIds.length * source.limits.maxRounds,
      maximumReservationCny: Number((categoryIds.length * source.limits.maxRounds * (root.execution.mode === "network" ? source.reserveCny : 0)).toFixed(2)) };
    const capacities = [];
    for (const categoryId of categoryIds) try {
      const context = await assembleStageContext({ release, snapshot, task: batchTask(plan, categoryId, "leaf"),
        model: plan.model, limits: plan.limits, corrections: BATCH_CORRECTIONS });
      if (!snapshot.baseline(batchTask(plan, categoryId, "leaf"))) throw new Blocked("family_dependency", "complete original baseline unavailable");
      if (context.tools.knowledgeGaps().length) throw new Blocked("knowledge_dependency", context.tools.knowledgeGaps().join("; "));
      capacities.push({ categoryId, contextUsage: context.manifest.contextUsage, ...context.manifest.requestCapacity });
    } catch (error) {
      plan.preflight.push({ categoryId, code: error instanceof Blocked ? error.code : "preflight_error", error: String(error) });
    }
    const { id: _id, outDir: _out, concurrency: _c, preflight: _p, ...identity } = plan;
    plan.id = hash(identity);
    await frozen(join(outDir, "continuation.identity.json"), { ...continuation, id: continuationId });
    await frozen(join(outDir, "batch.identity.json"), { ...identity, id: plan.id });
    const reserved = Number(root.ledger.entries.reduce((sum: number, e: any) => sum + e.reservedCny, 0).toFixed(2)),
      remaining = Number((effectiveBudgetLimit(root.ledger) - reserved).toFixed(2)),
      preview = { mode: "continuation_preview", ready: !plan.preflight.length, outDir, originalDirectory: directory,
        sourceDirectory: sourceDir, categoryIds, categories: categoryIds.map(id => ({ id, name: snapshot.tree.get(id).name })),
        model: plan.model, concurrency: plan.concurrency, reusedBaselines, familySeeds: [], capacities,
        preflight: plan.preflight, originalRequestCount: root.keys.length, cumulativeReservedCny: reserved,
        budgetLimitCny: effectiveBudgetLimit(root.ledger), remainingReservationCny: remaining,
        maximumAdditionalRequests: plan.maximumRequests, maximumAdditionalReservationCny: plan.maximumReservationCny,
        fullWorstCaseFitsRemainingBudget: remaining >= plan.maximumReservationCny,
        sourceArtifactsModified: false, networkCalls: 0, productionWrites: 0, adoption: "pending_human",
        next: "同命令加--execute只续跑所选末级；同源轮次固定一个续跑目录，重复执行恢复原请求，不重跑基线，不重置预算" };
    await save(join(outDir, "continuation.plan.json"), preview);
    return { plan, execution: root.execution, preview };
  });
}

// Called inside executeBatch's root lock to close the preview/execution race.
export async function assertContinuationSource(plan: BatchPlan, release: Release, identity: any) {
  const sourceDir = join(plan.accounting!.directory, "reruns", plan.accounting!.roundName),
    checked = await recheckUnlocked(sourceDir, release);
  if (identity.sourceFingerprint !== checked.sourceFingerprint || identity.sourceRoundBatchId !== checked.original.id ||
      plan.runId !== checked.original.runId || hash(checked.shared) !== plan.inputVersion ||
      plan.groups.some(g => g.needsSeed) || hash(plan.model) !== hash(checked.original.model) ||
      hash(plan.limits) !== hash(checked.original.limits))
    throw new Blocked("continuation_identity_drift", "source baseline/scope changed since continuation preflight");
}
