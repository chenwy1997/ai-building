import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { readJsonFile, writeJsonFile } from "../../facilities/json/files.ts";
import { categoryById } from "./category-tree.ts";
import { parseGovernanceResponse } from "./template-codec.ts";
import { buildAttributeConsensus, buildConfirmedTemplateDocument, type GovernanceObservation } from "./consensus.ts";
import { parseFlags, asInt, shortCategoryId } from "./util.ts";
import { readContextDocument, workspaceRoot } from "./storage.ts";
import type { CategoryNode } from "./types.ts";

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
    else if (entry.name.endsWith(".json") && !entry.name.includes("request") && !entry.name.includes("manifest") && !entry.name.startsWith("merged-")) files.push(path);
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
      skipped.push({ runId: run.id, file, error: error instanceof Error ? error.message : String(error) });
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
  for (const run of runs) {
    const loaded = await loadRunObservations(run, byId);
    observations.push(...loaded.observations);
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
  await writeJsonFile(candidatesPath, consensus);
  await writeJsonFile(decisionsPath, consensus);
  await writeJsonFile(templatesPath, templates);
  await writeJsonFile(join(runDir, "attribute-candidates-v1.json"), consensus);
  await writeJsonFile(join(runDir, "attribute-decisions-v1.json"), consensus);
  await writeJsonFile(join(runDir, "attribute-templates-v1.json"), templates);
  await writeJsonFile(join(runDir, "manifest.json"), { ...consensus.stats, sourceRuns: consensus.sourceRuns, observationCount: observations.length, skippedCount: skipped.length, skipped, generatedAt: consensus.generatedAt, thresholds: consensus.thresholds });
  console.log(`已汇总运行：${consensus.sourceRuns.join(", ")}`);
  console.log(`类目 ${consensus.stats.categoryCount}，属性候选 ${consensus.stats.candidateCount}，确认 ${consensus.stats.confirmedCount}，候选 ${consensus.stats.candidateStatusCount}，待复核 ${consensus.stats.reviewCount}`);
  console.log(`候选：${candidatesPath}`);
  console.log(`决策：${decisionsPath}`);
  console.log(`正式模板（仅 confirmed）：${templatesPath}`);
  if (skipped.length > 0) console.log(`跳过无法通过当前校验的历史结果 ${skipped.length} 个；详见快照 manifest.json`);
}

if (import.meta.main) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
