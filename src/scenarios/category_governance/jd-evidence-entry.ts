import { isAbsolute, join } from "node:path";
import { readFile, rename } from "node:fs/promises";
import { SQL } from "bun";
import { readJsonFile, writeJsonFile } from "../../facilities/json/files.ts";
import { parseFlags, asInt, boolFlag } from "./util.ts";
import { readContextDocument, workspaceRoot } from "./storage.ts";
import { collectJdEvidence, mergeJdEvidenceDocuments, type JdCategoryReference, type JdGoodsApi } from "./jd-collector.ts";
import type { CategoryNode, CategoryTreeDocument } from "./types.ts";
import { loadJdEvidence } from "./jd-evidence.ts";
import { shortCategoryId } from "./util.ts";
import { autoJdCategoryReferences, type JdCategoryMappingDocument } from "./jd-mapping.ts";

const DEFAULT_JD_PROJECT = "/Users/sanheng/Project/sanheng/ai-core";
const MAX_CONCURRENCY = 8;

const HELP = `
京东 VOP 类目属性证据采样器

作用：按三横末级类目搜索京东 SKU，读取商品详情中的 categoryAttrList 和 paramGroupAttrList，
聚合成可供类目治理提示词使用的 jd-attribute-evidence.json。

用法：
  bun run category-governance:jd-evidence --category="手机" --direct
  bun run category-governance:jd-evidence --limit=10 --concurrency=4 --direct
  bun run category-governance:jd-evidence --all --concurrency=4 --direct

参数：
  --category=...          类目 ID、短 ID、名称或完整路径；可重复采样单个类目
  --limit=10              未指定 --category/--all 时采样前 N 个末级类目
  --sample-per-group=2    按三横一级类目分层抽样，每组取 N 个末级类目
  --all                   明确允许采样全部末级类目（请求量较大）
  --skus-per-category=8   每个三横类目最多采样的 SKU 数
  --search-page-size=20   每个类目的京东搜索候选数
  --concurrency=4         京东采样并发；建议 2～4，最高 8
  --attempts=2            单个京东请求失败重试次数
  --chunk-size=100        每完成多少个类目就落盘一次，便于中断后续跑
  --resume                跳过稳定证据中已经有属性的类目
  --force                 不跳过已有证据，重新采样指定目标
  --retry-empty           重新采样已确认没有结构化京东属性的类目
  --indexed-only          只采样能唯一映射京东三级类目的目标，优先保证证据精度
  --jd-mapping=...        三横到京东的映射文件，默认 context/<version>/jd-category-mapping-v1.json
  --jd-project=...        ai-core 项目目录，默认读取 /Users/sanheng/Project/sanheng/ai-core
  --out=...               输出证据文件，默认 context/<version>/jd-attribute-evidence.json
  --direct                当前进程绕过 V2rayN 代理直连京东
  --workspace=...         覆盖类目治理 workspace
  --version=v1            类目上下文版本
`.trim();

async function loadEnvFile(path: string): Promise<void> {
  try {
    const text = await readFile(path, "utf8");
    for (const line of text.split(/\r?\n/u)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const normalized = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
      const index = normalized.indexOf("=");
      if (index <= 0) continue;
      const key = normalized.slice(0, index).trim();
      let value = normalized.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // ai-core 也可能由 shell 预先注入环境变量；没有 .env 时继续让 API 自己报配置错误。
  }
}

function disableProxy(): void {
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) {
    delete process.env[key];
  }
  process.env.NO_PROXY = "*";
  process.env.no_proxy = "*";
}

function selectorMatches(node: CategoryNode, selector: string): boolean {
  const needle = selector.trim().toLocaleLowerCase();
  return node.pathIds.some((id) => id.toLocaleLowerCase() === needle || shortCategoryId(id).toLocaleLowerCase() === needle)
    || node.pathNames.some((name) => name.toLocaleLowerCase() === needle)
    || node.pathNames.join("/").toLocaleLowerCase() === needle
    || node.pathNames.join(">").toLocaleLowerCase() === needle;
}

function selectTargets(document: CategoryTreeDocument, flags: Record<string, string>): CategoryNode[] {
  const leaves = document.nodes.filter((node) => node.isLeaf && node.enabled).sort((a, b) => a.pathNames.join("/").localeCompare(b.pathNames.join("/")));
  const selector = flags.category ?? flags["category-id"];
  if (selector) {
    const selected = leaves.filter((node) => selectorMatches(node, selector));
    if (selected.length === 0) throw new Error(`找不到三横末级类目：${selector}`);
    return selected;
  }
  if (boolFlag(flags.all)) return leaves;
  const samplePerGroup = asInt(flags["sample-per-group"], 0, 0);
  if (samplePerGroup > 0) {
    const groups = new Map<string, CategoryNode[]>();
    for (const leaf of leaves) {
      const group = leaf.pathNames[1] ?? leaf.pathNames[0] ?? "";
      (groups.get(group) ?? groups.set(group, []).get(group)!).push(leaf);
    }
    return [...groups.keys()].sort().flatMap((group) => groups.get(group)!.slice(0, samplePerGroup));
  }
  const limit = asInt(flags.limit, 10);
  return leaves.slice(0, limit);
}

function resolvePath(root: string, value: string | undefined, fallback: string): string {
  const selected = value ?? fallback;
  return isAbsolute(selected) ? selected : join(root, selected);
}

function runStamp(): string {
  return new Date().toISOString().replace(/[-:]/gu, "").replace(".", "-");
}

async function loadGoodsApi(projectRoot: string): Promise<JdGoodsApi> {
  await loadEnvFile(join(projectRoot, ".env.local"));
  await loadEnvFile(join(projectRoot, ".env"));
  return importGoodsApi(join(projectRoot, "src/lib/jd-vop/goods/index.ts"));
}

export async function loadJdCategoryReferences(projectRoot: string): Promise<JdCategoryReference[]> {
  await loadEnvFile(join(projectRoot, ".env.local"));
  await loadEnvFile(join(projectRoot, ".env"));
  const url = process.env.DATABASE_URL ?? process.env.JD_DATABASE_URL;
  if (!url) return [];
  const database = new SQL(url, { max: 1, connectionTimeout: 10 });
  try {
    const rows = await database<Array<{ categoryId: string; name: string; fullPath: string }>>`
      SELECT "categoryId", "name", "fullPath"
      FROM "jdvop_categories"
      WHERE "enabled" = true AND "level" = 2
    `;
    return rows.map((row) => ({ id: String(row.categoryId), name: String(row.name), path: String(row.fullPath).split("/").map((part) => part.trim()).filter(Boolean) }));
  } catch (error) {
    console.warn(`京东类目索引不可用，将回退关键词搜索：${error instanceof Error ? error.message : String(error)}`);
    return [];
  } finally {
    await database.close();
  }
}

async function importGoodsApi(path: string): Promise<JdGoodsApi> {
  const module = await import(path) as {
    searchSku: JdGoodsApi["searchSku"];
    getSkuDetailInfo: JdGoodsApi["getSkuDetailInfo"];
  };
  return {
    searchSku: module.searchSku,
    getSkuDetailInfo: module.getSkuDetailInfo,
  };
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  const tempPath = `${path}.tmp-${process.pid}`;
  await writeJsonFile(tempPath, value);
  await rename(tempPath, path);
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
  const allTargets = selectTargets(document, flags);
  const jdProject = flags["jd-project"] ?? Bun.env.CATEGORY_GOVERNANCE_JD_PROJECT ?? DEFAULT_JD_PROJECT;
  if (boolFlag(flags.direct)) disableProxy();
  const outputPath = resolvePath(workspace, flags.out, join("context", version, "jd-attribute-evidence.json"));
  const emptyEvidencePath = resolvePath(workspace, undefined, join("context", version, "jd-attribute-evidence.empty.json"));
  let existing;
  try {
    existing = await loadJdEvidence(outputPath);
  } catch {
    existing = undefined;
  }
  let existingEmptyIds = new Set<string>();
  try {
    const empty = await readJsonFile<{ targetIds?: unknown[] }>(emptyEvidencePath);
    existingEmptyIds = new Set((empty.targetIds ?? []).filter((id): id is string => typeof id === "string"));
  } catch {
    // 首次运行没有空证据清单。
  }
  const resume = boolFlag(flags.resume) && !boolFlag(flags.force);
  const retryEmpty = boolFlag(flags["retry-empty"]);
  const coveredIds = new Set((existing?.categories ?? []).flatMap((category) => category.targetIds ?? []));
  const targets = resume
    ? allTargets.filter((target) => {
      const idCovered = coveredIds.has(target.id) || coveredIds.has(shortCategoryId(target.id));
      const empty = existingEmptyIds.has(target.id) || existingEmptyIds.has(shortCategoryId(target.id));
      return !idCovered && (retryEmpty || !empty);
    })
    : allTargets;
  if (resume && targets.length !== allTargets.length) {
    console.log(`断点续跑：跳过已有证据 ${allTargets.length - targets.length} 个，剩余 ${targets.length} 个类目`);
  }
  if (targets.length === 0) {
    console.log("没有需要采样的类目；如需重采样，请去掉 --resume 或使用 --force");
    return;
  }

  const runDir = join(workspace, "output", version, "jd-evidence", `run-${runStamp()}`);
  const runOutputPath = join(runDir, "jd-attribute-evidence.json");
  const chunkSize = Math.min(500, asInt(flags["chunk-size"], 100));
  const goodsApi = await loadGoodsApi(jdProject);
  const jdCategories = await loadJdCategoryReferences(jdProject);
  const mappingPath = resolvePath(workspace, flags["jd-mapping"], join("context", version, "jd-category-mapping-v1.json"));
  let mappedCategories: JdCategoryReference[] = [];
  try {
    const mapping = await readJsonFile<JdCategoryMappingDocument>(mappingPath);
    mappedCategories = autoJdCategoryReferences(mapping);
  } catch {
    // 映射文件是可选增强；没有生成时继续使用京东原生名称索引。
  }
  const searchCategories = [...jdCategories, ...mappedCategories];
  console.log(`京东类目索引：${jdCategories.length} 个可用三级类目，映射增强：${mappedCategories.length} 个`);
  let merged = existing;
  const skippedCount = allTargets.length - targets.length;
  let processedCount = 0;
  const coveredCount = allTargets.filter((target) => coveredIds.has(target.id) || coveredIds.has(shortCategoryId(target.id))).length;
  let matchedTargetCount = coveredCount;
  let sampledSkuCount = 0;
  let detailSuccessCount = 0;
  let detailErrorCount = 0;
  const emptyEvidenceTargetIds = new Set(existingEmptyIds);
  if (!resume || retryEmpty) {
    for (const target of targets) {
      emptyEvidenceTargetIds.delete(target.id);
      emptyEvidenceTargetIds.delete(shortCategoryId(target.id));
    }
  }
  const unmatchedTargetIds: string[] = [];
  const errors: Array<{ categoryId: string; error: string }> = [];
  const writeCheckpoint = async (generatedAt: string, status: "running" | "completed"): Promise<void> => {
    if (!merged) return;
    const checkpoint = {
      ...merged,
      sampling: {
        ...(merged.sampling ?? {}),
        targetCount: allTargets.length,
        processedCount: skippedCount + processedCount,
        skusPerCategory: Math.min(30, asInt(flags["skus-per-category"], 8)),
        searchPageSize: Math.min(50, asInt(flags["search-page-size"], 20)),
        matcherVersion: "strict-v2",
      },
      generatedAt,
    };
    await writeJsonAtomically(outputPath, checkpoint);
    await writeJsonAtomically(runOutputPath, checkpoint);
    await writeJsonAtomically(emptyEvidencePath, {
      version,
      generatedAt,
      targetIds: [...emptyEvidenceTargetIds],
      count: emptyEvidenceTargetIds.size,
    });
    await writeJsonAtomically(join(runDir, "manifest.json"), {
      version, status, generatedAt, stableOutputPath: outputPath, runOutputPath,
      targetCount: allTargets.length, processedCount: skippedCount + processedCount,
      remainingCount: allTargets.length - skippedCount - processedCount,
      jdCategoryReferenceCount: jdCategories.length,
      jdMappingCount: mappedCategories.length,
      indexedOnly: boolFlag(flags["indexed-only"]),
      matchedTargetCount, unmatchedTargetCount: unmatchedTargetIds.length,
      emptyEvidenceCount: emptyEvidenceTargetIds.size,
      sampledSkuCount, detailSuccessCount, detailErrorCount, unmatchedTargetIds, errors,
    });
  };
  for (let offset = 0; offset < targets.length; offset += chunkSize) {
    const chunk = targets.slice(offset, offset + chunkSize);
    const result = await collectJdEvidence({
      targetCategories: chunk,
      goodsApi,
      skusPerCategory: Math.min(30, asInt(flags["skus-per-category"], 8)),
      searchPageSize: Math.min(50, asInt(flags["search-page-size"], 20)),
      concurrency: Math.min(MAX_CONCURRENCY, asInt(flags.concurrency, 4)),
      attempts: Math.min(5, asInt(flags.attempts, 2)),
      jdCategories: searchCategories,
      onlyUseJdCategories: boolFlag(flags["indexed-only"]),
      onProgress: (progress) => {
        if (progress.completed === progress.total || progress.completed % 5 === 0) {
          console.log(`进度 ${skippedCount + processedCount + progress.completed}/${allTargets.length}，匹配 ${matchedTargetCount + progress.matched}，失败 ${errors.length + progress.failed}`);
        }
      },
    });
    const replacedTargetIds = new Set(result.document.categories.flatMap((category) => category.targetIds ?? []));
    merged = mergeJdEvidenceDocuments(merged, result.document, { replaceTargetIds: replacedTargetIds });
    processedCount += chunk.length;
    matchedTargetCount += result.stats.matchedTargetCount;
    sampledSkuCount += result.stats.sampledSkuCount;
    detailSuccessCount += result.stats.detailSuccessCount;
    detailErrorCount += result.stats.detailErrorCount;
    unmatchedTargetIds.push(...result.unmatchedTargetIds);
    for (const id of result.emptyEvidenceTargetIds) emptyEvidenceTargetIds.add(id);
    errors.push(...result.errors);
    await writeCheckpoint(result.document.generatedAt ?? new Date().toISOString(), offset + chunk.length >= targets.length ? "completed" : "running");
    console.log(`已落盘 ${skippedCount + processedCount}/${allTargets.length} 个类目，证据 ${merged?.categories.length ?? 0} 个，详情成功 ${detailSuccessCount}，详情失败 ${detailErrorCount}`);
  }
  console.log(`京东证据已写入：${outputPath}`);
  console.log(`本次采样快照：${runOutputPath}`);
  console.log(`目标类目 ${allTargets.length}，本次处理 ${processedCount}，匹配 ${matchedTargetCount}，未匹配 ${unmatchedTargetIds.length}`);
  console.log(`采样 SKU ${sampledSkuCount}，详情成功 ${detailSuccessCount}，详情失败 ${detailErrorCount}，空证据 ${emptyEvidenceTargetIds.size}`);
  if (unmatchedTargetIds.length > 0) console.log(`未匹配类目 ID：${unmatchedTargetIds.slice(0, 20).join(",")}${unmatchedTargetIds.length > 20 ? "..." : ""}`);
  if (errors.length > 0) console.log(`错误示例：${errors.slice(0, 5).map((item) => `${item.categoryId} ${item.error}`).join("；")}`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
