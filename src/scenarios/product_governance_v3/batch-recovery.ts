import { effectiveBudgetLimit } from "./budget.ts";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { read, save, exists, hash, lock, jsonClone, Blocked, type Task } from "./core.ts";
import { instructionsFor, type Release } from "./release.ts";
import { outputSchemas } from "./contracts.ts";
import { DataSnapshot } from "./snapshot.ts";
import { ToolRegistry } from "./tools.ts";
import { checkResult } from "./checks.ts";
import { projectNative } from "./native-contract.ts";
import { parseResultJson, responseText } from "./result-json.ts";
import { batchTask, buildBatchReview, pendingFamily, type BatchPlan, type BatchJob } from "./batch.ts";
import { proposalReadiness, proposalCounts } from "./proposal-readiness.ts";
import { runStage, BATCH_CORRECTIONS } from "./runner.ts";
import type { ResponsesClient } from "./responses.ts";
import { modelConfigurationReview } from "./scripts/configuration-review.mjs";
import { matchesContextLayout } from "./request-layout.ts";

// A historical response may be checked under a newer host only if the actual business
// materials, schema, validator and read tools are unchanged. This is not a release-ID bypass.
const HOST_FILES = new Set(["runner.ts", "cli.ts", "batch.ts", "responses.ts", "batch-export.ts",
  "result-json.ts", "progress.ts", "batch-recovery.ts", "scripts/export-batch-review.mjs"]);
function compatible(manifest: any, release: Release, task: Task) {
  if (manifest.outputSchemaHash !== hash(outputSchemas[task.stage]))
    throw new Blocked("recovery_contract_drift", "historical output schema changed; manual migration required");
  for (const [path, sha] of Object.entries(manifest.engineFiles ?? {}))
    if (!HOST_FILES.has(path) && release.files[path] !== sha)
      throw new Blocked("recovery_contract_drift", "historical business/check/read material changed: " + path);
  if (!manifest.engineFiles?.["checks.ts"] || !manifest.engineFiles?.["tools.ts"])
    throw new Blocked("recovery_contract_drift", "historical checker/read fingerprints missing");
}
async function durable(dir: string, key: string) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw Error("invalid historical request key");
  const base = join(dir, "requests", key), request = await read(base + ".request.json"),
    { key: storedKey, ...requestIdentity } = request;
  if (storedKey !== key || hash(requestIdentity) !== key)
    throw new Blocked("cache_corrupt", "historical request integrity mismatch: " + key);
  if (!await exists(base + ".response.json"))
    throw new Blocked("outcome_unknown", "historical request has no durable response; never resend automatically: " + key);
  const record = await read(base + ".response.json"), receipt = await read(base + ".receipt.json");
  if (record.key !== key || hash(record.response) !== record.sha256 || record.response.status !== "completed" ||
      receipt.key !== key || receipt.status !== "completed" || receipt.responseHash !== record.sha256)
    throw new Blocked("cache_corrupt", "historical response/receipt integrity mismatch: " + key);
  return { request, response: record.response, responseHash: record.sha256 };
}

export async function recheckBatch(dir: string, release: Release) {
  dir = resolve(dir);
  // Uses the same lock as paid execution; never takes a partial view of an in-flight batch.
  return lock(join(dir, "execution.lock"), () => recheckUnlocked(dir, release));
}
async function recheckUnlocked(dir: string, release: Release) {
  const original = await read(join(dir, "batch.identity.json")), { id, ...identity } = original;
  if (original.format !== 1 || id !== hash(identity) || hash(original.snapshot) !== original.inputVersion)
    throw new Blocked("cache_corrupt", "historical batch input integrity mismatch");
  const originalResults = await read(join(dir, "batch.results.json")),
    sharedRecord = await read(join(dir, "batch.shared-snapshot.json")),
    execution = await read(join(dir, "execution.identity.json")),
    budgetBefore = await read(join(dir, "budget.json"));
  if (originalResults.batchId !== id || sharedRecord.batchId !== id || execution.batchId !== id ||
      sharedRecord.version !== hash(sharedRecord.snapshot) || originalResults.sharedSnapshotVersion !== sharedRecord.version ||
      originalResults.releaseId !== original.releaseId || originalResults.mode !== execution.mode ||
      budgetBefore.limitCny !== execution.budgetCny || budgetBefore.pricingId !== execution.pricingId)
    throw new Blocked("cache_corrupt", "historical batch/snapshot/execution/budget identities disagree");
  const originalBudget = originalResults.budget;
  for (const entry of originalBudget.entries) {
    const current = budgetBefore.entries.find((e: any) => e.id === entry.id);
    if (!current || current.reservedCny !== entry.reservedCny)
      throw new Blocked("budget_change", "historical reservations missing or changed");
  }
  const shared = new DataSnapshot(sharedRecord.snapshot), input = new DataSnapshot(original.snapshot),
    jobs: BatchJob[] = [], seeds: BatchJob[] = [], traces: any[] = [], records = new Map<string, any>();
  for (const file of (await readdir(join(dir, "runs"))).filter((f) => /\.(blocked|result)\.json$/.test(f))) {
    const run = await read(join(dir, "runs", file));
    if (run.releaseId !== original.releaseId || !run.requestKeys?.length) continue;
    const first = await durable(dir, run.requestKeys[0]), task = JSON.parse(first.request.body.input[0].content).task;
    if (task.runId !== original.runId || task.candidate?.kind !== "batch_modeling_scope") continue;
    const mapKey = task.candidate.phase + ":" + task.categoryId;
    // A current runner can save both a checked result and a later block. Refuse ambiguous histories.
    if (records.has(mapKey)) throw new Blocked("recovery_ambiguous", "multiple original runs for " + mapKey);
    records.set(mapKey, { run, task });
  }
  const allOriginalJobs = [...originalResults.familySeeds, ...originalResults.leaves];
  if (originalResults.leaves.length !== original.categoryIds.length ||
      new Set(originalResults.leaves.map((j: BatchJob) => j.categoryId)).size !== original.categoryIds.length ||
      original.categoryIds.some((categoryId: string) => !originalResults.leaves.some((j: BatchJob) => j.categoryId === categoryId)))
    throw new Blocked("cache_corrupt", "historical leaf coverage differs from frozen input");
  for (const job of allOriginalJobs as BatchJob[]) {
    const target = job.phase === "leaf" ? jobs : seeds,
      record = records.get(job.phase + ":" + job.categoryId);
    if (!record) {
      if (job.code !== "family_dependency" && job.code !== "batch_stopped")
        throw new Blocked("recovery_incomplete", "missing original run for " + job.categoryId);
      target.push(jsonClone(job));
      traces.push({ phase: job.phase, categoryId: job.categoryId, originalCode: job.code,
        status: job.status, originalRequestKeys: [], normalization: null, retry: "wait_for_family_seed" });
      continue;
    }
    const { run, task } = record, snapshot = job.phase === "leaf" ? shared : input,
      manifest = await read(join(dir, "runs", run.runKey + ".manifest.json"));
    if (manifest.runKey !== run.runKey || manifest.releaseId !== original.releaseId || manifest.snapshotVersion !== snapshot.version)
      throw new Blocked("cache_corrupt", "historical manifest identity mismatch");
    compatible(manifest, release, task);
    const historicalInstructions = instructionsFor({ ...release, id: original.releaseId }, task.stage);
    if (manifest.instructionsHash !== hash(historicalInstructions))
      throw new Blocked("recovery_contract_drift", "historical instruction/material fingerprint mismatch");
    const responses = [];
    for (const key of run.requestKeys) {
      const response = await durable(dir, key);
      if (response.request.identity.releaseId !== original.releaseId ||
          response.request.identity.snapshotVersion !== snapshot.version ||
          response.request.transportId !== execution.transportId || response.request.mode !== execution.mode ||
          hash(JSON.parse(response.request.body.input[0].content).task) !== hash(task) ||
          hash(JSON.parse(response.request.body.input[0].content)) !== manifest.inputHash ||
          !matchesContextLayout(response.request.body.input[0].content, manifest.requestLayout) ||
          typeof response.request.body.instructions !== "string" ||
          !response.request.body.instructions.startsWith(historicalInstructions))
        throw new Blocked("cache_corrupt", "historical response/task/context identity mismatch");
      responses.push(response);
    }
    const tools = new ToolRegistry(snapshot, release, task);
    for (const event of run.toolEvents) {
      if (hash(event.result) !== event.resultHash ||
          hash(await tools.call(event.name, event.arguments, event.origin)) !== event.resultHash)
        throw new Blocked("recovery_read_drift", "historical tool read changed: " + event.name);
    }
    let recovered: BatchJob = { ...jsonClone(job), artifact: null }, normalization: unknown = null;
    const last = responses.at(-1)!;
    if (job.artifact || run.code === "final_json" || run.code === "final_output") try {
      const parsed = parseResultJson(responseText(last.response.output)), { result, ...parsing } = parsed,
        checks = checkResult(task, result, tools);
      if (job.artifact && hash(job.artifact.result) !== hash(result))
        throw new Blocked("cache_corrupt", "stored job result differs from durable model output");
      normalization = parsing;
      const modeled = result as any;
      const artifact = {
        runKey: hash({ historicalRunKey: run.runKey, responseHash: last.responseHash, checkerRelease: release.id }),
        mode: execution.mode, snapshotKind: snapshot.data.kind, releaseId: original.releaseId,
        manifest, requestKeys: run.requestKeys, toolCount: run.toolCount, result, checks,
        configurationReview: checks.executedChecks.includes("configuration-explanations") ? modelConfigurationReview(result) : null,
        outputParsing: parsing, feedback: [], factPreparation: null,
        nativeProjections: checks.errors.length ? [] : modeled.attributes.map((a: any) =>
          projectNative(a, modeled.bindings.find((b: any) => b.attributeId === a.id))),
        toolEvents: tools.events, actualReads: {
          knowledge: [...tools.knowledgeReads].map(([id, ranges]) => ({ id, version: release.knowledge[id]!.sha256, ranges })),
          sources: [], calculationPolicies: [], toolHistoryHash: hash(tools.events),
        },
        adoption: checks.errors.length ? "not_eligible" : "pending_human", productionWrites: 0, businessRepairs: 0,
        recheck: { checkerRelease: release.id, originalRunKey: run.runKey, responseHash: last.responseHash, newModelRequests: 0 },
      };
      recovered = { ...recovered, status: checks.status,
        code: checks.errors.length ? "program_checks" : null,
        error: checks.errors.length ? checks.errors.map((e) => e.ruleId + ":" + e.message).join("; ") : null,
        artifact };
    } catch (error) {
      if (!(error instanceof Blocked) || !["final_json", "final_output"].includes(error.code)) throw error;
      recovered = { ...recovered, status: "program_blocked", code: error.code, error: String(error) };
    }
    target.push(recovered);
    traces.push({ phase: job.phase, categoryId: job.categoryId, originalCode: job.code,
      status: recovered.status, code: recovered.code, normalization,
      originalRunKey: run.runKey, originalRequestKeys: run.requestKeys,
      originalManifestHash: hash(manifest),
      responseHashes: responses.map((r) => r.responseHash), toolHistoryHash: hash(tools.events),
      retry: recovered.status === "program_blocked" ? "explicit_targeted_correction" : "reuse_without_new_request" });
  }
  const sourceFingerprint = hash({ identity: original, results: originalResults, shared: sharedRecord,
      histories: traces.map((t) => ({ runKey: t.originalRunKey ?? null, manifestHash: t.originalManifestHash ?? null,
        responseHashes: t.responseHashes ?? [], toolHistoryHash: t.toolHistoryHash ?? null })) }),
    recoveryId = hash({ sourceFingerprint, checkerRelease: release.id, budgetHash: hash(budgetBefore) }),
    outDir = join(dir, "recoveries", recoveryId.slice(0, 20)),
    plan = { ...original, releaseId: release.id, outDir, concurrency: 1, preflight: [] } as BatchPlan;
  // A later single-leaf correction must not make previously corrected leaves disappear from
  // the next review workbook. Reuse only current-release, independently revalidated receipts.
  const historicalJobs = jsonClone(jobs), historicalSeeds = jsonClone(seeds);
  const reusedCorrections: { categoryId: string; category: string }[] = [];
  const mergedShared = jsonClone(shared.data);
  let correctionDirs: string[] = [];
  try { correctionDirs = await readdir(join(dir, "corrections")); }
  catch (error: any) { if (error.code !== "ENOENT") throw error; }
  for (const folder of correctionDirs.filter((s) => /^[a-f0-9]{20}$/.test(s)).sort()) {
    const path = join(dir, "corrections", folder), resultPath = join(path, "correction.results.json");
    if (!await exists(resultPath)) continue; // Interrupted requests remain in the cumulative ledger; no reuse or resend.
    const saved = await read(resultPath);
    if (saved.releaseId !== release.id || saved.originalBatchId !== id || saved.sourceFingerprint !== sourceFingerprint) continue;
    const savedSnapshot = new DataSnapshot(await read(join(path, "correction.snapshot.json")));
    const validateJob = async (job: BatchJob, snapshot: DataSnapshot) => {
      if (job.status !== "program_pass_pending_human" || !job.artifact) return false;
      const artifact = job.artifact, events = artifact.toolEvents;
      if (artifact.releaseId !== release.id || artifact.manifest.snapshotVersion !== snapshot.version ||
          hash(artifact.manifest.engineFiles) !== hash(release.files) || !artifact.requestKeys.length)
        throw new Blocked("cache_corrupt", "saved correction identity changed");
      const first = await durable(dir, artifact.requestKeys[0]!),
        task = JSON.parse(first.request.body.input[0].content).task as Task;
      if (task.categoryId !== job.categoryId || task.runId !== original.runId ||
          (task.candidate as any)?.phase !== job.phase || first.request.identity.releaseId !== release.id ||
          hash(JSON.parse(first.request.body.input[0].content)) !== artifact.manifest.inputHash ||
          !matchesContextLayout(first.request.body.input[0].content, artifact.manifest.requestLayout) ||
          artifact.manifest.instructionsHash !== hash(instructionsFor(release, task.stage)))
        throw new Blocked("cache_corrupt", "saved correction task/manifest changed");
      let last: Awaited<ReturnType<typeof durable>> | null = null;
      for (const key of artifact.requestKeys) {
        last = await durable(dir, key);
        if (last.request.identity.releaseId !== release.id || last.request.identity.snapshotVersion !== snapshot.version ||
            last.request.transportId !== execution.transportId || last.request.mode !== execution.mode ||
            hash(JSON.parse(last.request.body.input[0].content)) !== artifact.manifest.inputHash ||
            !matchesContextLayout(last.request.body.input[0].content, artifact.manifest.requestLayout) ||
            typeof last.request.body.instructions !== "string" ||
            !last.request.body.instructions.startsWith(instructionsFor(release, task.stage)))
          throw new Blocked("cache_corrupt", "saved correction request context changed");
      }
      if (hash(parseResultJson(responseText(last!.response.output)).result) !== hash(artifact.result))
        throw new Blocked("cache_corrupt", "saved correction differs from durable model output");
      const tools = new ToolRegistry(snapshot, release, task);
      for (const event of events)
        if (hash(event.result) !== event.resultHash ||
            hash(await tools.call(event.name, event.arguments, event.origin)) !== event.resultHash)
          throw new Blocked("recovery_read_drift", "saved correction read changed");
      const checks = checkResult(task, artifact.result, tools);
      if (checks.errors.length) throw new Blocked("recovery_contract_drift", "saved correction no longer passes");
      artifact.checks = checks;
      return true;
    };
    const group = original.groups.find((g: BatchPlan["groups"][number]) => g.members.includes(saved.selectedCategoryId));
    const seedOK = saved.seed && await validateJob(saved.seed, input);
    if (seedOK && group?.needsSeed) {
      const index = seeds.findIndex((j) => j.familyId === group.id);
      if (index >= 0) seeds[index] = saved.seed;
      mergedShared.families = mergedShared.families.filter((f) => f.id !== group.id);
      mergedShared.families.push(pendingFamily(group, saved.seed.artifact, original.runId));
    }
    const index = jobs.findIndex((j) => j.categoryId === saved.selectedCategoryId);
    if (index < 0 || saved.leaf.categoryId !== saved.selectedCategoryId || saved.leaf.phase !== "leaf")
      throw new Blocked("cache_corrupt", "saved correction has an unknown target");
    if (await validateJob(saved.leaf, savedSnapshot)) {
      jobs[index] = saved.leaf;
      reusedCorrections.push({ categoryId: saved.selectedCategoryId, category: shared.tree.get(saved.selectedCategoryId).name });
    } else if (saved.leaf.status === "program_blocked") jobs[index] = saved.leaf;
    if (saved.seed?.status === "program_blocked") {
      const seedIndex = seeds.findIndex((j) => j.categoryId === saved.seed.categoryId && j.phase === saved.seed.phase);
      if (seedIndex >= 0) seeds[seedIndex] = saved.seed;
    }
  }
  const pending = [...seeds, ...jobs].filter((j) => j.status === "program_blocked").map((job) => ({
    phase: job.phase, categoryId: job.categoryId, category: shared.tree.get(job.categoryId).name,
    familyId: job.familyId, code: job.code, errors: job.error,
    dependsOn: job.phase === "leaf" && job.code === "family_dependency" ? job.familyId : null,
  }));
  const report = {
    format: 1, recoveryId, sourceFingerprint, originalDirectory: dir, originalBatchId: id,
    originalReleaseId: original.releaseId, checkerReleaseId: release.id, outDir,
    mode: "offline_recheck", responseOrigin: execution.mode, total: jobs.length,
    originallyPassed: originalResults.passed,
    passed: jobs.filter((j) => j.status === "program_pass_pending_human").length,
    ...proposalCounts(jobs),
    blocked: jobs.filter((j) => j.status === "program_blocked").length,
    additionalPassed: jobs.filter((j) => j.status === "program_pass_pending_human" &&
      !originalResults.leaves.some((old: BatchJob) => old.categoryId === j.categoryId && old.status === "program_pass_pending_human"))
      .map((j) => ({ categoryId: j.categoryId, category: shared.tree.get(j.categoryId).name })),
    emptyProposals: jobs.filter((j) => j.status === "program_pass_pending_human" && !(j.artifact!.result as any).attributes.length)
      .map((j) => ({ categoryId: j.categoryId, category: shared.tree.get(j.categoryId).name, note: "程序通过但无已建模属性，须人工决定是否需补研究" })),
    pending, traces, reusedCorrections,
    cumulativeReservedCny: Number(budgetBefore.entries.reduce((sum: number, e: any) => sum + e.reservedCny, 0).toFixed(2)),
    budgetLimitCny: effectiveBudgetLimit(budgetBefore), accounting: "保守累计预留，不是实际账单",
    newModelRequests: 0, originalArtifactsModified: false, businessRepairs: 0, productionWrites: 0,
    adoption: "pending_human",
  };
  if (hash(await read(join(dir, "budget.json"))) !== hash(budgetBefore))
    throw new Blocked("budget_change", "budget changed during offline recheck");
  await save(join(outDir, "recheck.report.json"), report);
  await save(join(outDir, "recheck.results.json"), { recoveryId, familySeeds: seeds, leaves: jobs });
  await save(join(outDir, "pending-corrections.json"), { recoveryId, order: "family-seed first, then dependent leaves; independent leaves may run separately", pending });
  await save(join(outDir, "batch.review.json"), { ...buildBatchReview(plan, jobs, shared, execution.mode),
    recovery: { kind: "offline_recheck", newModelRequests: 0, reusedCorrections: reusedCorrections.length } });
  return { report, original, execution, shared: mergedShared, jobs, seeds, historicalJobs, historicalSeeds, sourceFingerprint };
}

// Paid continuation is deliberately limited to one explicitly selected failed leaf (and its
// prerequisite seed). Successful categories are never regenerated. The original ledger and
// response directory remain authoritative across this host revision.
export async function correctBatchLeaf(dir: string, release: Release, categoryId: string,
  client: ResponsesClient, progress: (event: Record<string, unknown>) => void = () => {}) {
  dir = resolve(dir);
  if (resolve(client.dir) !== dir || resolve(client.budget.path) !== join(dir, "budget.json"))
    throw Error("recovery must share the original request directory and cumulative budget");
  return lock(join(dir, "execution.lock"), async () => {
    const recheck = await recheckUnlocked(dir, release), { original, execution, report } = recheck,
      reviewedJob = recheck.jobs.find((j) => j.categoryId === categoryId);
    if (!reviewedJob) throw Error("--category-id must select one original leaf, not an ancestor or new category");
    if (client.mode !== execution.mode || client.transportId !== execution.transportId ||
        client.budget.limitCny !== execution.budgetCny || client.budget.pricingId !== execution.pricingId ||
        (client.mode === "network" && client.reserveCny !== original.reserveCny))
      throw new Blocked("recovery_identity_drift", "recovery transport/budget differs from historical execution");
    if (reviewedJob.status === "program_pass_pending_human")
      return { outDir: report.outDir, skipped: "already_program_pass_pending_human", passed: 1, blocked: 0, newModelRequests: 0, productionWrites: 0 };
    // A repeated --execute must replay the SAME correction transcript, even if that correction
    // failed. Feeding its latest error back as a new initial task would silently buy another loop.
    const job = recheck.historicalJobs.find((j) => j.categoryId === categoryId)!;
    const correctionId = hash({ sourceFingerprint: recheck.sourceFingerprint, releaseId: release.id, categoryId,
      model: original.model, limits: original.limits, corrections: BATCH_CORRECTIONS }),
      outDir = join(dir, "corrections", correctionId.slice(0, 20)),
      plan = { ...original, releaseId: release.id, outDir, concurrency: 1, preflight: [] } as BatchPlan,
      inputPath = join(outDir, "correction.input-snapshot.json"),
      shared = await exists(inputPath) ? await read(inputPath) : jsonClone(recheck.shared),
      callsBefore = client.calls, cacheBefore = client.cacheHits;
    const correctionIdentity = {
      correctionId, originalBatchId: original.id, originalReleaseId: original.releaseId, releaseId: release.id,
      sourceFingerprint: recheck.sourceFingerprint, categoryId, model: original.model, limits: original.limits,
      corrections: BATCH_CORRECTIONS, transportId: execution.transportId,
      budgetPath: client.budget.path, budgetLimitCny: client.budget.limitCny, pricingId: client.budget.pricingId,
      reserveCny: client.reserveCny, inputSnapshotVersion: hash(shared),
    }, identityPath = join(outDir, "correction.identity.json");
    if (await exists(identityPath)) {
      if (hash(await read(identityPath)) !== hash(correctionIdentity))
        throw new Blocked("recovery_identity_drift", "correction input/configuration changed; no implicit new paid loop");
    } else await save(identityPath, correctionIdentity);
    if (!await exists(inputPath)) await save(inputPath, shared);
    const perform = async (target: BatchJob, snapshot: DataSnapshot): Promise<BatchJob> => {
      const task = batchTask(plan, target.categoryId, target.phase);
      task.candidate = { ...(task.candidate as object), recovery: {
        originalBatchId: original.id, originalCode: target.code, originalErrors: target.error,
        rejectedProposal: target.artifact?.result ?? null,
        meaning: "这是待纠正提案资料，不是事实或已采用标准。逐项按当前完整合同纠正，不得靠删规则/造引文过检。",
      } };
      const name = snapshot.tree.get(target.categoryId).name;
      progress({ event: "started", phase: target.phase, categoryId: target.categoryId, category: name });
      let next: BatchJob;
      try {
        const artifact = await runStage({ release, snapshot, task, client, outDir,
          model: original.model, limits: original.limits, corrections: BATCH_CORRECTIONS,
          onProgress: (event) => progress({ ...event, phase: target.phase, categoryId: target.categoryId, category: name }) });
        next = { ...target, artifact, status: artifact.checks.status,
          code: artifact.checks.errors.length ? "program_checks" : null,
          error: artifact.checks.errors.length ? artifact.checks.errors.map((e) => e.ruleId + ":" + e.message).join("; ") : null };
      } catch (error) {
        next = { ...target, artifact: null, status: "program_blocked",
          code: error instanceof Blocked ? error.code : "stage_error", error: String(error) };
      }
      await save(join(outDir, "jobs", target.phase + "-" + target.categoryId + ".json"), next);
      progress({ event: "finished", phase: target.phase, categoryId: target.categoryId, category: name, status: next.status, code: next.code, proposalReadiness: proposalReadiness(next) });
      return next;
    };
    const group = plan.groups.find((g) => g.members.includes(categoryId));
    let seed: BatchJob | null = null, corrected: BatchJob;
    if (group?.needsSeed) {
      const reviewedSeed = recheck.seeds.find((j) => j.familyId === group.id)!,
        oldSeed = reviewedSeed.status === "program_pass_pending_human" ? reviewedSeed :
          recheck.historicalSeeds.find((j) => j.familyId === group.id)!;
      seed = oldSeed.status === "program_pass_pending_human" ? oldSeed : await perform(oldSeed, new DataSnapshot(original.snapshot));
      if (seed.status !== "program_pass_pending_human" || !(seed.artifact?.result as any)?.attributes.length) {
        corrected = { ...job, artifact: null, status: "program_blocked", code: "family_dependency",
          error: seed.error ?? "共同定义为空，需要人工核实后继续" };
      } else {
        shared.families = shared.families.filter((f: { id: string }) => f.id !== group.id);
        shared.families.push(pendingFamily(group, seed.artifact!, original.runId));
        corrected = await perform(job, new DataSnapshot(shared));
      }
    } else corrected = await perform(job, new DataSnapshot(shared));
    const jobs = recheck.jobs.map((j) => j.categoryId === categoryId ? corrected : j),
      snapshot = new DataSnapshot(shared), budget = await client.budget.status();
    await save(join(outDir, "correction.snapshot.json"), snapshot.data);
    await save(join(outDir, "batch.review.json"), { ...buildBatchReview(plan, jobs, snapshot, execution.mode),
      recovery: { kind: "targeted_model_correction", newModelRequests: client.calls - callsBefore, categoryId } });
    const result = { correctionId, outDir, originalDirectory: dir, originalBatchId: original.id,
      sourceFingerprint: recheck.sourceFingerprint,
      releaseId: release.id, selectedCategoryId: categoryId,
      passed: corrected.status === "program_pass_pending_human" ? 1 : 0,
      ...proposalCounts([corrected]),
      blocked: corrected.status === "program_blocked" ? 1 : 0,
      newModelRequests: client.calls - callsBefore, cacheHits: client.cacheHits - cacheBefore,
      cumulativeReservedCny: Number(budget.committedUpperBoundCny.toFixed(2)),
      budgetLimitCny: budget.limitCny, accounting: budget.accounting,
      originalArtifactsModified: false, adoption: "pending_human", productionWrites: 0, seed, leaf: corrected };
    await save(join(outDir, "correction.results.json"), result);
    return { ...result, seed: seed ? { status: seed.status, code: seed.code } : null,
      leaf: { status: corrected.status, code: corrected.code } };
  });
}
