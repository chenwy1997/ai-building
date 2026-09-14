import { join, resolve } from "node:path";
import { readdir } from "node:fs/promises";
import { AiService } from "../../ai/service.ts";
import { loadAppConfig } from "../../config/env.ts";
import { PostgresAiCatalog } from "../../data/ai-catalog.ts";
import { DatabaseHub } from "../../platform/database/index.ts";
import { readJsonFile, writeJsonFile, writeTextFile } from "../../facilities/json/files.ts";
import { parseFlags, asInt, boolFlag, slugify, shortCategoryId, parseGovernanceConcurrency } from "./util.ts";
import { readContextDocument, workspaceRoot } from "./storage.ts";
import { loadJdEvidence, buildJdEvidenceText, type JdEvidenceDocument } from "./jd-evidence.ts";
import { addSemanticReviewUsage, applySemanticReviews, buildSemanticReviewPrompt, emptySemanticReviewUsage, mergeSemanticReviewErrors, mergeSemanticReviews, parseSemanticReviewResponse, semanticCategoryChanged, SEMANTIC_REVIEW_SYSTEM_PROMPT, type SemanticReviewDocument, type SemanticReviewError, type SemanticReviewResult, type SemanticReviewUsage } from "./semantic-review.ts";
import type { AttributeConsensusDocument, CategoryConsensus } from "./consensus.ts";
import type { CategoryNode } from "./types.ts";

const HELP = `
用大模型对多批次属性候选做语义终审

用法：
  bun run category-governance:semantic-review --category="手机" --limit=1 --direct
  bun run category-governance:semantic-review --limit=30 --concurrency=4 --direct
  bun run category-governance:semantic-review --all --concurrency=128 --direct
  bun run category-governance:semantic-review --all --concurrency=max --direct

参数：
  --category=...       只审阅指定类目名称、完整路径、完整 ID 或短 ID
  --limit=10           从候选库中最多审阅 N 个类目，不会自动生成候选；未指定范围时默认 10
  --all                明确允许审阅全部共识类目
  --failed-only        只重试稳定审阅文件中上次失败的类目
  --unreviewed-only    只审阅稳定文件中尚未有终审结果的新类目
  --changed-only       只审阅相对已冻结候选基线发生属性变化的类目
  --replay-run=...     只解析已保存的某次运行响应，不调用模型、不产生 API 费用
  --concurrency=64     并发请求数；auto 为 64，max 为 2500，可显式指定 1–2500
  --attempts=2         单类目失败重试次数
  --consensus=...      共识文件路径，默认 output/<version>/consensus/attribute-candidates-v1.json
  --jd-evidence=...    京东证据路径，默认 context/<version>/jd-attribute-evidence.json
  --provider=deepseek  AI 服务商
  --model=flash        AI 模型别名
  --dry-run             只生成审阅请求，不调用模型
  --direct              当前进程直连 AI API
  --workspace=...       覆盖类目治理 workspace
  --version=v1          类目上下文版本
`.trim();

function disableProxy(): void {
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) delete process.env[key];
  process.env.NO_PROXY = "*";
  process.env.no_proxy = "*";
}

interface ReplayResult {
  reviews: SemanticReviewResult[];
  errors: SemanticReviewError[];
  usage: SemanticReviewUsage;
  responseCount: number;
}

/** 从本地原始响应中恢复结果。每个类目选最后一个能通过当前协议的尝试。 */
async function replaySavedResponses(runDir: string, categories: CategoryConsensus[]): Promise<ReplayResult> {
  const wanted = new Set(categories.map((item) => item.category.id));
  const reviews: SemanticReviewResult[] = [];
  const errors: SemanticReviewError[] = [];
  const usage = emptySemanticReviewUsage();
  let responseCount = 0;
  const entries = await readdir(runDir, { withFileTypes: true });
  for (const entry of entries.filter((item) => item.isDirectory())) {
    const requestPath = join(runDir, entry.name, "request.json");
    try {
      const request = await readJsonFile<{ categoryId: string }>(requestPath);
      if (!wanted.has(request.categoryId)) continue;
      const category = categories.find((item) => item.category.id === request.categoryId)!;
      const responses = (await readdir(join(runDir, entry.name)))
        .filter((name) => /^attempt-\d+\.response\.json$/u.test(name)).sort();
      let lastError = "没有可解析的已保存响应";
      let recovered: SemanticReviewResult | undefined;
      for (const name of responses) {
        const responsePath = join(runDir, entry.name, name);
        const response = await readJsonFile<any>(responsePath);
        responseCount += 1;
        addSemanticReviewUsage(usage, response.usage);
        const content = typeof response.choices?.[0]?.message?.content === "string" ? response.choices[0].message.content.trim() : "";
        if (!content) { lastError = "模型返回空 content"; continue; }
        try {
          recovered = { ...parseSemanticReviewResponse(content, category), provenance: { requestPath, responsePath } };
          lastError = "";
        } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
      }
      if (recovered) reviews.push(recovered);
      else errors.push({ categoryId: request.categoryId, error: lastError });
    } catch (error) {
      errors.push({ categoryId: entry.name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { reviews, errors, usage, responseCount };
}

function matches(node: CategoryNode, selector: string): boolean {
  const value = selector.trim().toLocaleLowerCase();
  return node.id.toLocaleLowerCase() === value || shortCategoryId(node.id).toLocaleLowerCase() === value
    || node.pathNames.some((name) => name.toLocaleLowerCase() === value)
    || node.pathNames.join("/").toLocaleLowerCase() === value
    || node.pathNames.join(">").toLocaleLowerCase() === value;
}

function runStamp(): string {
  return new Date().toISOString().replace(/[-:]/gu, "").replace(".", "-");
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
  const consensusPath = flags.consensus ?? join(workspace, "output", version, "consensus", "attribute-candidates-v1.json");
  const consensus = await readJsonFile<AttributeConsensusDocument>(consensusPath);
  const context = await readContextDocument(workspace, version);
  const stableReviewPath = join(workspace, "output", version, "semantic-review", "attribute-reviews-v1.json");
  const byId = new Map(context.nodes.map((node) => [node.id, node]));
  const selector = flags.category ?? flags["category-id"];
  const failedOnly = boolFlag(flags["failed-only"]);
  const unreviewedOnly = boolFlag(flags["unreviewed-only"]);
  const changedOnly = boolFlag(flags["changed-only"]);
  let baselineById: Map<string, CategoryConsensus> | undefined;
  if (changedOnly) {
    const baselinePath = join(workspace, "output", version, "baseline", "attribute-candidates-v1.json");
    try {
      const baseline = await readJsonFile<AttributeConsensusDocument>(baselinePath);
      baselineById = new Map(baseline.categories.map((item) => [item.category.id, item]));
    } catch { throw new Error(`--changed-only 找不到已冻结候选基线：${baselinePath}`); }
  }
  let stableReviewForSelection: SemanticReviewDocument | undefined;
  try { stableReviewForSelection = await readJsonFile<SemanticReviewDocument>(stableReviewPath); } catch { /* 首次运行 */ }
  let failedIds: Set<string> | undefined;
  if (failedOnly) {
    if (!stableReviewForSelection) throw new Error("--failed-only 找不到稳定语义审阅文件");
    failedIds = new Set((stableReviewForSelection.errors ?? []).map((item) => item.categoryId));
    if (failedIds.size === 0) throw new Error("当前没有失败的语义审阅类目");
  }
  const reviewedIds = unreviewedOnly ? new Set((stableReviewForSelection?.reviews ?? []).map((item) => item.categoryId)) : undefined;
  const candidateCategories = consensus.categories.filter((category) => {
    const node = byId.get(category.category.id);
    return node && (!selector || matches(node, selector)) && (!failedIds || failedIds.has(category.category.id)) && (!reviewedIds || !reviewedIds.has(category.category.id)) && (!baselineById || semanticCategoryChanged(category, baselineById.get(category.category.id)));
  });
  if (candidateCategories.length === 0) throw new Error("没有找到可审阅的共识类目");
  if (boolFlag(flags.all) && flags.limit !== undefined) throw new Error("--all 和 --limit 不能同时指定");
  const requestedLimit = flags.limit !== undefined ? asInt(flags.limit, 10) : boolFlag(flags.all) || selector || failedOnly || unreviewedOnly || changedOnly ? undefined : 10;
  const categories = requestedLimit === undefined ? candidateCategories : candidateCategories.slice(0, requestedLimit);
  if (categories.length === 0) throw new Error("没有需要审阅的类目；可使用 --all");
  const concurrency = parseGovernanceConcurrency(flags.concurrency ?? Bun.env.CATEGORY_GOVERNANCE_CONCURRENCY);
  const workerCount = Math.min(concurrency, categories.length);
  const inputSummary = {
    sourceConsensus: consensusPath,
    sourceRuns: consensus.sourceRuns,
    consensusCategoryCount: consensus.categories.length,
    matchedCategoryCount: candidateCategories.length,
    requestedLimit: requestedLimit ?? null,
    concurrency,
    workerCount,
    failedOnly,
    unreviewedOnly,
    changedOnly,
    categoryIds: categories.map((item) => item.category.id),
  };
  console.log(`候选库：${consensusPath}（来源 ${consensus.sourceRuns.map((id) => `run-${id}`).join(", ")}）`);
  console.log(`候选类目 ${consensus.categories.length}，匹配 ${candidateCategories.length}，本次审阅 ${categories.length}${requestedLimit === undefined ? "" : `（上限 ${requestedLimit}）`}`);
  console.log(`并发：配置 ${concurrency}，本次并发上限 ${workerCount}；思考模式已关闭`);
  if (requestedLimit !== undefined && candidateCategories.length < requestedLimit) {
    console.warn(`候选不足：当前范围只有 ${candidateCategories.length} 个类目。--limit 只限制数量；扩大范围前请用 category-governance:consensus 汇总包含更多类目的已有批次。`);
  }
  const evidencePath = flags["jd-evidence"] ?? join(workspace, "context", version, "jd-attribute-evidence.json");
  let evidence: JdEvidenceDocument | undefined;
  try { evidence = await loadJdEvidence(evidencePath); } catch { /* 京东证据可选 */ }
  const runDir = join(workspace, "output", version, "semantic-review", `run-${runStamp()}`);
  const stableTemplatePath = join(workspace, "output", version, "semantic-review", "attribute-templates-v1.json");
  const provider = flags.provider ?? "deepseek";
  const model = flags.model ?? "flash";
  const attempts = asInt(flags.attempts, 2);
  const dryRun = boolFlag(flags["dry-run"]);
  const replayFlag = flags["replay-run"];
  const replayRunDir = replayFlag ? (replayFlag.includes("/") ? resolve(replayFlag) : join(workspace, "output", version, "semantic-review", replayFlag)) : undefined;
  if (replayRunDir) {
    const replay = await replaySavedResponses(replayRunDir, categories);
    const stablePrevious = await (async () => { try { return await readJsonFile<SemanticReviewDocument>(stableReviewPath); } catch { return undefined; } })();
    const mergedReviews = mergeSemanticReviews(stablePrevious?.reviews ?? [], replay.reviews);
    const mergedErrors = mergeSemanticReviewErrors(stablePrevious?.errors ?? [], replay.errors, replay.reviews);
    const reviewDocument: SemanticReviewDocument = { version: "semantic-review-v1", generatedAt: new Date().toISOString(), sourceConsensus: consensusPath, reviews: mergedReviews, usage: emptySemanticReviewUsage(), errors: mergedErrors };
    const templates = applySemanticReviews(consensus, mergedReviews);
    await writeJsonFile(stableReviewPath, reviewDocument);
    await writeJsonFile(stableTemplatePath, templates);
    const runDir = join(workspace, "output", version, "semantic-review", `run-${runStamp()}-replay`);
    await writeJsonFile(join(runDir, "manifest.json"), { runDir, replayRunDir, ...inputSummary, categoryCount: categories.length, successCount: replay.reviews.length, errorCount: replay.errors.length, mergedReviewCount: mergedReviews.length, previousReviewCount: stablePrevious?.reviews.length ?? 0, responseCount: replay.responseCount, sourceResponseUsage: replay.usage, usage: emptySemanticReviewUsage(), apiRequests: 0 });
    await writeJsonFile(join(runDir, "attribute-reviews-v1.json"), { ...reviewDocument, reviews: replay.reviews, errors: replay.errors });
    await writeJsonFile(join(runDir, "attribute-templates-v1.json"), templates);
    console.log(`本地恢复完成：成功 ${replay.reviews.length}，失败 ${replay.errors.length}，解析已保存响应 ${replay.responseCount}`);
    console.log(`本次 API 请求 0；源响应用量：输入 ${replay.usage.promptTokens}，输出 ${replay.usage.completionTokens}，缓存命中 ${replay.usage.promptCacheHitTokens}，未命中 ${replay.usage.promptCacheMissTokens}`);
    return;
  }
  if (boolFlag(flags.direct) && provider === "deepseek") disableProxy();
  const databases = dryRun ? undefined : new DatabaseHub(loadAppConfig().postgresUrl);
  const ai = dryRun ? undefined : new AiService(new PostgresAiCatalog(databases!.publicDatabase()), loadAppConfig().masterKey);
  const reviews: SemanticReviewResult[] = [];
  const errors: Array<{ categoryId: string; error: string }> = [];
  const usage = emptySemanticReviewUsage();
  let completed = 0;
  const markProgress = (success: boolean): void => {
    completed += 1;
    if (completed === 1 || completed % 100 === 0 || completed === categories.length) {
      console.log(`语义审阅进度：${completed}/${categories.length}，成功 ${reviews.length}，失败 ${errors.length}，本次${success ? "完成" : "失败"}`);
    }
  };
  try {
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        const category = categories[cursor++];
        if (!category) return;
        const node = byId.get(category.category.id);
        if (!node) continue;
        const evidenceText = evidence ? buildJdEvidenceText([node], evidence) : "";
        const prompt = buildSemanticReviewPrompt({ category, evidenceText });
        // 路径名只是给人看的；短 ID 保证同名/截断路径不会覆盖别的类目。
        const requestDir = join(runDir, `${slugify(category.category.path.join("-"))}--${shortCategoryId(category.category.id)}`);
        await writeJsonFile(join(requestDir, "request.json"), { system: SEMANTIC_REVIEW_SYSTEM_PROMPT, user: prompt, categoryId: category.category.id, sourceConsensus: consensusPath, jdEvidencePath: evidence ? evidencePath : null });
        if (dryRun) continue;
        let lastError = "";
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
          try {
            const response = await ai!.chat(provider, model, {
              messages: [{ role: "system", content: SEMANTIC_REVIEW_SYSTEM_PROMPT }, { role: "user", content: prompt + (lastError ? `\n上次输出校验失败：${lastError}` : "") }],
              // DeepSeek 主治理入口已验证不带 response_format；保持同一请求形态，避免 V4flash 兼容差异。
              temperature: 0.1, max_tokens: 6_000, thinking: { type: "disabled" },
            });
            await writeJsonFile(join(requestDir, `attempt-${String(attempt).padStart(3, "0")}.response.json`), response);
            addSemanticReviewUsage(usage, response.usage);
            const message = response.choices[0]?.message;
            const content = typeof message?.content === "string" ? message.content.trim() : "";
            if (!content) {
              const fields = message && typeof message === "object" ? Object.keys(message).join(",") : "none";
              throw new Error(`模型返回空 content（choices=${response.choices.length}，message字段=${fields || "none"}）`);
            }
            const review = parseSemanticReviewResponse(content, category);
            reviews.push(review);
            await writeTextFile(join(requestDir, `attempt-${String(attempt).padStart(3, "0")}.raw.txt`), content);
            await writeJsonFile(join(requestDir, "review.json"), review);
            lastError = "";
            break;
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
            if (attempt === attempts) errors.push({ categoryId: category.category.id, error: lastError });
          }
        }
        markProgress(lastError.length === 0);
      }
    };
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  } finally {
    await databases?.closeAll();
  }
  if (dryRun) {
    await writeJsonFile(join(runDir, "manifest.json"), { runDir, dryRun: true, ...inputSummary, categoryCount: categories.length, successCount: 0, errorCount: 0 });
    console.log(`已生成 ${categories.length} 个语义审阅请求：${runDir}`);
    return;
  }
  const previous = stableReviewForSelection;
  const mergedReviews = mergeSemanticReviews(previous?.reviews ?? [], reviews);
  const mergedErrors = mergeSemanticReviewErrors(previous?.errors ?? [], errors, reviews);
  const reviewDocument: SemanticReviewDocument = { version: "semantic-review-v1", generatedAt: new Date().toISOString(), sourceConsensus: consensusPath, reviews: mergedReviews, usage, errors: mergedErrors };
  await writeJsonFile(stableReviewPath, reviewDocument);
  const templates = applySemanticReviews(consensus, mergedReviews);
  await writeJsonFile(stableTemplatePath, templates);
  await writeJsonFile(join(runDir, "attribute-reviews-v1.json"), { ...reviewDocument, reviews, errors });
  await writeJsonFile(join(runDir, "attribute-templates-v1.json"), templates);
  await writeJsonFile(join(runDir, "manifest.json"), { runDir, ...inputSummary, categoryCount: categories.length, successCount: reviews.length, errorCount: errors.length, mergedReviewCount: mergedReviews.length, previousReviewCount: previous?.reviews.length ?? 0, usage, usageIncludesAllResponses: true });
  if (reviews.length === 0) throw new Error(`没有成功的语义审阅结果：${errors.map((item) => item.error).join("；")}`);
  console.log(`语义审阅完成：成功 ${reviews.length}，失败 ${errors.length}`);
  console.log(`模板：${stableTemplatePath}`);
  console.log(`缓存：命中 ${usage.promptCacheHitTokens}，未命中 ${usage.promptCacheMissTokens}`);
  console.log(`Token：输入 ${usage.promptTokens}，输出 ${usage.completionTokens}，思考 ${usage.reasoningTokens ?? 0}，合计 ${usage.totalTokens}`);
}

if (import.meta.main) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
