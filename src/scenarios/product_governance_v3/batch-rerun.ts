import { effectiveBudgetLimit } from "./budget.ts";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { read, save, exists, hash, lock, jsonClone, Blocked } from "./core.ts";
import type { Release } from "./release.ts";
import { DataSnapshot } from "./snapshot.ts";
import { assemble } from "./context.ts";
import { batchTask, validateBatchOptions, type BatchPlan } from "./batch.ts";
import type { ModelOptions } from "./runner.ts";
import { MODELING_PROPOSAL_VERSION } from "./modeling-proposal.ts";
import { attachPilotKnowledge } from "./pilot-knowledge.ts";

export interface RerunOptions {
  directory: string;
  roundName: string;
  categoryId?: string;
  categoryIds?: string[];
  reasoningEffort?: ModelOptions["reasoningEffort"];
  concurrency: number;
}

export function parseReasoningEffort(value?: string): ModelOptions["reasoningEffort"] | undefined {
  if (value === undefined) return undefined;
  if (!["none", "low", "high", "max"].includes(value))
    throw Error("--reasoning-effort须为none、low、high或max；none关闭思考，省略沿用原批次档位");
  return value as ModelOptions["reasoningEffort"];
}

async function frozen(path: string, value: unknown) {
  if (await exists(path)) {
    if (hash(await read(path)) !== hash(value))
      throw new Blocked("rerun_identity_drift", "this named round already has different frozen rules/inputs; repeating its command cannot buy a different round: " + path);
  } else await save(path, value);
}

// An explicit new round ignores old proposals, not the old paid-request ledger.
// It preserves the source tree, field inventory and reviewed family input, then runs
// every selected leaf and required common-family generation with today's full release.
export async function prepareRerun(options: RerunOptions, release: Release) {
  const directory = resolve(options.directory);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(options.roundName))
    throw Error("--round须为1—64位字母、数字、下划线或连字符，首位须为字母或数字；重复执行保持同名");
  const reasoningEffort = parseReasoningEffort(options.reasoningEffort);
  if (options.categoryIds !== undefined && options.categoryId !== undefined)
    throw Error("--category-ids与--category-id互斥；前者只选择列出的末级，后者展开子树");
  if (options.categoryIds !== undefined && (!Array.isArray(options.categoryIds) || !options.categoryIds.length ||
      options.categoryIds.some((id) => typeof id !== "string" || !id.trim()) ||
      new Set(options.categoryIds).size !== options.categoryIds.length))
    throw new Blocked("rerun_scope", "--category-ids须为非空、无重复的末级ID列表");
  return lock(join(directory, "execution.lock"), async () => {
    for (const name of ["batch.identity.json", "execution.identity.json", "budget.json"])
      if (!await exists(join(directory, name))) throw new Blocked("rerun_root", "--out请指定已执行批次的原始根目录，不能传review、corrections或新目录：" + directory);
    const source = await read(join(directory, "batch.identity.json")), { id: sourceId, ...sourceIdentity } = source,
      execution = await read(join(directory, "execution.identity.json")), ledger = await read(join(directory, "budget.json"));
    if (source.format !== 1 || source.accounting || sourceId !== hash(sourceIdentity) || hash(source.snapshot) !== source.inputVersion ||
        execution.batchId !== sourceId || ledger.format !== 1 || ledger.limitCny !== execution.budgetCny || ledger.pricingId !== execution.pricingId)
      throw new Blocked("rerun_source_corrupt", "use the original batch root with intact input, execution and cumulative budget identities");
    const keys = (await readdir(join(directory, "requests"))).filter((f) => f.endsWith(".request.json")).map((f) => f.slice(0, -13)),
      entryIds = ledger.entries.map((e: any) => e.id);
    if (new Set(entryIds).size !== entryIds.length || hash([...keys].sort()) !== hash([...entryIds].sort()))
      throw new Blocked("budget_change", "request inventory differs from cumulative reservations");
    for (const entry of ledger.entries) {
      if (!/^[a-f0-9]{64}$/.test(entry.id) || !Number.isFinite(entry.reservedCny) || entry.reservedCny < 0)
        throw new Blocked("budget_change", "invalid historical request reservation");
      const base = join(directory, "requests", entry.id), req = await read(base + ".request.json"), { key, ...requestIdentity } = req;
      if (key !== entry.id || hash(requestIdentity) !== key || req.mode !== execution.mode || req.transportId !== execution.transportId)
        throw new Blocked("cache_corrupt", "historical request identity changed");
      if (entry.status !== "completed" || !await exists(base + ".response.json"))
        throw new Blocked("outcome_unknown", "unresolved paid outcome must be inspected before a new round; no implicit resend: " + entry.id);
      const response = await read(base + ".response.json"), receipt = await read(base + ".receipt.json");
      if (response.key !== key || hash(response.response) !== response.sha256 || response.response.status !== "completed" ||
          receipt.key !== key || receipt.status !== "completed" || receipt.responseHash !== response.sha256)
        throw new Blocked("cache_corrupt", "historical response/receipt integrity mismatch");
    }
    const originalSnapshot = new DataSnapshot(source.snapshot), categoryId = options.categoryId ?? source.root.id;
    if (options.categoryIds?.some((id) => !source.categoryIds.includes(id) || !originalSnapshot.tree.get(id).isLeaf))
      throw new Blocked("rerun_scope", "--category-ids只能包含原批次范围内的真实末级ID，不展开上级类目");
    // Source order makes equivalent explicit lists share an identity and seed selection.
    const categoryIds: string[] = options.categoryIds
      ? source.categoryIds.filter((id: string) => options.categoryIds!.includes(id))
      : originalSnapshot.tree.descendants(categoryId, true).map((n) => n.id);
    if (!categoryIds.length || categoryIds.some((id) => !source.categoryIds.includes(id)))
      throw new Blocked("rerun_scope", "new round must stay within the original batch leaf scope");
    validateBatchOptions({ categoryId, outDir: directory, runId: source.runId, concurrency: options.concurrency });
    const groups: BatchPlan["groups"] = source.groups.filter((g: any) => g.members.some((id: string) => categoryIds.includes(id)))
      .map((g: any) => ({ ...g, seedCategoryId: g.members.find((id: string) => categoryIds.includes(id)) }));
    const runId = source.runId + "/rerun/" + options.roundName, data = jsonClone(source.snapshot);
    // Only rebind this original batch's candidate input. Foreign/in-flight baselines retain their status.
    for (const family of data.families) if (family.status === "candidate" && family.runId === source.runId) family.runId = runId;
    data.families = data.families.filter((f: any) => !groups.some((g) => g.id === f.id && g.needsSeed));
    const knowledgeUpdate = source.profileVersion
      ? attachPilotKnowledge(data, [...new Set([...categoryIds, ...groups.flatMap(g => g.members)])]) : null;
    const snapshot = new DataSnapshot(data), node = snapshot.tree.get(categoryId), outDir = join(directory, "reruns", options.roundName);
    const model: ModelOptions = { ...source.model, reasoningEffort: reasoningEffort ?? source.model.reasoningEffort };
    const roundIdentity = { format: 1, modelingContractVersion: MODELING_PROPOSAL_VERSION, roundName: options.roundName, sourceBatchId: sourceId, sourceReleaseId: source.releaseId,
      sourceInputVersion: source.inputVersion, releaseId: release.id, snapshotVersion: snapshot.version, categoryIds, knowledgeUpdate,
      model, limits: source.limits, budgetLimitCny: execution.budgetCny, pricingId: execution.pricingId,
      reserveCny: source.reserveCny, transportId: execution.transportId, mode: execution.mode };
    const roundId = hash(roundIdentity);
    const plan: BatchPlan = {
      ...source, modelingContractVersion: MODELING_PROPOSAL_VERSION, id: "", releaseId: release.id, runId, snapshot: snapshot.data, inputVersion: snapshot.version,
      root: { id: node.id, name: node.name, path: node.path }, categoryIds, groups, model,
      budgetCny: execution.budgetCny, pricingId: execution.pricingId, outDir, concurrency: options.concurrency, preflight: [],
      accounting: { directory, originalBatchId: sourceId, roundName: options.roundName, roundId },
      maximumStageTasks: categoryIds.length + groups.filter((g) => g.needsSeed).length,
      maximumRequests: 0, maximumReservationCny: 0,
    };
    plan.maximumRequests = plan.maximumStageTasks * plan.limits.maxRounds;
    plan.maximumReservationCny = Number((plan.maximumRequests * (execution.mode === "network" ? plan.reserveCny : 0)).toFixed(2));
    for (const id of categoryIds) try {
      const context = await assemble(release, snapshot, batchTask(plan, id, "leaf"));
      if (snapshot.families(id, runId).some((f) => !f.usable)) throw new Blocked("family_dependency", "unavailable original input family");
      const gaps = context.tools.knowledgeGaps();
      if (gaps.length) throw new Blocked("knowledge_dependency", gaps.join("; "));
    } catch (error) {
      plan.preflight.push({ categoryId: id, code: error instanceof Blocked ? error.code : "preflight_error", error: String(error) });
    }
    const { id: _id, outDir: _out, concurrency: _c, preflight: _p, ...identity } = plan;
    plan.id = hash(identity);
    await frozen(join(outDir, "rerun.identity.json"), { ...roundIdentity, id: roundId });
    await frozen(join(outDir, "batch.identity.json"), { ...identity, id: plan.id });
    const reserved = Number(ledger.entries.reduce((sum: number, e: any) => sum + e.reservedCny, 0).toFixed(2)),
      remaining = Number((effectiveBudgetLimit(ledger) - reserved).toFixed(2));
    const preview = { mode: "new_round_preview", ready: !plan.preflight.length, originalDirectory: directory, outDir,
      roundName: options.roundName, roundId, releaseId: release.id, originalReleaseId: source.releaseId,
      categoryId: options.categoryIds ? null : categoryId, categoryIds,
      categories: categoryIds.map((id) => ({ id, name: snapshot.tree.get(id).name })), model: plan.model,
      leafCount: categoryIds.length, familySeeds: groups.filter((g) => g.needsSeed).map((g) => g.id),
      concurrency: plan.concurrency, preflight: plan.preflight, sourceProposalsReused: 0,
      preservedReviewedBaselineFamilies: groups.filter((g) => !g.needsSeed).map((g) => g.id),
      originalRequestCount: keys.length, cumulativeReservedCny: reserved, budgetLimitCny: effectiveBudgetLimit(ledger),
      remainingReservationCny: remaining, maximumAdditionalRequests: plan.maximumRequests,
      maximumAdditionalReservationCny: plan.maximumReservationCny,
      fullWorstCaseFitsRemainingBudget: remaining >= plan.maximumReservationCny,
      accounting: "沿用原费用台账，数值为保守预留，不是实际账单；触顶停止，不自动提额",
      networkCalls: 0, productionWrites: 0, adoption: "pending_human",
      next: "同名同范围命令加--execute才付费；重复执行只恢复这一轮，可调并发；不换round名处理普通失败" };
    await save(join(outDir, "rerun.plan.json"), preview);
    return { plan, execution, preview };
  });
}
