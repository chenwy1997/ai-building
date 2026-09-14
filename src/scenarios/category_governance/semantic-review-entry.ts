import { join } from "node:path";
import { AiService } from "../../ai/service.ts";
import { loadAppConfig } from "../../config/env.ts";
import { PostgresAiCatalog } from "../../data/ai-catalog.ts";
import { DatabaseHub } from "../../platform/database/index.ts";
import { readJsonFile, writeJsonFile, writeTextFile } from "../../facilities/json/files.ts";
import { parseFlags, asInt, boolFlag, slugify, shortCategoryId } from "./util.ts";
import { readContextDocument, workspaceRoot } from "./storage.ts";
import { loadJdEvidence, buildJdEvidenceText, type JdEvidenceDocument } from "./jd-evidence.ts";
import { applySemanticReviews, buildSemanticReviewPrompt, mergeSemanticReviews, parseSemanticReviewResponse, SEMANTIC_REVIEW_SYSTEM_PROMPT, type SemanticReviewDocument, type SemanticReviewResult } from "./semantic-review.ts";
import type { AttributeConsensusDocument } from "./consensus.ts";
import type { CategoryNode } from "./types.ts";

const HELP = `
用大模型对多批次属性候选做语义终审

用法：
  bun run category-governance:semantic-review --category="手机" --limit=1 --direct
  bun run category-governance:semantic-review --limit=30 --concurrency=4 --direct
  bun run category-governance:semantic-review --all --concurrency=16 --direct

参数：
  --category=...       只审阅指定类目名称、完整路径、完整 ID 或短 ID
  --limit=10           从候选库中最多审阅 N 个类目，不会自动生成候选；未指定范围时默认 10
  --all                明确允许审阅全部共识类目
  --concurrency=4      语义审阅并发数，默认 4
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
  const byId = new Map(context.nodes.map((node) => [node.id, node]));
  const selector = flags.category ?? flags["category-id"];
  const candidateCategories = consensus.categories.filter((category) => {
    const node = byId.get(category.category.id);
    return node && (!selector || matches(node, selector));
  });
  if (candidateCategories.length === 0) throw new Error("没有找到可审阅的共识类目");
  if (boolFlag(flags.all) && flags.limit !== undefined) throw new Error("--all 和 --limit 不能同时指定");
  const requestedLimit = flags.limit !== undefined ? asInt(flags.limit, 10) : boolFlag(flags.all) || selector ? undefined : 10;
  const categories = requestedLimit === undefined ? candidateCategories : candidateCategories.slice(0, requestedLimit);
  if (categories.length === 0) throw new Error("没有需要审阅的类目；可使用 --all");
  const inputSummary = {
    sourceConsensus: consensusPath,
    sourceRuns: consensus.sourceRuns,
    consensusCategoryCount: consensus.categories.length,
    matchedCategoryCount: candidateCategories.length,
    requestedLimit: requestedLimit ?? null,
    categoryIds: categories.map((item) => item.category.id),
  };
  console.log(`候选库：${consensusPath}（来源 ${consensus.sourceRuns.map((id) => `run-${id}`).join(", ")}）`);
  console.log(`候选类目 ${consensus.categories.length}，匹配 ${candidateCategories.length}，本次审阅 ${categories.length}${requestedLimit === undefined ? "" : `（上限 ${requestedLimit}）`}`);
  if (requestedLimit !== undefined && candidateCategories.length < requestedLimit) {
    console.warn(`候选不足：当前范围只有 ${candidateCategories.length} 个类目。--limit 只限制数量；扩大范围前请用 category-governance:consensus 汇总包含更多类目的已有批次。`);
  }
  const evidencePath = flags["jd-evidence"] ?? join(workspace, "context", version, "jd-attribute-evidence.json");
  let evidence: JdEvidenceDocument | undefined;
  try { evidence = await loadJdEvidence(evidencePath); } catch { /* 京东证据可选 */ }
  const runDir = join(workspace, "output", version, "semantic-review", `run-${runStamp()}`);
  const stableReviewPath = join(workspace, "output", version, "semantic-review", "attribute-reviews-v1.json");
  const stableTemplatePath = join(workspace, "output", version, "semantic-review", "attribute-templates-v1.json");
  const provider = flags.provider ?? "deepseek";
  const model = flags.model ?? "flash";
  const attempts = asInt(flags.attempts, 2);
  const concurrency = Math.min(32, asInt(flags.concurrency, 4));
  const dryRun = boolFlag(flags["dry-run"]);
  if (boolFlag(flags.direct) && provider === "deepseek") disableProxy();
  const databases = dryRun ? undefined : new DatabaseHub(loadAppConfig().postgresUrl);
  const ai = dryRun ? undefined : new AiService(new PostgresAiCatalog(databases!.publicDatabase()), loadAppConfig().masterKey);
  const reviews: SemanticReviewResult[] = [];
  const errors: Array<{ categoryId: string; error: string }> = [];
  let promptTokens = 0; let completionTokens = 0; let totalTokens = 0; let promptCacheHitTokens = 0; let promptCacheMissTokens = 0; let reasoningTokens = 0;
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
        const requestDir = join(runDir, slugify(category.category.path.join("-")));
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
            promptTokens += response.usage?.prompt_tokens ?? 0;
            completionTokens += response.usage?.completion_tokens ?? 0;
            totalTokens += response.usage?.total_tokens ?? 0;
            promptCacheHitTokens += response.usage?.prompt_cache_hit_tokens ?? 0;
            promptCacheMissTokens += response.usage?.prompt_cache_miss_tokens ?? 0;
            reasoningTokens += response.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
            lastError = "";
            break;
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
            if (attempt === attempts) errors.push({ categoryId: category.category.id, error: lastError });
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, categories.length) }, () => worker()));
  } finally {
    await databases?.closeAll();
  }
  if (dryRun) {
    await writeJsonFile(join(runDir, "manifest.json"), { runDir, dryRun: true, ...inputSummary, categoryCount: categories.length, successCount: 0, errorCount: 0 });
    console.log(`已生成 ${categories.length} 个语义审阅请求：${runDir}`);
    return;
  }
  if (reviews.length === 0) throw new Error(`没有成功的语义审阅结果：${errors.map((item) => item.error).join("；")}`);
  let previous: SemanticReviewDocument | undefined;
  try { previous = await readJsonFile<SemanticReviewDocument>(stableReviewPath); } catch { /* 首次运行或旧文件损坏时从当前批次开始 */ }
  const mergedReviews = mergeSemanticReviews(previous?.reviews ?? [], reviews);
  const reviewDocument: SemanticReviewDocument = { version: "semantic-review-v1", generatedAt: new Date().toISOString(), sourceConsensus: consensusPath, reviews: mergedReviews, usage: { promptTokens, completionTokens, totalTokens, promptCacheHitTokens, promptCacheMissTokens, reasoningTokens }, errors };
  await writeJsonFile(stableReviewPath, reviewDocument);
  const templates = applySemanticReviews(consensus, mergedReviews);
  await writeJsonFile(stableTemplatePath, templates);
  await writeJsonFile(join(runDir, "attribute-reviews-v1.json"), { ...reviewDocument, reviews });
  await writeJsonFile(join(runDir, "attribute-templates-v1.json"), templates);
  await writeJsonFile(join(runDir, "manifest.json"), { runDir, ...inputSummary, categoryCount: categories.length, successCount: reviews.length, errorCount: errors.length, mergedReviewCount: mergedReviews.length, previousReviewCount: previous?.reviews.length ?? 0, usage: reviewDocument.usage });
  console.log(`语义审阅完成：成功 ${reviews.length}，失败 ${errors.length}`);
  console.log(`模板：${stableTemplatePath}`);
  console.log(`缓存：命中 ${promptCacheHitTokens}，未命中 ${promptCacheMissTokens}`);
}

if (import.meta.main) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
