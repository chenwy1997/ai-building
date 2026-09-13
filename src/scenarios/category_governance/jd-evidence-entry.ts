import { isAbsolute, join } from "node:path";
import { readFile } from "node:fs/promises";
import { readJsonFile, writeJsonFile } from "../../facilities/json/files.ts";
import { parseFlags, asInt, boolFlag } from "./util.ts";
import { readContextDocument, workspaceRoot } from "./storage.ts";
import { collectJdEvidence, mergeJdEvidenceDocuments, type JdGoodsApi } from "./jd-collector.ts";
import type { CategoryNode, CategoryTreeDocument } from "./types.ts";
import { loadJdEvidence } from "./jd-evidence.ts";
import { shortCategoryId } from "./util.ts";

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
  --all                   明确允许采样全部末级类目（请求量较大）
  --skus-per-category=8   每个三横类目最多采样的 SKU 数
  --search-page-size=20   每个类目的京东搜索候选数
  --concurrency=4         京东采样并发；建议 2～4，最高 8
  --attempts=2            单个京东请求失败重试次数
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
  const targets = selectTargets(document, flags);
  const jdProject = flags["jd-project"] ?? Bun.env.CATEGORY_GOVERNANCE_JD_PROJECT ?? DEFAULT_JD_PROJECT;
  if (boolFlag(flags.direct)) disableProxy();
  const goodsApi = await loadGoodsApi(jdProject);
  const outputPath = resolvePath(workspace, flags.out, join("context", version, "jd-attribute-evidence.json"));
  const result = await collectJdEvidence({
    targetCategories: targets,
    goodsApi,
    skusPerCategory: Math.min(30, asInt(flags["skus-per-category"], 8)),
    searchPageSize: Math.min(50, asInt(flags["search-page-size"], 20)),
    concurrency: Math.min(MAX_CONCURRENCY, asInt(flags.concurrency, 4)),
    attempts: Math.min(5, asInt(flags.attempts, 2)),
    onProgress: (progress) => {
      if (progress.completed === progress.total || progress.completed % 5 === 0) {
        console.log(`进度 ${progress.completed}/${progress.total}，匹配 ${progress.matched}，失败 ${progress.failed}`);
      }
    },
  });
  let existing;
  try {
    existing = await loadJdEvidence(outputPath);
  } catch {
    existing = undefined;
  }
  const merged = mergeJdEvidenceDocuments(existing, result.document);
  await writeJsonFile(outputPath, merged);
  const runDir = join(workspace, "output", version, "jd-evidence", `run-${runStamp()}`);
  const runOutputPath = join(runDir, "jd-attribute-evidence.json");
  await writeJsonFile(runOutputPath, merged);
  await writeJsonFile(join(runDir, "manifest.json"), {
    version,
    generatedAt: result.document.generatedAt,
    stableOutputPath: outputPath,
    runOutputPath,
    targetCount: result.stats.targetCount,
    matchedTargetCount: result.stats.matchedTargetCount,
    unmatchedTargetCount: result.stats.unmatchedTargetCount,
    sampledSkuCount: result.stats.sampledSkuCount,
    detailSuccessCount: result.stats.detailSuccessCount,
    detailErrorCount: result.stats.detailErrorCount,
    unmatchedTargetIds: result.unmatchedTargetIds,
    errors: result.errors,
  });
  console.log(`京东证据已写入：${outputPath}`);
  console.log(`本次采样快照：${runOutputPath}`);
  console.log(`目标类目 ${result.stats.targetCount}，匹配 ${result.stats.matchedTargetCount}，未匹配 ${result.stats.unmatchedTargetCount}`);
  console.log(`采样 SKU ${result.stats.sampledSkuCount}，详情成功 ${result.stats.detailSuccessCount}，详情失败 ${result.stats.detailErrorCount}`);
  if (result.unmatchedTargetIds.length > 0) console.log(`未匹配类目 ID：${result.unmatchedTargetIds.slice(0, 20).join(",")}${result.unmatchedTargetIds.length > 20 ? "..." : ""}`);
  if (result.errors.length > 0) console.log(`错误示例：${result.errors.slice(0, 5).map((item) => `${item.categoryId} ${item.error}`).join("；")}`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
