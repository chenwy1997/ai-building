import { join, resolve } from "node:path";
import { Blocked, read, save, hash, exists, lock, jsonClone } from "./core.ts";
import type { Release } from "./release.ts";
import { DataSnapshot } from "./snapshot.ts";
import { recheckUnlocked } from "./batch-recovery.ts";
import { readCompletedRequest as durable } from "./request-journal.ts";
import { verifiedReplayClient } from "./transcript-replay.ts";
import { resumableFailure } from "./runtime-errors.ts";
import { validateBatchAccounting } from "./batch-accounting.ts";
import { batchTask, pendingFamily, mapConcurrent, buildBatchReview, type BatchPlan, type BatchJob } from "./batch.ts";
import { runStage, BATCH_CORRECTIONS, type ModelOptions } from "./runner.ts";
import type { ResponsesClient } from "./responses.ts";
import { proposalCounts, proposalReadiness } from "./proposal-readiness.ts";
import { familyCoverage } from "./family-coverage.ts";
import { effectiveBudgetLimit } from "./budget.ts";
import { loadResumptionForOutputRecovery } from "./batch-resume-source.ts";
import { outputTokens, outputReservation, outputTimeoutMs } from "./response-capacity.ts";

export interface ResumeOptions {
  directory: string; fromRound: string; concurrency: number;
  reasoningEffort?: ModelOptions["reasoningEffort"];
  maxOutputTokens?: number;
}
async function frozen(path: string, value: unknown) {
  if (await exists(path)) {
    if (hash(await read(path)) !== hash(value))
      throw new Blocked("resume_identity_drift", "fixed resume source/host changed; inspect the existing transcript instead of buying another loop");
  } else await save(path, value);
}

async function inspect(options: ResumeOptions, release: Release) {
  const directory = resolve(options.directory);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(options.fromRound)) throw Error("invalid --from-round");
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 128)
    throw Error("concurrency must be 1..128");
  if (options.maxOutputTokens !== undefined) outputTokens(options.maxOutputTokens);
  const root = await validateBatchAccounting(directory), sourceDir = join(directory, "reruns", options.fromRound),
    checked = await recheckUnlocked(sourceDir, release), source = checked.original as BatchPlan;
  if (source.accounting?.directory !== directory || source.accounting.originalBatchId !== root.sourceId)
    throw new Blocked("resume_scope", "source round belongs to a different accounting root");
  if (options.reasoningEffort !== undefined && options.reasoningEffort !== source.model.reasoningEffort)
    throw new Blocked("resume_identity_drift", "resume preserves the original model/reasoning");
  // A stopped leaf must see exactly the original completed baselines and source
  // data. Do not substitute a newer or merely similarly named template here.
  const shared = jsonClone(source.snapshot);
  for (const group of source.groups.filter(g => g.needsSeed)) {
    const seed = checked.historicalSeeds.find(j => j.familyId === group.id);
    if (seed?.status !== "program_pass_pending_human" || !seed.artifact || !(seed.artifact.result as any).attributes.length)
      throw new Blocked("resume_family_dependency", "resume requires a verified successful original baseline: " + group.id);
    shared.families.push(pendingFamily(group, seed.artifact, source.runId));
  }
  if (hash(shared) !== hash(checked.shared))
    throw new Blocked("resume_context_drift", "original full context/baselines changed");
  let originalResults = await read(join(sourceDir, "batch.results.json")),
    targets = checked.historicalJobs.filter(j => resumableFailure(j) !== null),
    outDir = join(directory, "resumptions", options.fromRound), effectiveSourceDir = sourceDir;
  const wireRelease = { ...release, id: source.releaseId },
    provenance = { hostReleaseId: release.id, sourceBatchId: source.id, sourceFingerprint: checked.sourceFingerprint },
    snapshot = new DataSnapshot(shared);
  const outputRecovery = options.maxOutputTokens === undefined ? undefined : { maxOutputTokens: options.maxOutputTokens };
  const parent = outputRecovery ? await loadResumptionForOutputRecovery({ directory, parentDir: outDir, source,
    sourceFingerprint: checked.sourceFingerprint, originalResults, snapshot, wireRelease,
    ledger: root.ledger, execution: root.execution, maxOutputTokens: outputRecovery.maxOutputTokens }) : null;
  if (parent) {
    originalResults = parent.originalResults; targets = parent.targets; outDir = parent.outDir; effectiveSourceDir = parent.sourceDir;
  }
  const reserveCny = root.execution.mode === "offline" ? 0 : outputRecovery ? outputReservation(source.limits.maxOutputTokens, source.reserveCny,
    outputRecovery.maxOutputTokens, source.pricingId) : source.reserveCny,
    timeoutMs = outputTimeoutMs(outputRecovery?.maxOutputTokens ?? source.limits.maxOutputTokens),
    identity = { format: 1, sourceBatchId: source.id, originalBatchId: root.sourceId,
      sourceFingerprint: checked.sourceFingerprint, fromRound: options.fromRound,
      businessReleaseId: source.releaseId, hostReleaseId: release.id,
      categoryIds: targets.map(j => j.categoryId), inputVersion: snapshot.version,
      model: source.model, limits: source.limits, corrections: BATCH_CORRECTIONS,
      transportId: root.execution.transportId, mode: root.execution.mode,
      budgetPath: join(directory, "budget.json"), originalLimitCny: root.execution.budgetCny, pricingId: root.execution.pricingId,
      ...(parent ? { parentFingerprint: parent.parentFingerprint, outputRecovery, reserveCny, timeoutMs } : {}) };
  const traces = new Map(checked.report.traces.filter(t => t.phase === "leaf").map(t => [t.categoryId, t]));
  const transcripts = new Map<string, Awaited<ReturnType<typeof durable>>[]>();
  for (const target of targets) {
    if (parent) { transcripts.set(target.categoryId, parent.transcripts.get(target.categoryId)!); continue; }
    const keys = traces.get(target.categoryId)?.originalRequestKeys ?? [];
    transcripts.set(target.categoryId, await Promise.all(keys.map((key: string) => durable(directory, key))));
  }
  const record = { ...identity, id: hash(identity) };
  // Read-only previews may be refreshed after another host fix. Once execution
  // starts (marker written before transport), a different host/input is refused.
  if (await exists(join(outDir, "resume.execution.json"))) {
    await frozen(join(outDir, "resume.execution.json"), record);
    await frozen(join(outDir, "resume.identity.json"), record);
  } else await save(join(outDir, "resume.identity.json"), record);
  return { directory, sourceDir: effectiveSourceDir, outDir, checked, source, originalResults, targets, snapshot,
    wireRelease, provenance, transcripts, identity, root, outputRecovery, reserveCny, timeoutMs };
}

// Caller holds the accounting root lock. No provider, ledger mutation or export
// is needed to prove the exact restart boundary for all stopped leaves.
async function previewUnlocked(options: ResumeOptions, release: Release) {
  const state = await inspect(options, release), leaves = [];
  for (const job of state.targets) {
    const transcript = state.transcripts.get(job.categoryId)!, replay = verifiedReplayClient({ client: null,
      mode: state.root.execution.mode, transportId: state.root.execution.transportId, transcript });
    let code: string | null = null, error: string | null = null;
    try {
      await runStage({ release: state.wireRelease, snapshot: state.snapshot,
        task: batchTask(state.source, job.categoryId, "leaf"), client: replay.client,
        outDir: join(state.outDir, "offline-replay"), model: state.source.model,
        limits: state.source.limits, corrections: BATCH_CORRECTIONS, hostResume: state.provenance, outputRecovery: state.outputRecovery });
    } catch (e) {
      if (!(e instanceof Blocked) || e.code !== "resume_ready") {
        code = e instanceof Blocked ? e.code : "stage_error"; error = String(e);
      }
    }
    if (replay.consumed() !== transcript.length) { code = "resume_transcript_drift"; error = "historical requests were not fully consumed"; }
    leaves.push({ categoryId: job.categoryId, category: state.snapshot.tree.get(job.categoryId).name,
      originalCode: job.code, paidRequestsReplayed: replay.consumed(),
      maximumNewRequests: state.source.limits.maxRounds - transcript.length, code, error });
  }
  const reserved = Number(state.root.ledger.entries.reduce((s: number, e: { reservedCny: number }) => s + e.reservedCny, 0).toFixed(2)),
    limit = effectiveBudgetLimit(state.root.ledger), maximumNewRequests = leaves.reduce((s, l) => s + l.maximumNewRequests, 0),
    preserved = state.originalResults.leaves.filter((j: BatchJob) => !state.targets.some(t => t.categoryId === j.categoryId)),
    preview = { mode: "exact_transcript_resume_preview", ready: leaves.every(l => !l.code), outDir: state.outDir,
      originalDirectory: state.directory, sourceDirectory: state.sourceDir, model: state.source.model,
      concurrency: options.concurrency, targets: leaves, preservedLeaves: preserved.map((j: BatchJob) => ({
        categoryId: j.categoryId, category: state.snapshot.tree.get(j.categoryId).name, status: j.status,
        readiness: proposalReadiness(j) })),
      reusedBaselines: state.source.groups.map(g => ({ id: g.id, version: state.snapshot.data.families.find(f => f.id === g.id)?.version,
        status: state.snapshot.data.families.find(f => f.id === g.id)?.status })),
      familySeedsToRun: [], familyCoverage: familyCoverage(state.source, state.snapshot),
      paidRequestsReplayedOffline: leaves.reduce((s, l) => s + l.paidRequestsReplayed, 0), maximumNewRequests,
      maxOutputTokens: state.outputRecovery?.maxOutputTokens ?? state.source.limits.maxOutputTokens,
      requestReserveCny: state.reserveCny, timeoutMs: state.timeoutMs,
      maximumAdditionalReservationCny: Number((maximumNewRequests * (state.root.execution.mode === "network" ? state.reserveCny : 0)).toFixed(2)),
      cumulativeReservedCny: reserved, budgetLimitCny: limit, remainingReservationCny: Number((limit - reserved).toFixed(2)),
      budgetMeaning: "本地累计保守预留，不是DeepSeek账号余额或实际账单", newModelRequests: 0,
      sourceArtifactsModified: false, productionWrites: 0, adoption: "pending_human",
      next: "同命令加--execute只恢复失败末级；原付费响应重放，6轮/2次纠错额度不重置，所有类目保留在汇总中" };
  await save(join(state.outDir, "resume.plan.json"), preview);
  return { state, preview };
}
export async function prepareResume(options: ResumeOptions, release: Release) {
  return lock(join(resolve(options.directory), "execution.lock"), async () => (await previewUnlocked(options, release)).preview);
}

export async function executeResume(options: ResumeOptions, release: Release, client: ResponsesClient,
  progress: (event: Record<string, unknown>) => void = () => {}) {
  return lock(join(resolve(options.directory), "execution.lock"), async () => {
    const { state, preview } = await previewUnlocked(options, release), { source, snapshot, targets, originalResults } = state;
    if (!preview.ready) throw new Blocked("resume_preflight", "offline transcript replay failed; no new request sent");
    if (resolve(client.dir) !== state.directory || client.mode !== state.root.execution.mode ||
        client.transportId !== state.root.execution.transportId || client.budget.path !== join(state.directory, "budget.json") ||
        client.budget.limitCny !== state.root.execution.budgetCny || client.budget.pricingId !== state.root.execution.pricingId ||
        (client.mode === "network" && (client.reserveCny !== state.reserveCny || client.timeoutMs !== state.timeoutMs)))
      throw new Blocked("resume_identity_drift", "resume must retain the original transport and cumulative ledger");
    await frozen(join(state.outDir, "resume.execution.json"), { ...state.identity, id: hash(state.identity) });
    const start = client.calls, cached = client.cacheHits;
    let stop: string | null = null;
    const resumed = await mapConcurrent(targets, options.concurrency, async target => {
      const category = snapshot.tree.get(target.categoryId).name;
      let job: BatchJob;
      try {
        if (stop) throw new Blocked("batch_stopped", stop);
        progress({ event: "started", phase: "leaf", categoryId: target.categoryId, category });
        const replay = verifiedReplayClient({ client, mode: client.mode, transportId: client.transportId,
          transcript: state.transcripts.get(target.categoryId)! });
        const artifact = await runStage({ release: state.wireRelease, snapshot, task: batchTask(source, target.categoryId, "leaf"),
          client: replay.client, outDir: state.outDir, model: source.model, limits: source.limits,
          corrections: BATCH_CORRECTIONS, hostResume: state.provenance, outputRecovery: state.outputRecovery,
          onProgress: e => progress({ ...e, phase: "leaf", categoryId: target.categoryId, category }) });
        job = { ...target, artifact, status: artifact.checks.status,
          code: artifact.checks.errors.length ? "program_checks" : null,
          error: artifact.checks.errors.length ? artifact.checks.errors.map(e => e.ruleId + ":" + e.message).join("; ") : null };
      } catch (e) {
        job = { ...target, artifact: null, status: "program_blocked", code: e instanceof Blocked ? e.code : "stage_error", error: String(e) };
        if (["budget_exhausted", "http_error", "outcome_unknown"].includes(job.code!)) stop = job.error;
      }
      await save(join(state.outDir, "jobs", "leaf-" + target.categoryId + ".json"), job);
      progress({ event: "finished", phase: "leaf", categoryId: target.categoryId, category, status: job.status,
        code: job.code, proposalReadiness: proposalReadiness(job) });
      return job;
    });
    const leaves: BatchJob[] = originalResults.leaves.map((j: BatchJob) => resumed.find(r => r.categoryId === j.categoryId) ?? j),
      budget = await client.budget.status(), result = { format: 1, outDir: state.outDir,
        sourceDirectory: state.sourceDir, sourceBatchId: source.id, sourceFingerprint: state.checked.sourceFingerprint,
        hostReleaseId: release.id, businessReleaseId: source.releaseId, mode: client.mode, model: source.model,
        passed: leaves.filter(j => j.status === "program_pass_pending_human").length,
        blocked: leaves.filter(j => j.status === "program_blocked").length, total: leaves.length, ...proposalCounts(leaves),
        familySeeds: originalResults.familySeeds, leaves, resumedCategoryIds: targets.map(j => j.categoryId),
        networkCallsThisExecution: client.mode === "network" ? client.calls - start : 0,
        mockCallsThisExecution: client.mode === "offline" ? client.calls - start : 0,
        cacheHitsThisExecution: client.cacheHits - cached, budget,
        adoption: "pending_human", productionWrites: 0, sourceArtifactsModified: false };
    await save(join(state.outDir, "resume.results.json"), result);
    await save(join(state.outDir, "batch.review.json"), { ...buildBatchReview(source, leaves, snapshot, client.mode),
      recovery: { kind: "exact_transcript_resume", sourceDirectory: state.sourceDir, hostReleaseId: release.id,
        preservedLeaves: originalResults.leaves.length - targets.length, newModelRequests: client.calls - start } });
    return { outDir: state.outDir, sourceDirectory: state.sourceDir, model: source.model, passed: result.passed,
      blocked: result.blocked, total: result.total, proposalsPendingHuman: result.proposalsPendingHuman,
      noAdmittedAttributes: result.noAdmittedAttributes, requests: result.networkCallsThisExecution,
      cacheHits: result.cacheHitsThisExecution, cumulativeReservedCny: Number(budget.committedUpperBoundCny.toFixed(2)),
      budgetLimitCny: budget.limitCny, accounting: budget.accounting, adoption: "pending_human", productionWrites: 0 };
  });
}
