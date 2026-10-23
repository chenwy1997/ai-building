import { join, resolve } from "node:path";
import {
  read, save, exists, hash, lock, jsonClone, Blocked,
  type Snapshot, type Task, type Family,
  type AttributeDefinition, type AttributeBinding, type ExtensionCandidate,
} from "./core.ts";
import { ROOT, type Release } from "./release.ts";
import { CategoryIndex } from "./catalog.ts";
import { DataSnapshot } from "./snapshot.ts";
import { assemble } from "./context.ts";
import { runStage, DEFAULT_LIMITS, BATCH_CORRECTIONS, type ModelOptions } from "./runner.ts";
import { ResponsesClient } from "./responses.ts";
import { systemFieldsFromInventory } from "./scm-field-inventory.ts";
import { rollDefinitions, rollBindings, rollExtensionCandidates } from "./roll-pilot.ts";
import { CONFIGURATION_REVIEW_VERSION } from "./scripts/configuration-review.mjs";
import { proposalReadiness, proposalCounts } from "./proposal-readiness.ts";
import { modelingReviewSignals } from "./modeling-review.ts";

export const CLEAN_PAPER_ID = "77e31cf2-8331-4c73-ab10-823d2d1d7ab0";
export const DEFAULT_TREE = resolve(ROOT, "../../../outputs/category-id-refresh-20261021/mapped-tree.updated.json");
export const BATCH_LIMITS = Object.freeze({ ...DEFAULT_LIMITS, maxOutputTokens: 24000 });
export const BATCH_MODEL: ModelOptions = Object.freeze({ model: "deepseek-flash", reasoningEffort: "low" });
// A local conservative reservation, NOT an expected invoice. Frozen separately from provider billing.
// 350000 input bytes + 24000 output tokens at 2026-10-23 peak USD rates, 9 CNY/USD allowance.
export const REQUEST_RESERVE_CNY = 1.3;
export const BATCH_PRICING_ID = "deepseek-flash-20261023-peak-byte-bound-cny9-v1";
export const DEFAULT_BUDGET_CNY = 200;

export interface BatchOptions {
  categoryId: string;
  outDir: string;
  runId: string;
  concurrency: number;
  treePath?: string;
  snapshotPath?: string;
  budgetCny?: number;
}
interface Group {
  id: string;
  members: string[];
  reason: string;
  seedCategoryId: string;
  needsSeed: boolean;
}
interface Profile {
  format: number;
  id: string;
  scopeId: string;
  scopeName: string;
  knowledgeIds: string[];
  groups: {
    id: string;
    members: { id: string; name: string }[];
    reason: string;
    seed: "reviewed-roll-proposal" | "deepseek-common-proposal";
    knowledgeIds: string[];
  }[];
}
export interface BatchPlan {
  format: 1;
  releaseId: string;
  id: string;
  runId: string;
  root: { id: string; name: string; path: string };
  categoryIds: string[];
  groups: Group[];
  snapshot: Snapshot;
  inputVersion: string;
  profileVersion: string | null;
  model: ModelOptions;
  budgetCny: number;
  reserveCny: number;
  pricingId: string;
  limits: typeof BATCH_LIMITS;
  outDir: string;
  concurrency: number;
  preflight: { categoryId: string; code: string; error: string }[];
  maximumStageTasks: number;
  maximumRequests: number;
  maximumReservationCny: number;
  productionWrites: 0;
  adoption: "pending_human";
  accounting?: { directory: string; originalBatchId: string; roundName: string; roundId: string };
}
type StageArtifact = Awaited<ReturnType<typeof runStage>>;
export interface BatchJob {
  phase: "family-seed" | "leaf";
  categoryId: string;
  familyId: string | null;
  status: "program_pass_pending_human" | "program_blocked";
  code: string | null;
  error: string | null;
  artifact: StageArtifact | null;
}
export function validateBatchOptions(options: BatchOptions) {
  if (!options.categoryId?.trim() || !options.outDir?.trim() || !options.runId?.trim())
    throw Error("categoryId, outDir and runId are required");
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 128)
    throw Error("--concurrency must be an integer in 1..128");
  if (!Number.isFinite(options.budgetCny ?? DEFAULT_BUDGET_CNY) ||
      (options.budgetCny ?? DEFAULT_BUDGET_CNY) <= 0)
    throw Error("--budget-cny must be a positive finite number");
  if (options.treePath && options.snapshotPath)
    throw Error("use --tree or --snapshot, not both");
}
async function freezeFile(path: string, value: unknown) {
  await lock(path + ".lock", async () => {
    if (await exists(path)) {
      if (hash(await read(path)) !== hash(value))
        throw new Blocked("batch_identity_drift", "frozen batch inputs/configuration changed; keep the original directory and use batch-recover for host-only fixes. Business/input changes require an explicit new task, never a directory change to bypass cumulative costs: " + path);
    } else await save(path, value);
  });
}
function groupFor(plan: BatchPlan, categoryId: string) {
  return plan.groups.find((g) => g.members.includes(categoryId));
}
export function batchTask(plan: BatchPlan, categoryId: string, phase: BatchJob["phase"]): Task {
  const group = groupFor(plan, categoryId);
  return {
    runId: plan.runId,
    stage: "family-modeling",
    categoryId,
    productId: null,
    question: phase === "family-seed"
      ? "设计候选同族所有成员均适用的共同属性定义，当前categoryId仅作为输出锚点。不要把锚点类目专有特征当成全族共性。各成员的差异或共同性疑点写unresolved。按schema输出定义及当前叶绑定，程序仅在检查通过后转为本批待审模板；不是正式发布。"
      : "提出当前末级类目的属性方案供人工审阅。先读同族共同基线、属性池、系统字段职责和必读知识；按业务必要性准入，名称简明，已冻结共同定义与扩展取舍保持一致，差异说明理由。只设计属性，不填SKU值，不新增类目，不执行线上变更。",
    candidate: {
      kind: "batch_modeling_scope",
      phase,
      modelingMode: phase === "family-seed" ? "family_seed" : group ? "inherited_leaf" : "independent_proposal",
      family: group ? {
        id: group.id,
        members: group.members.map((id) => {
          const node = plan.snapshot.tree.nodes.find((n: any) => n.id === id) as { id: string; name: string; path: string };
          return { id: node.id, name: node.name, path: node.path };
        }),
        reason: group.reason,
        status: "configured_candidate_pending_human",
      } : null,
      reviewScope: "category_attribute_schema_only",
    },
  };
}

export async function prepareBatch(options: BatchOptions, release: Release): Promise<BatchPlan> {
  validateBatchOptions(options);
  let snapshot: DataSnapshot, profileVersion: string | null = null;
  const groups: Group[] = [];
  if (options.snapshotPath) {
    snapshot = new DataSnapshot(await read(resolve(options.snapshotPath)));
    if (snapshot.data.kind !== "local")
      throw new Blocked("fixture_batch", "the batch entry requires a local business snapshot");
  } else {
    const treePath = options.treePath ?? (await exists(DEFAULT_TREE) ? DEFAULT_TREE : join(ROOT, "profiles/clean-paper-tree.json")),
      tree = new CategoryIndex(await read(resolve(treePath))),
      scope = tree.descendants(CLEAN_PAPER_ID),
      scopeIds = new Set(scope.map((n) => n.id));
    tree.get(options.categoryId);
    if (!scopeIds.has(options.categoryId))
      throw new Blocked("profile_scope", "default knowledge/profile covers 清洁纸品 only; supply --snapshot with appropriate responsibilities, families and knowledge for another category");
    const profile = await read<Profile>(join(ROOT, "profiles/clean-paper.json"));
    if (profile.format !== 1 || profile.scopeId !== CLEAN_PAPER_ID ||
        tree.get(profile.scopeId).name !== profile.scopeName)
      throw Error("profile category identity drift");
    profileVersion = hash(profile);
    const inventory = await read(join(ROOT, "scm-field-responsibilities.json")),
      systemFields = systemFieldsFromInventory(inventory),
      families: Family[] = [],
      selected = new Set(tree.descendants(options.categoryId, true).map((n) => n.id));
    for (const group of profile.groups) {
      if (!group.members.some((m) => selected.has(m.id))) continue;
      for (const member of group.members)
        if (tree.get(member.id).name !== member.name || !tree.get(member.id).isLeaf)
          throw Error("profile member identity drift: " + member.id);
      const members = group.members.map((m) => m.id);
      groups.push({
        id: group.id, members, reason: group.reason,
        seedCategoryId: members.find((id) => selected.has(id))!,
        needsSeed: group.seed === "deepseek-common-proposal",
      });
      if (group.seed === "reviewed-roll-proposal") {
        const attributes = await rollDefinitions(), bindings = rollBindings(attributes),
          extensionCandidates = await rollExtensionCandidates();
        families.push({
          id: group.id, members, status: "candidate", runId: options.runId,
          version: hash({ attributes, bindings, extensionCandidates }),
          attributes, bindings, extensionCandidates,
        });
      }
    }
    snapshot = new DataSnapshot({
      format: 2, kind: "local", version: "batch-input-" + profile.id,
      tree: { nodes: tree.nodes, externalParentIds: [...new Set(tree.nodes
        .filter((n) => n.parentId && !tree.byId.has(n.parentId)).map((n) => n.parentId!))] },
      systemFields,
      systemFieldCoverage: {
        version: inventory.version, source: "frozen local SCM code inventory; not a fresh production audit",
        sourceHash: hash(systemFields), status: "complete", coveredKeys: systemFields.map((f) => f.key),
      },
      families, attributes: [], sources: [], products: [], derivationPolicies: [],
      knowledgeIds: [...new Set([...profile.knowledgeIds, ...profile.groups.flatMap((g) => g.knowledgeIds)])],
      knowledgeRequirements: scope.filter((n) => n.isLeaf).map((n) => ({
        id: "batch-required:" + n.id, categoryIds: [n.id],
        stages: ["family-modeling", "domain-research", "review-assistance"],
        knowledgeIds: [...profile.knowledgeIds, ...profile.groups.filter((g) => g.members.some((m) => m.id === n.id)).flatMap((g) => g.knowledgeIds)],
        reason: "按商品对象核对业务准入、系统职责和专业知识边界；文件读完不等于专业问题已核实",
      })),
    });
  }
  const root = snapshot.tree.get(options.categoryId),
    categoryIds = snapshot.tree.descendants(root.id, true).map((n) => n.id);
  if (!categoryIds.length) throw Error("selected category has no existing leaf descendants");
  if (options.snapshotPath) {
    for (const family of snapshot.data.families.filter((f) => f.members.some((id) => categoryIds.includes(id))))
      groups.push({ id: family.id, members: family.members,
        reason: "显式输入快照的既有基线，保持原状态与版本，不自动批准其他批候选",
        seedCategoryId: family.members.find((id) => categoryIds.includes(id))!, needsSeed: false });
  }
  if (new Set(groups.flatMap((g) => g.members)).size !== groups.flatMap((g) => g.members).length)
    throw new Blocked("ambiguous_baseline", "batch members overlap multiple family groups");
  const plan: BatchPlan = {
    format: 1, releaseId: release.id, id: "", runId: options.runId,
    root: { id: root.id, name: root.name, path: root.path }, categoryIds, groups,
    snapshot: snapshot.data, inputVersion: snapshot.version, profileVersion,
    model: BATCH_MODEL, limits: BATCH_LIMITS,
    budgetCny: options.budgetCny ?? DEFAULT_BUDGET_CNY,
    reserveCny: REQUEST_RESERVE_CNY, pricingId: BATCH_PRICING_ID,
    outDir: resolve(options.outDir), concurrency: options.concurrency, preflight: [],
    maximumStageTasks: categoryIds.length + groups.filter((g) => g.needsSeed).length,
    maximumRequests: 0, maximumReservationCny: 0,
    productionWrites: 0, adoption: "pending_human",
  };
  plan.maximumRequests = plan.maximumStageTasks * plan.limits.maxRounds;
  plan.maximumReservationCny = Math.round(plan.maximumRequests * plan.reserveCny * 100) / 100;
  for (const categoryId of categoryIds) {
    try {
      const context = await assemble(release, snapshot, batchTask(plan, categoryId, "leaf"));
      if (options.snapshotPath && snapshot.families(categoryId, plan.runId).some((f) => !f.usable))
        throw new Blocked("family_dependency", "explicit snapshot contains an unavailable family; do not replace another batch's pending baseline by independently modeling the leaf");
      const gaps = context.tools.knowledgeGaps();
      if (gaps.length) throw new Blocked("knowledge_dependency", gaps.join("; "));
    } catch (error) {
      plan.preflight.push({ categoryId, code: error instanceof Blocked ? error.code : "preflight_error", error: String(error) });
    }
  }
  const { outDir, concurrency, preflight, id, ...identity } = plan;
  plan.id = hash(identity);
  await freezeFile(join(plan.outDir, "batch.identity.json"), { ...identity, id: plan.id });
  await save(join(plan.outDir, "batch.plan.json"), planSummary(plan));
  return plan;
}
export function planSummary(plan: BatchPlan) {
  const { snapshot, ...rest } = plan;
  return { ...rest, mode: "preview", ready: !plan.preflight.length,
    inputFile: join(plan.outDir, "batch.identity.json"), networkCalls: 0,
    leafCount: plan.categoryIds.length,
    familiesToPrepare: plan.groups.filter((g) => g.needsSeed).map((g) => g.id),
    accounting: "保守预留额度，不是预计账单；实际收费以DeepSeek为准",
    next: "确认范围后原命令加 --execute；成功结果仍待人工审阅" };
}
export async function mapConcurrent<T, R>(items: T[], concurrency: number, work: (item: T) => Promise<R>): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 128) throw Error("invalid concurrency");
  const results: R[] = new Array(items.length);
  let cursor = 0, failed = false, failure: unknown;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      if (failed) return;
      const i = cursor++;
      if (i >= items.length) return;
      try { results[i] = await work(items[i]!); }
      catch (error) { failed = true; failure = error; return; }
    }
  }));
  if (failed) throw failure;
  return results;
}
export function pendingFamily(group: Group, artifact: StageArtifact, runId: string): Family {
  const result = artifact.result as {
    attributes: AttributeDefinition[]; bindings: AttributeBinding[]; extensionCandidates: ExtensionCandidate[];
  };
  const bindings = result.bindings.map((b) => ({ ...b, categoryId: null, baselineAttributeId: null, differenceReason: null }));
  return {
    id: group.id, members: group.members, status: "candidate", runId,
    version: hash({ attributes: result.attributes, bindings, extensionCandidates: result.extensionCandidates }),
    attributes: result.attributes, bindings, extensionCandidates: result.extensionCandidates,
  };
}
export async function executeBatch(
  plan: BatchPlan, release: Release, client: ResponsesClient,
  progress: (event: Record<string, unknown>) => void = () => {},
) {
  const { outDir, concurrency, preflight, id, ...identity } = plan;
  if (hash(identity) !== id) throw Error("frozen batch configuration integrity mismatch");
  if (plan.releaseId !== release.id || hash(plan.snapshot) !== plan.inputVersion)
    throw Error("batch/release/input integrity mismatch");
  if (plan.preflight.length) throw new Blocked("batch_preflight", "resolve preflight issues before paid execution");
  const accountingDir = plan.accounting?.directory ?? plan.outDir;
  if (resolve(client.dir) !== accountingDir || resolve(client.budget.path) !== join(accountingDir, "budget.json"))
    throw Error("all batch jobs must share the same output directory and budget ledger");
  if (client.mode === "network" && (client.reserveCny !== plan.reserveCny ||
      client.budget.limitCny !== plan.budgetCny || client.budget.pricingId !== plan.pricingId))
    throw Error("network client reservation/budget differs from the frozen batch");
  return lock(join(accountingDir, "execution.lock"), async () => {
    if (plan.accounting) {
      const source = await read(join(accountingDir, "batch.identity.json")), { id: sourceId, ...sourceIdentity } = source,
        round = await read(join(plan.outDir, "rerun.identity.json")), { id: roundId, ...roundIdentity } = round,
        execution = await read(join(accountingDir, "execution.identity.json"));
      if (sourceId !== hash(sourceIdentity) || sourceId !== plan.accounting.originalBatchId ||
          roundId !== hash(roundIdentity) || roundId !== plan.accounting.roundId || round.sourceBatchId !== sourceId ||
          round.releaseId !== plan.releaseId || round.roundName !== plan.accounting.roundName ||
          plan.outDir !== join(accountingDir, "reruns", plan.accounting.roundName) ||
          round.snapshotVersion !== plan.inputVersion || hash(round.categoryIds) !== hash(plan.categoryIds) ||
          hash(round.model) !== hash(plan.model) || hash(round.limits) !== hash(plan.limits) ||
          execution.batchId !== sourceId || execution.mode !== client.mode || execution.transportId !== client.transportId ||
          execution.budgetCny !== client.budget.limitCny || execution.pricingId !== client.budget.pricingId)
        throw new Blocked("rerun_identity_drift", "rerun scope, release or shared accounting differs from its frozen identity");
    }
    await freezeFile(join(plan.outDir, "batch.identity.json"), { ...identity, id: plan.id });
    const initialCalls = client.calls, initialCacheHits = client.cacheHits;
    await freezeFile(join(plan.outDir, "execution.identity.json"), {
      batchId: plan.id, mode: client.mode, transportId: client.transportId,
      budgetCny: client.budget.limitCny, pricingId: client.budget.pricingId,
      ...(plan.accounting ? { accountingDirectory: accountingDir, originalBatchId: plan.accounting.originalBatchId } : {}),
    });
    await client.budget.init();
    let stop: string | null = null;
    const perform = async (categoryId: string, phase: BatchJob["phase"], snapshot: DataSnapshot): Promise<BatchJob> => {
      const group = groupFor(plan, categoryId);
      const job: BatchJob = { phase, categoryId, familyId: group?.id ?? null,
        status: "program_blocked", code: null, error: null, artifact: null };
      try {
        if (stop) throw new Blocked("batch_stopped", stop);
        progress({ event: "started", phase, categoryId, category: snapshot.tree.get(categoryId).name });
        job.artifact = await runStage({ release, snapshot, task: batchTask(plan, categoryId, phase),
          client, outDir: plan.outDir, model: plan.model, limits: plan.limits, corrections: BATCH_CORRECTIONS,
          onProgress: (event) => progress({ ...event, phase, categoryId, category: snapshot.tree.get(categoryId).name }) });
        job.status = job.artifact.checks.status;
        if (job.status === "program_blocked") {
          job.code = "program_checks";
          job.error = job.artifact.checks.errors.map((e) => e.ruleId + ":" + e.message).join("; ");
        }
      } catch (error) {
        job.code = error instanceof Blocked ? error.code : "stage_error";
        job.error = String(error);
        if (job.code === "budget_exhausted" || job.code === "http_error") stop = job.error;
      }
      await save(join(plan.outDir, "jobs", phase + "-" + hash(categoryId).slice(0, 20) + ".json"), {
        batchId: plan.id, ...job, proposalReadiness: proposalReadiness(job), artifactHash: job.artifact ? hash(job.artifact) : null,
      });
      progress({ event: "finished", phase, categoryId, category: snapshot.tree.get(categoryId).name, status: job.status, code: job.code, proposalReadiness: proposalReadiness(job) });
      return job;
    };
    const input = new DataSnapshot(plan.snapshot), seeds = plan.groups.filter((g) => g.needsSeed);
    // Barrier: no leaf sees a half-written or completion-order-dependent attribute pool.
    const familySeeds = await mapConcurrent(seeds, plan.concurrency,
      (g) => perform(g.seedCategoryId, "family-seed", input));
    const shared = jsonClone(plan.snapshot), failed = new Map<string, string>();
    for (let i = 0; i < seeds.length; i++) {
      const group = seeds[i]!, job = familySeeds[i]!;
      if (job.status !== "program_pass_pending_human" || !job.artifact)
        failed.set(group.id, job.error ?? "family preparation failed");
      else {
        const family = pendingFamily(group, job.artifact, plan.runId);
        if (!family.attributes.length) failed.set(group.id, "共同定义为空，需要人工确认共同对象与业务用途后再建末级方案");
        else shared.families.push(family);
      }
    }
    const snapshot = new DataSnapshot(shared);
    await save(join(plan.outDir, "batch.shared-snapshot.json"), {
      batchId: plan.id, version: snapshot.version, snapshot: snapshot.data,
      failedFamilies: [...failed].map(([id, error]) => ({ id, error })),
      adoption: "pending_human", productionWrites: 0,
    });
    const leaves = await mapConcurrent(plan.categoryIds, plan.concurrency, async (categoryId): Promise<BatchJob> => {
      const group = groupFor(plan, categoryId), reason = group ? failed.get(group.id) : undefined;
      if (!reason) return perform(categoryId, "leaf", snapshot);
      const blocked: BatchJob = { phase: "leaf", categoryId, familyId: group!.id,
        status: "program_blocked", code: "family_dependency", error: reason, artifact: null };
      await save(join(plan.outDir, "jobs", "leaf-" + hash(categoryId).slice(0, 20) + ".json"), { batchId: plan.id, ...blocked, artifactHash: null });
      progress({ event: "finished", phase: "leaf", categoryId, category: snapshot.tree.get(categoryId).name, status: blocked.status, code: blocked.code });
      return blocked;
    });
    const result = {
      format: 1, batchId: plan.id, releaseId: release.id, runId: plan.runId,
      mode: client.mode, model: plan.model, root: plan.root,
      inputVersion: plan.inputVersion, sharedSnapshotVersion: snapshot.version,
      total: leaves.length, passed: leaves.filter((j) => j.status === "program_pass_pending_human").length,
      blocked: leaves.filter((j) => j.status === "program_blocked").length,
      ...proposalCounts(leaves),
      familySeeds, leaves, budget: await client.budget.status(),
      networkCallsThisExecution: client.mode === "network" ? client.calls - initialCalls : 0,
      mockCallsThisExecution: client.mode === "offline" ? client.calls - initialCalls : 0,
      cacheHitsThisExecution: client.cacheHits - initialCacheHits,
      adoption: "pending_human", productionWrites: 0, skuFillingRequests: 0,
    };
    await save(join(plan.outDir, "batch.results.json"), result);
    await save(join(plan.outDir, "batch.review.json"), buildBatchReview(plan, leaves, snapshot, client.mode));
    await save(join(plan.outDir, "batch.summary.json"), {
      ...result, familySeeds: familySeeds.map(({ artifact, ...j }) => j),
      leaves: leaves.map((job) => { const { artifact, ...j } = job; return { ...j, proposalReadiness: proposalReadiness(job) }; }),
    });
    return result;
  });
}

export function buildBatchReview(plan: BatchPlan, jobs: BatchJob[], snapshot: DataSnapshot, mode: "offline" | "network") {
  const attributes: unknown[][] = [], extensions: unknown[][] = [], issues: unknown[][] = [];
  const signals = modelingReviewSignals(jobs.filter(j => j.status === "program_pass_pending_human" && j.artifact).map(j => ({
    ...j.artifact!.result as any, categoryId: j.categoryId, category: snapshot.tree.get(j.categoryId).name,
  })));
  const types = { boolean: "是否", number: "数值", text: "文本", option: "选项", date: "日期" };
  for (const job of jobs) {
    const node = snapshot.tree.get(job.categoryId), result = job.artifact?.result as any;
    const eligible = job.status === "program_pass_pending_human";
    const group = groupFor(plan, node.id), familyTitle = group
      ? group.members.map((id) => snapshot.tree.get(id).name).join(" / ") : "独立建模，归族待审";
    issues.push([node.name, !eligible ? "阻断，方案未纳入" : proposalReadiness(job) === "no_admitted_attributes"
      ? "零属性，建模缺口待审" : "已有方案，待人工审阅",
      job.error ?? result?.unresolved?.join("\n") ?? "", "", eligible ? result.attributes.length : null,
      familyTitle, job.code ?? "", node.path, node.id,
      job.artifact?.runKey ?? "", plan.releaseId]);
    if (!eligible) continue; // Invalid proposals stay in raw artifacts, never blended into the reviewable contract.
    for (const a of result.attributes as AttributeDefinition[]) {
      const b = (result.bindings as AttributeBinding[]).find((b) => b.attributeId === a.id)!;
      attributes.push([a.name, node.name, b.requiredness === "required" ? "必填" : "选填",
        types[a.fieldType] + (a.unit ? " / " + a.unit : ""), a.rationale, "", "", a.definition,
        b.requirednessReason, b.differenceReason ?? "", familyTitle,
        node.path, a.id, a.conceptKey, a.scope,
        JSON.stringify({ ...a, references: undefined, ...b }),
        a.references.map((r) => `${r.id} @${r.version}\n${r.quote}`).join("\n\n")]);
    }
    for (const c of result.extensionCandidates as ExtensionCandidate[])
      extensions.push([c.name, node.name, c.deferReason, "", "", c.potentialUse, c.activationCriteria,
        node.path, c.id, c.references.map((r) => `${r.id} @${r.version}\n${r.quote}`).join("\n\n")]);
  }
  return { format: 1, batchId: plan.id, root: plan.root, releaseId: plan.releaseId,
    mode,
    adoption: "pending_human", productionWrites: 0, categoryCount: jobs.length,
    ...proposalCounts(jobs),
    modelingReview: { automaticSemanticApproval: false, signals },
    configurationReview: { version: CONFIGURATION_REVIEW_VERSION, source: "host_checker" },
    attributes, extensions, issues };
}
