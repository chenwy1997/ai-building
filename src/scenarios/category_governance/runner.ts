import { createHash } from "node:crypto";
import { join } from "node:path";
import { readdir } from "node:fs/promises";
import type { SQL } from "bun";
import type { AiService } from "../../ai/service.ts";
import { readJsonFile, readTextFile, writeJsonFile, writeTextFile } from "../../facilities/json/files.ts";
import { buildGovernanceUserPrompt, CATEGORY_GOVERNANCE_SYSTEM_PROMPT } from "./prompt.ts";
import { compactTemplates, parseGovernanceResponse, parseGovernanceResponsePartial } from "./template-codec.ts";
import { planGovernanceRetry, type GovernanceRetryPlan, type RecoveredGovernanceResult } from "./retry.ts";
import { mergeGovernanceResults } from "./merge.ts";
import { categoryById } from "./category-tree.ts";
import { outputPath, readContextDocument, writeContextBundle, workspaceRoot } from "./storage.ts";
import { makeContextChunks } from "./std-text.ts";
import { asInt, boolFlag, parseFlags, slugify } from "./util.ts";
import { shortCategoryId } from "./util.ts";
import { buildJdEvidenceText, findJdEvidencePath, loadJdEvidence, type JdEvidenceDocument } from "./jd-evidence.ts";
import type { CategoryNode, CategoryTreeDocument, GovernanceResult } from "./types.ts";

interface Batch {
  key: string;
  rootId: string;
  nodes: CategoryNode[];
  text: string;
  referenceText: string;
  repairError?: string;
}

function categoryMatches(node: CategoryNode, selector: string): boolean {
  const needle = selector.trim().toLocaleLowerCase();
  if (!needle) return true;
  return node.pathIds.some((id) => id.toLocaleLowerCase() === needle || shortCategoryId(id).toLocaleLowerCase() === needle)
    || node.pathNames.some((name) => name.toLocaleLowerCase() === needle)
    || node.pathNames.join("/").toLocaleLowerCase() === needle
    || node.pathNames.join(">").toLocaleLowerCase() === needle;
}

function groupBatches(
  document: CategoryTreeDocument,
  groupDepth: number,
  batchSize: number,
  categorySelector?: string,
  jdEvidence?: JdEvidenceDocument,
): Batch[] {
  const leafGroups = new Map<string, CategoryNode[]>();
  const leaves = document.nodes.filter((candidate) => candidate.isLeaf);
  const selectedLeaves = categorySelector
    ? leaves.filter((leaf) => categoryMatches(leaf, categorySelector))
    : leaves;
  if (categorySelector && selectedLeaves.length === 0) {
    throw new Error(`找不到类目：${categorySelector}（可传完整 ID、短 ID、类目名称或完整路径）`);
  }
  for (const node of selectedLeaves) {
    const rootId = node.pathIds[Math.min(groupDepth, node.pathIds.length) - 1] ?? node.id;
    const values = leafGroups.get(rootId) ?? [];
    values.push(node);
    leafGroups.set(rootId, values);
  }
  const byId = categoryById(document);
  const fullContextByRoot = new Map(makeContextChunks(document, groupDepth).map((chunk) => [chunk.rootId, chunk.text]));
  const batches: Batch[] = [];
  for (const [rootId, leaves] of leafGroups) {
    for (let offset = 0; offset < leaves.length; offset += batchSize) {
      const nodes = leaves.slice(offset, offset + batchSize);
      const ids = new Set(nodes.flatMap((node) => node.pathIds));
      const subset = document.nodes.filter((node) => ids.has(node.id));
      const root = byId.get(rootId) ?? nodes[0]!;
      const lines = subset.map((node) => `${"  ".repeat(node.level - 1)}${node.level}${node.isLeaf ? "*" : "+"} ${node.name}|i=${shortCategoryId(node.id)}`);
      const subsetText = `#STD-CAT|v=${document.version}|target=${nodes.length}\n#PATH|${JSON.stringify(root.pathNames)}\n${lines.join("\n")}\n`;
      batches.push({
        key: `${slugify(root.pathNames.join("-"))}-${offset / batchSize + 1}`,
        rootId,
        nodes,
        // 全量运行时使用整个类目组作为固定前缀；单类目调试仍使用精简上下文，避免无谓扩大输入。
        text: !categorySelector || selectedLeaves.length > batchSize
          ? fullContextByRoot.get(rootId) ?? subsetText
          : subsetText,
        // 动态证据放在目标类目之后，避免改变固定类目树前缀，尽量保留 KV 缓存命中。
        referenceText: buildJdEvidenceText(nodes, jdEvidence),
      });
    }
  }
  // 交错不同类目组的首批请求，让每个固定前缀先有机会落盘，再并发发送同组后续批次。
  const byRoot = new Map<string, Batch[]>();
  for (const batch of batches) (byRoot.get(batch.rootId) ?? byRoot.set(batch.rootId, []).get(batch.rootId)!).push(batch);
  const ordered: Batch[] = [];
  const batchGroups = [...byRoot.values()];
  for (let index = 0; ; index += 1) {
    let added = false;
    for (const group of batchGroups) {
      const batch = group[index];
      if (batch) {
        ordered.push(batch);
        added = true;
      }
    }
    if (!added) break;
  }
  return ordered;
}

function parseContent(content: string | null | undefined): string {
  if (!content) throw new Error("模型返回空 content");
  return content;
}

export async function importAndBuildContext(options: {
  database: SQL;
  inputPath: string;
  version: string;
  workspace?: string;
  groupDepth: number;
}): Promise<{ document: CategoryTreeDocument; importId: number; contextDir: string }> {
  const raw = await readJsonFile<unknown>(options.inputPath);
  const rawText = await readTextFile(options.inputPath);
  const { normalizeCategories } = await import("./category-tree.ts");
  const document = normalizeCategories(raw, options.version);
  document.sourcePath = options.inputPath;
  document.sourceSha256 = createHash("sha256").update(rawText).digest("hex");
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const meta = raw as Record<string, unknown>;
    document.sourceUrl = typeof meta.sourceUrl === "string" ? meta.sourceUrl : undefined;
    document.bucket = typeof meta.bucket === "string" ? meta.bucket : undefined;
    document.fetchedAt = typeof meta.fetchedAt === "string" ? meta.fetchedAt : undefined;
  }
  const { insertCategoryDocument } = await import("./storage.ts");
  const importId = await insertCategoryDocument(options.database, document, options.inputPath);
  const { dir: contextDir } = await writeContextBundle(
    document,
    options.workspace ?? workspaceRoot(),
    options.groupDepth,
    { importId },
  );
  return { document, importId, contextDir };
}

export async function runGovernance(options: {
  database: SQL;
  ai: AiService;
  workspace?: string;
  version: string;
  groupDepth: number;
  batchSize: number;
  concurrency: number;
  attempts: number;
  dryRun: boolean;
  provider: string;
  model: string;
  categorySelector?: string;
  jdEvidencePath?: string;
  jdEvidenceEnabled?: boolean;
  retryRunId?: string;
  retryBatchSize?: number;
  onProgress?: (progress: {
    completed: number;
    total: number;
    success: number;
    errors: number;
  }) => void;
}): Promise<{
  requestCount: number;
  successCount: number;
  errorCount: number;
  outputDir: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptCacheHitTokens: number;
  promptCacheMissTokens: number;
  recoveredCategoryCount: number;
  failedCategoryCount: number;
}> {
  if (options.version !== "v1") {
    throw new Error(`数据库目前只初始化了 *_v1 表；治理 ${options.version} 前请新增对应版本迁移`);
  }
  const rootDir = options.workspace ?? workspaceRoot();
  const document = await readContextDocument(rootDir, options.version);
  const inputSource = {
    path: document.sourcePath ?? null,
    sha256: document.sourceSha256 ?? null,
    importId: document.importId ?? null,
    contextPath: join(rootDir, "context", options.version, "category-tree.json"),
    contextSha256: createHash("sha256").update(JSON.stringify(document)).digest("hex"),
  };
  console.log(`输入上下文：${inputSource.contextPath}`);
  console.log(`输入来源：${inputSource.path ?? "未记录"}，import_id=${inputSource.importId ?? "未记录"}，SHA-256=${inputSource.sha256 ?? "未记录"}`);
  const evidencePath = options.jdEvidenceEnabled === false
    ? null
    : await findJdEvidencePath(rootDir, options.version, options.jdEvidencePath);
  const jdEvidence = evidencePath ? await loadJdEvidence(evidencePath) : undefined;
  if (evidencePath) {
    console.log(`京东参考证据：${evidencePath}，类目 ${jdEvidence?.categories.length ?? 0}`);
  } else {
    console.log("京东参考证据：未启用（可放置 context/<version>/jd-attribute-evidence.json 后自动加载）");
  }
  const outputRootDir = outputPath(rootDir, options.version);
  let batches = options.retryRunId ? [] : groupBatches(document, options.groupDepth, options.batchSize, options.categorySelector, jdEvidence);
  let retryPlan: GovernanceRetryPlan | undefined;
  if (options.retryRunId) {
    if (options.categorySelector) throw new Error("--retry-run 按历史失败记录选择类目，不能同时使用 --category");
    const retryBatchSize = options.retryBatchSize ?? 4;
    if (!Number.isInteger(retryBatchSize) || retryBatchSize < 1) throw new Error("retry-batch-size 必须是正整数");
    retryPlan = await planGovernanceRetry({ outputRoot: outputRootDir, runId: options.retryRunId, document, contextSha256: inputSource.contextSha256 });
    if (retryPlan.groups.length === 0) throw new Error(`run-${retryPlan.runId} 没有需要补跑的类目`);
    const contexts = new Map(makeContextChunks(document, retryPlan.groupDepth).map((chunk) => [chunk.rootId, chunk.text]));
    batches = retryPlan.groups.flatMap((group) => {
      const pending = group.nodes.filter((node) => !retryPlan!.recovered.has(node.id));
      const chunks: Batch[] = [];
      for (let offset = 0; offset < pending.length; offset += retryBatchSize) {
        const nodes = pending.slice(offset, offset + retryBatchSize);
        const rootId = nodes[0]!.pathIds[Math.min(retryPlan!.groupDepth, nodes[0]!.pathIds.length) - 1]!;
        const text = contexts.get(rootId);
        if (!text) throw new Error(`缺少失败类目的固定上下文：${rootId}`);
        chunks.push({ key: `${group.key}-retry-${offset / retryBatchSize + 1}`, rootId, nodes, text, referenceText: buildJdEvidenceText(nodes, jdEvidence), repairError: group.error });
      }
      return chunks;
    });
    console.log(`补跑 run-${retryPlan.runId}：目标 ${retryPlan.groups.reduce((count, group) => count + group.nodes.length, 0)} 个类目，本地恢复 ${retryPlan.recovered.size} 个，剩余 ${batches.reduce((count, batch) => count + batch.nodes.length, 0)} 个，分 ${batches.length} 个请求（每次最多 ${retryBatchSize} 类目）`);
  }
  const targetCategoryCount = retryPlan ? retryPlan.groups.reduce((count, group) => count + group.nodes.length, 0) : batches.reduce((count, batch) => count + batch.nodes.length, 0);
  const groupDepth = retryPlan?.groupDepth ?? options.groupDepth;
  // 输出按运行批次归档；groupDepth 只属于输入分片配置，不再成为结果目录层级。
  const runRows = await options.database<{ id: number }[]>`
    INSERT INTO governance_runs_v1 (version, provider, model, group_depth, status, request_count, output_dir)
    VALUES (${options.version}, ${options.provider}, ${options.model}, ${groupDepth}, 'running', ${batches.length}, ${outputRootDir})
    RETURNING id
  `;
  const runId = runRows[0]?.id;
  if (!runId) throw new Error("创建治理运行记录失败");
  const outputDir = join(outputRootDir, `run-${runId}`);
  await options.database`
    UPDATE governance_runs_v1 SET output_dir=${outputDir} WHERE id=${runId}
  `;
  const allResults: GovernanceResult[] = [];
  const errors: Array<{ key: string; attempt: number; error: string; categoryIds: string[] }> = [];
  const attemptErrors: Array<{ key: string; attempt: number; error: string }> = [];
  let requestCount = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let promptCacheHitTokens = 0;
  let promptCacheMissTokens = 0;
  let completedBatches = 0;
  let recoveredCategoryCount = 0;
  const markProgress = (): void => {
    completedBatches += 1;
    options.onProgress?.({
      completed: completedBatches,
      total: batches.length,
      success: allResults.length,
      errors: errors.length,
    });
  };

  // 每批只保留一个合格结果文件，逐次追加新成功类目，避免导出遗漏或共识重复计票。
  const persistResults = async (key: string, results: GovernanceResult[], rawText: string, attempt: number,
    accumulated: GovernanceResult[], provenance: Record<string, unknown>): Promise<void> => {
    if (results.length === 0) return;
    // 存储错误向上抛出，不能被误当成模型错误而触发付费重试。
    await options.database.begin(async (tx) => {
      for (const result of results) {
        await tx`
          INSERT INTO attribute_templates_v1 (run_id, version, category_id, category_path_json, attempt, template_json, raw_response, validation_status)
          VALUES (${runId}, ${document.version}, ${result.category.id}, ${result.category.path}::jsonb, ${attempt}, ${result}::jsonb, ${rawText}, 'valid')
        `;
      }
    });
    accumulated.push(...results);
    await writeJsonFile(join(outputDir, key, "results.json"), {
      ...compactTemplates(accumulated), meta: { runId, batch: key, source: inputSource, provenance },
    }, { pretty: false, trailingNewline: true });
    allResults.push(...results);
  };

  if (retryPlan && !options.dryRun) {
    for (const group of retryPlan.groups) {
      const accumulated: GovernanceResult[] = [];
      const provenance: Record<string, unknown> = {};
      const byResponse = new Map<string, RecoveredGovernanceResult[]>();
      for (const node of group.nodes) {
        const recovered = retryPlan.recovered.get(node.id);
        if (!recovered) continue;
        provenance[node.id] = { ...recovered.source, recovered: true };
        const values = byResponse.get(recovered.source.path) ?? [];
        values.push(recovered);
        byResponse.set(recovered.source.path, values);
      }
      for (const values of byResponse.values()) {
        await persistResults(`${group.key}-recovered`, values.map((value) => value.result), values[0]!.rawText, 0, accumulated, provenance);
        recoveredCategoryCount += values.length;
      }
    }
  }
  const processBatch = async (batch: Batch): Promise<void> => {
    const requestDir = join(outputDir, batch.key);
    let lastError = batch.repairError ?? "";
    let pending = batch.nodes;
    const accumulated: GovernanceResult[] = [];
    const provenance: Record<string, unknown> = {};
    for (let attempt = 1; attempt <= Math.max(1, options.attempts); attempt += 1) {
      let rawText = "";
      let finishReason: string | null = null;
      let responseUsage: unknown = null;
      let parsed: ReturnType<typeof parseGovernanceResponsePartial> | undefined;
      const attemptNodes = pending;
      const requestPath = join(requestDir, `attempt-${String(attempt).padStart(3, "0")}.request.json`);
      const prompt = buildGovernanceUserPrompt({
        version: document.version,
        categoryText: batch.text,
        targetCategories: attemptNodes,
        referenceText: buildJdEvidenceText(attemptNodes, jdEvidence),
        repairError: lastError || undefined,
      });
      await writeJsonFile(requestPath, {
        system: CATEGORY_GOVERNANCE_SYSTEM_PROMPT,
        user: prompt,
        categoryIds: attemptNodes.map((node) => node.id),
        source: inputSource,
        jdEvidencePath: evidencePath,
        jdEvidence: buildJdEvidenceText(attemptNodes, jdEvidence) || null,
        attempt,
      });
      if (options.dryRun) {
        requestCount += 1;
        markProgress();
        return;
      }
      try {
        requestCount += 1;
        const response = await options.ai.chat(options.provider, options.model, {
          messages: [
            { role: "system", content: CATEGORY_GOVERNANCE_SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
          temperature: 0.2,
          // 小批次不需要 32K 输出，限制重复字段失控时的花费。
          max_tokens: Math.min(32_000, 2_048 + attemptNodes.length * 1_536),
          response_format: { type: "json_object" },
          thinking: { type: "disabled" },
        });
        promptTokens += response.usage?.prompt_tokens ?? 0;
        completionTokens += response.usage?.completion_tokens ?? 0;
        totalTokens += response.usage?.total_tokens ?? 0;
        promptCacheHitTokens += response.usage?.prompt_cache_hit_tokens ?? 0;
        promptCacheMissTokens += response.usage?.prompt_cache_miss_tokens ?? 0;
        finishReason = response.choices[0]?.finish_reason ?? null;
        responseUsage = response.usage ?? null;
        rawText = parseContent(response.choices[0]?.message.content);
        parsed = parseGovernanceResponsePartial(rawText, attemptNodes);
        lastError = parsed.errors.map((item) => `${shortCategoryId(item.categoryId)}: ${item.error}`).join("；");
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      if (parsed?.results.length) {
        for (const result of parsed.results) provenance[result.category.id] = { attempt, repairedClosingDelimiters: parsed.repairedClosingDelimiters };
        await persistResults(batch.key, parsed.results, rawText, attempt, accumulated, provenance);
        const accepted = new Set(parsed.results.map((result) => result.category.id));
        pending = pending.filter((node) => !accepted.has(node.id));
      }
      if (pending.length === 0) { markProgress(); return; }
      if (lastError) {
        attemptErrors.push({ key: batch.key, attempt, error: lastError });
        await writeJsonFile(join(requestDir, `attempt-${String(attempt).padStart(3, "0")}.error.json`), {
          error: lastError,
          runId,
          batch: batch.key,
          attempt,
          finishReason,
          usage: responseUsage,
          categoryIds: pending.map((node) => node.id),
          acceptedCategoryIds: parsed?.results.map((result) => result.category.id) ?? [],
          categoryErrors: parsed?.errors ?? [],
          rawBytes: rawText.length,
          source: inputSource,
        });
        // 将模型原文保存下来，便于分析 JSON 或字段校验失败的真实原因。
        try {
          if (rawText) await writeTextFile(join(requestDir, `attempt-${String(attempt).padStart(3, "0")}.raw.txt`), rawText);
        } catch {
          // 诊断文件写入失败不影响重试流程。
        }
      }
    }
    errors.push({ key: batch.key, attempt: Math.max(1, options.attempts), error: lastError || "未知错误", categoryIds: pending.map((node) => node.id) });
    markProgress();
  };

  const runPhase = async (phase: Batch[], concurrency: number): Promise<void> => {
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < phase.length) {
        const batch = phase[cursor++];
        if (!batch) return;
        await processBatch(batch);
      }
    };
    await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), Math.max(1, phase.length)) }, () => worker()));
  };

  const firstByRoot = new Set<string>();
  const warmupBatches: Batch[] = [];
  const remainingBatches: Batch[] = [];
  for (const batch of batches) {
    if (!firstByRoot.has(batch.rootId)) {
      firstByRoot.add(batch.rootId);
      warmupBatches.push(batch);
    } else {
      remainingBatches.push(batch);
    }
  }
  // 先为每个固定前缀发一个请求，等待缓存落盘后再开启高并发批量治理。
  await runPhase(warmupBatches, Math.min(options.concurrency, 32));
  await runPhase(remainingBatches, options.concurrency);
  const status = options.dryRun ? "dry_run" : errors.length === 0 ? "completed" : allResults.length > 0 ? "partial" : "failed";
  await options.database`
    UPDATE governance_runs_v1 SET status=${status}, request_count=${requestCount}, success_count=${allResults.length}, error_count=${errors.length}, finished_at=NOW() WHERE id=${runId}
  `;
  await writeJsonFile(join(outputDir, "manifest.json"), {
    runId, version: document.version, provider: options.provider, model: options.model,
    groupDepth, batchSize: options.batchSize, attempts: options.attempts,
    categorySelector: options.categorySelector ?? null,
    retryRunId: retryPlan?.runId ?? null,
    retryBatchSize: retryPlan ? options.retryBatchSize ?? 4 : null,
    targetCategoryCount, recoveredCategoryCount,
    failedCategoryCount: errors.reduce((count, error) => count + error.categoryIds.length, 0),
    recoverySourceRuns: retryPlan?.inspectedRunIds ?? [],
    jdEvidencePath: evidencePath,
    source: inputSource,
    requestCount, successCount: allResults.length, errorCount: errors.length, errors, attemptErrors,
    usage: {
      promptTokens, completionTokens, totalTokens,
      promptCacheHitTokens, promptCacheMissTokens,
    },
  });
  return {
    requestCount,
    successCount: allResults.length,
    errorCount: errors.length,
    outputDir,
    promptTokens,
    completionTokens,
    totalTokens,
    promptCacheHitTokens,
    promptCacheMissTokens,
    recoveredCategoryCount,
    failedCategoryCount: errors.reduce((count, error) => count + error.categoryIds.length, 0),
  };
}

async function jsonFilesUnder(directory: string): Promise<string[]> {
  const files: string[] = [];
  let entries: Array<import("node:fs").Dirent>;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await jsonFilesUnder(path));
    else if (entry.name.endsWith(".json") && !entry.name.includes("request") && !entry.name.includes("manifest")) files.push(path);
  }
  return files;
}

export async function mergeGovernanceOutput(options: {
  workspace?: string;
  version: string;
  groupDepth: number;
  runId?: string;
}): Promise<string> {
  const rootDir = options.workspace ?? workspaceRoot();
  const document = await readContextDocument(rootDir, options.version);
  const byId = categoryById(document);
  const outputRootDir = outputPath(rootDir, options.version);
  const directRun = (runId: string): string => join(outputRootDir, `run-${runId}`);
  const legacyRun = (runId: string): string => join(outputRootDir, `level-${options.groupDepth}`, `run-${runId}`);
  const exists = async (path: string): Promise<boolean> => {
    try {
      await readdir(path);
      return true;
    } catch {
      return false;
    }
  };
  let outputDir = options.runId ? directRun(options.runId) : outputRootDir;
  if (options.runId && !(await exists(outputDir))) outputDir = legacyRun(options.runId);
  if (!options.runId) {
    try {
      const directEntries = await readdir(outputRootDir, { withFileTypes: true });
      const directRuns = directEntries
        .filter((entry) => entry.isDirectory() && /^run-\d+$/u.test(entry.name))
        .map((entry) => entry.name)
        .sort((a, b) => Number(b.slice(4)) - Number(a.slice(4)));
      if (directRuns[0]) outputDir = join(outputRootDir, directRuns[0]);
      else {
        const legacyRuns: Array<{ name: string; path: string }> = [];
        for (const entry of directEntries.filter((item) => item.isDirectory() && /^level-\d+$/u.test(item.name))) {
          const levelEntries = await readdir(join(outputRootDir, entry.name), { withFileTypes: true });
          legacyRuns.push(...levelEntries
            .filter((item) => item.isDirectory() && /^run-\d+$/u.test(item.name))
            .map((item) => ({ name: item.name, path: join(outputRootDir, entry.name, item.name) })));
        }
        const latestLegacy = legacyRuns.sort((a, b) => Number(b.name.slice(4)) - Number(a.name.slice(4)))[0];
        if (latestLegacy) outputDir = latestLegacy.path;
      }
    } catch {
      // 没有可用运行目录时保持版本根目录，兼容最早的旧输出。
    }
  }
  const files = await jsonFilesUnder(outputDir);
  const resultsByCategory = new Map<string, GovernanceResult[]>();
  for (const file of files) {
    const compact = await readJsonFile<Record<string, unknown>>(file);
    if (!compact.a || !compact.c) continue;
    const ids = Object.keys(compact.c as Record<string, unknown>);
    const targets = ids.map((id) => byId.get(id)).filter((node): node is CategoryNode => Boolean(node));
    if (targets.length !== ids.length) throw new Error(`结果包含未导入的类目：${file}`);
    for (const result of parseGovernanceResponse(JSON.stringify(compact), targets)) {
      const values = resultsByCategory.get(result.category.id) ?? [];
      values.push(result);
      resultsByCategory.set(result.category.id, values);
    }
  }
  const merged = [...resultsByCategory.values()].map((results) => mergeGovernanceResults(results));
  const path = join(outputDir, "merged-v1.json");
  await writeJsonFile(path, { ...compactTemplates(merged), meta: { categories: merged.length, sourceFiles: files.length } });
  return path;
}

export async function runCommand(context: { args: string[]; database: SQL; ai: AiService }): Promise<void> {
  const { positionals, flags } = parseFlags(context.args);
  const command = positionals.shift() ?? "help";
  const rootDir = flags.workspace ?? workspaceRoot();
  // 内部深度从根节点 1 开始；深度 2 正好对应接口的一级子类，适合作为默认分片边界。
  const groupDepth = asInt(flags["group-depth"], 2);
  switch (command) {
    case "count": {
      const input = positionals[0];
      if (!input) throw new Error("用法：count <raw.json>");
      const raw = await readJsonFile<unknown>(input);
      const { normalizeCategories } = await import("./category-tree.ts");
      const document = normalizeCategories(raw, flags.version ?? "v1");
      // 三横完整接口的 level 从根类目 0 开始；内部树为了兼容通用文本格式从 1 开始，
      // 因此四级统计优先读取接口 level，回退时用路径长度减一。
      const levelOf = (node: CategoryNode): number => {
        const sourceLevel = (node.payload as Record<string, unknown>).level;
        return typeof sourceLevel === "number" ? sourceLevel : Math.max(0, node.pathIds.length - 1);
      };
      const level4 = document.nodes.filter((node) => levelOf(node) === 4).length;
      console.log(`类目总数：${document.nodes.length}，末级类目：${document.leafCount}，四级类目（接口 level=4）：${level4}`);
      return;
    }
    case "pipeline": {
      const input = positionals[0];
      if (!input) throw new Error("用法：pipeline <raw.json> [--version=v1] [--group-depth=2] [--dry-run]");
      const version = flags.version ?? "v1";
      const imported = await importAndBuildContext({ database: context.database, inputPath: input, version, workspace: rootDir, groupDepth });
      console.log(`已导入 ${imported.document.nodes.length} 个类目，开始治理`);
      const result = await runGovernance({
        database: context.database, ai: context.ai, workspace: rootDir, version,
        groupDepth, batchSize: asInt(flags["batch-size"], 12), concurrency: asInt(flags.concurrency, 4),
        attempts: asInt(flags.attempts, 1), dryRun: boolFlag(flags["dry-run"]),
        provider: flags.provider ?? "deepseek", model: flags.model ?? "flash",
        categorySelector: flags.category ?? flags["category-id"],
        jdEvidencePath: flags["jd-evidence"],
        jdEvidenceEnabled: !boolFlag(flags["no-jd-evidence"]),
      });
      console.log(`治理完成：请求 ${result.requestCount}，成功类目 ${result.successCount}，失败请求 ${result.errorCount}`);
      console.log(`Token：输入 ${result.promptTokens}，输出 ${result.completionTokens}，合计 ${result.totalTokens}`);
      return;
    }
    case "import": {
      const input = positionals[0];
      if (!input) throw new Error("用法：import <raw.json> [--version=v1] [--group-depth=2]");
      const version = flags.version ?? "v1";
      const result = await importAndBuildContext({ database: context.database, inputPath: input, version, workspace: rootDir, groupDepth });
      console.log(`已导入 ${result.document.nodes.length} 个类目（末级 ${result.document.leafCount}），import_id=${result.importId}`);
      console.log(`上下文：${result.contextDir}`);
      return;
    }
    case "context": {
      const input = positionals[0];
      if (!input) throw new Error("用法：context <category-tree.json> [--version=v1] [--group-depth=2]");
      const document = await readJsonFile<CategoryTreeDocument>(input);
      const version = flags.version ?? document.version ?? "v1";
      document.version = version;
      const result = await writeContextBundle(document, rootDir, groupDepth);
      console.log(`已生成 ${result.chunks.length} 个压缩上下文：${result.dir}`);
      return;
    }
    case "govern": {
      const version = flags.version ?? "v1";
      const result = await runGovernance({
        database: context.database, ai: context.ai, workspace: rootDir, version,
        groupDepth, batchSize: asInt(flags["batch-size"], 12), concurrency: asInt(flags.concurrency, 4),
        attempts: asInt(flags.attempts, 1), dryRun: boolFlag(flags["dry-run"]),
        provider: flags.provider ?? "deepseek", model: flags.model ?? "flash",
        categorySelector: flags.category ?? flags["category-id"],
        jdEvidencePath: flags["jd-evidence"],
        jdEvidenceEnabled: !boolFlag(flags["no-jd-evidence"]),
      });
      console.log(`治理完成：请求 ${result.requestCount}，成功类目 ${result.successCount}，失败请求 ${result.errorCount}`);
      console.log(`Token：输入 ${result.promptTokens}，输出 ${result.completionTokens}，合计 ${result.totalTokens}`);
      console.log(`输出：${result.outputDir}`);
      return;
    }
    case "merge": {
      const version = flags.version ?? "v1";
      const path = await mergeGovernanceOutput({ workspace: rootDir, version, groupDepth, runId: flags["run-id"] });
      console.log(`已合并治理结果：${path}`);
      return;
    }
    case "to-std": {
      const input = positionals[0];
      const output = positionals[1];
      if (!input || !output) throw new Error("用法：to-std <category-tree.json> <output.std.txt>");
      const document = await readJsonFile<CategoryTreeDocument>(input);
      const { toStdText } = await import("./std-text.ts");
      const { writeTextFile } = await import("../../facilities/json/files.ts");
      await writeTextFile(output, toStdText(document));
      console.log(`已生成：${output}`);
      return;
    }
    case "help":
      console.log("count <raw.json>、pipeline <raw.json>、import <raw.json>、context <category-tree.json>、govern、merge、to-std");
      return;
    default:
      throw new Error(`未知类目治理命令：${command}`);
  }
}
