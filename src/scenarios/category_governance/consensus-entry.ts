import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { readJsonFile, writeJsonFile } from "../../facilities/json/files.ts";
import { categoryById } from "./category-tree.ts";
import { parseGovernanceResponse } from "./template-codec.ts";
import { buildAttributeConsensus, buildConfirmedTemplateDocument, type GovernanceObservation } from "./consensus.ts";
import { parseFlags, asInt, shortCategoryId } from "./util.ts";
import { readContextDocument, workspaceRoot } from "./storage.ts";
import type { CategoryNode } from "./types.ts";
import { prepareReviewConsensus, reviewCategoryStats, sampleReviewCategories } from "./review-preparation.ts";

const HELP = `
把多次类目治理结果汇总为属性候选和稳定决策

用法：
  bun run category-governance:consensus
  bun run category-governance:consensus --run-id=20,22
  bun run category-governance:consensus --run-id=20,21,22 --confirmed-coverage=0.6

参数：
  --run-id=20,22          指定治理运行 ID；不传则读取 output/<version>/run-* 全部运行
  --confirmed-coverage=0.6  达到该批次覆盖率且至少 2 批才确认为稳定属性
  --candidate-coverage=0.3  达到该覆盖率的属性保留为候选
  --min-confirmed-runs=2    确认属性所需的最少独立运行批次
  --workspace=...         覆盖类目治理 workspace
  --version=v1            类目上下文版本
`.trim();

async function jsonFilesUnder(directory: string): Promise<string[]> {
  const files: string[] = [];
  let entries: Array<import("node:fs").Dirent>;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return files; }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await jsonFilesUnder(path));
    else if (entry.name.endsWith(".json") && !entry.name.includes("request") && !entry.name.includes("manifest") && !entry.name.startsWith("merged-") &&
      !(entry.name.startsWith("attempt-") && entries.some((item) => item.name === "results.json"))) files.push(path);
  }
  return files;
}

async function runDirectories(outputRoot: string, selector?: string): Promise<Array<{ id: string; path: string }>> {
  const wanted = selector ? new Set(selector.split(",").map((item) => item.trim()).filter(Boolean)) : undefined;
  const entries = await readdir(outputRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && /^run-\d+$/u.test(entry.name))
    .map((entry) => ({ id: entry.name.slice(4), path: join(outputRoot, entry.name) }))
    .filter((item) => !wanted || wanted.has(item.id))
    .sort((a, b) => Number(a.id) - Number(b.id));
}

async function loadRunObservations(run: { id: string; path: string }, byId: Map<string, CategoryNode>): Promise<{ observations: GovernanceObservation[]; skipped: Array<{ runId: string; file: string; error: string }> }> {
  const observations: GovernanceObservation[] = [];
  const skipped: Array<{ runId: string; file: string; error: string }> = [];
  for (const file of await jsonFilesUnder(run.path)) {
    const compact = await readJsonFile<Record<string, unknown>>(file);
    if (!compact.a || !compact.c) continue;
    const ids = Object.keys(compact.c as Record<string, unknown>);
    const targets = ids.map((id) => byId.get(id)).filter((node): node is CategoryNode => Boolean(node));
    if (targets.length !== ids.length) throw new Error(`结果包含未导入类目：${file}`);
    try {
      for (const result of parseGovernanceResponse(JSON.stringify(compact), targets)) observations.push({ runId: run.id, result });
    } catch (error) {
      // 紧凑文件按批次保存，单个类目的坏属性不应丢弃同批其他类目。
      // 逐类目隔离解析后，只有真正失败的类目会进入 skipped，便于后续定点补跑。
      for (const id of ids) {
        const node = byId.get(id);
        if (!node) continue;
        try {
          const one = { ...compact, c: { [id]: (compact.c as Record<string, unknown>)[id] } };
          try {
            observations.push({ runId: run.id, result: parseGovernanceResponse(JSON.stringify(one), [node])[0]! });
          } catch (strictError) {
            const message = strictError instanceof Error ? strictError.message : String(strictError);
            if (!message.includes("必须填写 unit")) throw strictError;
            // 单位缺失交给语义终审结合类目和证据补正；这里不凭规则猜单位。
            observations.push({ runId: run.id, result: parseGovernanceResponse(JSON.stringify(one), [node], { allowMissingUnits: true })[0]! });
          }
        } catch (itemError) {
          skipped.push({ runId: run.id, file: `${file}#${id}`, error: itemError instanceof Error ? itemError.message : String(itemError) });
        }
      }
    }
  }
  return { observations, skipped };
}

async function main(argv: string[] = Bun.argv.slice(2)): Promise<void> {
  const { positionals, flags } = parseFlags(argv);
  if (flags.help === "true" || flags.h === "true" || positionals.length > 0) {
    console.log(HELP);
    if (positionals.length > 0) throw new Error(`不支持位置参数：${positionals.join(" ")}`);
    return;
  }
  const version = flags.version ?? "v1";
  const workspace = flags.workspace ?? workspaceRoot();
  const document = await readContextDocument(workspace, version);
  const outputRoot = join(workspace, "output", version);
  const runs = await runDirectories(outputRoot, flags["run-id"] ?? flags.runs);
  if (runs.length === 0) throw new Error(`没有找到治理运行：${outputRoot}`);
  const observations: GovernanceObservation[] = [];
  // 结果 c 既可能使用完整 ID，也可能使用稳定短 ID。
  const byId = categoryById(document);
  for (const node of document.nodes) byId.set(shortCategoryId(node.id), node);
  const skipped: Array<{ runId: string; file: string; error: string }> = [];
  const roundIds = new Map<string, string>();
  const resolveRound = async (id: string, visited = new Set<string>()): Promise<string> => {
    if (roundIds.has(id)) return roundIds.get(id)!;
    if (visited.has(id)) throw new Error("补跑来源存在循环");
    visited.add(id);
    const manifest = await readJsonFile<{ retryRunId?: string | null }>(join(outputRoot, `run-${id}`, "manifest.json"));
    const parent = manifest.retryRunId?.replace(/^run-/u, "");
    if (parent && !/^\d+$/u.test(parent)) throw new Error(`无效补跑来源：${parent}`);
    const roundId = parent ? await resolveRound(parent, visited) : id;
    roundIds.set(id, roundId);
    return roundId;
  };
  for (const run of runs) {
    const loaded = await loadRunObservations(run, byId);
    const roundId = await resolveRound(run.id);
    observations.push(...loaded.observations.map((observation) => ({ ...observation, roundId })));
    skipped.push(...loaded.skipped);
  }
  if (observations.length === 0) throw new Error(`运行目录中没有成功的治理结果：${runs.map((run) => run.id).join(",")}`);
  const consensus = buildAttributeConsensus(observations, {
    confirmedCoverage: Number(flags["confirmed-coverage"] ?? 0.6),
    candidateCoverage: Number(flags["candidate-coverage"] ?? 0.3),
    minConfirmedRuns: asInt(flags["min-confirmed-runs"], 2),
  });
  const stableDir = join(workspace, "output", version, "consensus");
  const runDir = join(stableDir, `run-${new Date().toISOString().replace(/[-:]/gu, "").replace(".", "-")}`);
  const candidatesPath = join(stableDir, "attribute-candidates-v1.json");
  const decisionsPath = join(stableDir, "attribute-decisions-v1.json");
  const templatesPath = join(stableDir, "attribute-templates-v1.json");
  const templates = buildConfirmedTemplateDocument(consensus);
  const prepared = prepareReviewConsensus(consensus);
  const preparedPath = join(stableDir, "attribute-review-candidates-v1.json");
  const categoryStats = prepared.categories.map((category) => ({ category: category.category, ...reviewCategoryStats(category) }));
  const plan = { sourceRuns: consensus.sourceRuns, sourceRounds: Object.fromEntries(roundIds), localOnly: true,
    categoryCount: prepared.categories.length, sourceCandidateCount: consensus.stats.candidateCount,
    candidateGroupCount: prepared.stats.candidateCount,
    definitionCount: categoryStats.reduce((sum, item) => sum + item.definitionCount, 0),
    conflictCategoryCount: categoryStats.filter((item) => item.conflictGroups > 0).length,
    largeCategoryCount: categoryStats.filter((item) => item.risk === "large").length,
    maximumCandidateGroups: Math.max(...categoryStats.map((item) => item.candidateGroups)),
    sample: sampleReviewCategories(prepared.categories, 30).map((category) => ({ category: category.category, ...reviewCategoryStats(category) })),
  };
  const compactJson = { pretty: false, trailingNewline: true };
  await writeJsonFile(candidatesPath, consensus, compactJson);
  await writeJsonFile(decisionsPath, consensus, compactJson);
  await writeJsonFile(templatesPath, templates, compactJson);
  await writeJsonFile(join(runDir, "attribute-candidates-v1.json"), consensus, compactJson);
  await writeJsonFile(join(runDir, "attribute-decisions-v1.json"), consensus, compactJson);
  await writeJsonFile(join(runDir, "attribute-templates-v1.json"), templates, compactJson);
  await writeJsonFile(preparedPath, prepared, { pretty: false, trailingNewline: true });
  await writeJsonFile(join(runDir, "attribute-review-candidates-v1.json"), prepared, { pretty: false, trailingNewline: true });
  await writeJsonFile(join(stableDir, "review-plan.json"), plan);
  await writeJsonFile(join(runDir, "review-plan.json"), plan);
  await writeJsonFile(join(runDir, "manifest.json"), { ...consensus.stats, sourceRuns: consensus.sourceRuns, observationCount: observations.length, skippedCount: skipped.length, skipped, generatedAt: consensus.generatedAt, thresholds: consensus.thresholds });
  console.log(`已汇总运行：${consensus.sourceRuns.join(", ")}`);
  console.log(`类目 ${consensus.stats.categoryCount}，属性候选 ${consensus.stats.candidateCount}，确认 ${consensus.stats.confirmedCount}，候选 ${consensus.stats.candidateStatusCount}，待复核 ${consensus.stats.reviewCount}`);
  console.log(`候选：${candidatesPath}`);
  console.log(`决策：${decisionsPath}`);
  console.log(`正式模板（仅 confirmed）：${templatesPath}`);
  console.log(`复审输入：${preparedPath}（${plan.candidateGroupCount} 个候选组，${plan.definitionCount} 份完整定义；不丢弃冲突和低频候选）`);
  console.log(`抽样计划：多定义类目 ${plan.conflictCategoryCount}，大输入类目 ${plan.largeCategoryCount}，详见 ${join(stableDir, "review-plan.json")}`);
  if (skipped.length > 0) console.log(`跳过无法通过当前校验的历史结果 ${skipped.length} 个；详见快照 manifest.json`);
}

if (import.meta.main) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
