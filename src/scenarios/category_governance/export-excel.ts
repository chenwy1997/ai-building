import { mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { categoryById } from "./category-tree.ts";
import { parseGovernanceResponse } from "./template-codec.ts";
import type { AttributeProperty, CategoryNode, GovernanceResult } from "./types.ts";

const SCENARIO_DIR = resolve(import.meta.dir);
const WORKSPACE_DIR = join(SCENARIO_DIR, "workspace");
const DEFAULT_REFERENCE = "/Users/sanheng/Library/Containers/com.tencent.WeWorkMac/Data/Documents/Profiles/97D1B5EFDB06A5F5A0B1F34C4FBC7A22/Caches/Files/2026-08/ed603ecb2fed2363aad4f97e003d7224/AI比赛第2期-赛题类目属性.xlsx";
const HEADERS = [
  "一级类目",
  "二级类目",
  "三级类目",
  "品名（四级类目）",
  "属性名称",
  "属性说明",
  "属性值类型",
  "属性值填写要求",
  "属性值单位",
  "属性值选项",
  "属性值格式",
  "属性值示例",
] as const;

type ArtifactTool = {
  Workbook: { create(): any };
  SpreadsheetFile: { exportXlsx(workbook: any): Promise<{ save(path: string): Promise<void> }> };
};

interface RunManifest {
  runId: string;
  version: string;
  requestCount: number;
  successCount: number;
  errorCount: number;
  attemptErrors?: Array<{ key?: string; attempt?: number; error?: string }>;
  usage?: { promptCacheHitTokens?: number; promptCacheMissTokens?: number };
  source?: Record<string, unknown>;
}

function parseArgs(argv: string[]): { runId: string; version: string; output?: string; reference?: string } {
  const values = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i]!;
    if (value.startsWith("--")) {
      const [key, inline] = value.slice(2).split("=", 2);
      const next = inline ?? (argv[i + 1]?.startsWith("--") ? undefined : argv[++i]);
      if (key && next !== undefined) values.set(key, next);
    } else {
      positional.push(value);
    }
  }
  const runId = values.get("run-id") ?? positional[0] ?? "19";
  const version = values.get("version") ?? "v1";
  return { runId, version, output: values.get("output"), reference: values.get("reference") };
}

async function loadArtifactTool(): Promise<ArtifactTool> {
  const candidates = [
    process.env.ARTIFACT_TOOL_MODULE,
    "/Users/sanheng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs",
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    try {
      return await import(candidate) as ArtifactTool;
    } catch {
      // Try the next known runtime location.
    }
  }
  throw new Error("找不到 @oai/artifact-tool。请设置 ARTIFACT_TOOL_MODULE 为 artifact_tool.mjs 的绝对路径。");
}

function attemptNumber(name: string): number {
  return Number(name.match(/attempt-(\d+)\.json$/u)?.[1] ?? 0);
}

async function latestResponseFiles(runDir: string): Promise<string[]> {
  const entries = await readdir(runDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const names = (await readdir(join(runDir, entry.name)))
      .filter((name) => /^attempt-\d+\.json$/u.test(name))
      .sort((a, b) => attemptNumber(a) - attemptNumber(b));
    const latest = names.at(-1);
    if (latest) files.push(join(runDir, entry.name, latest));
  }
  return files.sort((a, b) => a.localeCompare(b, "zh-CN"));
}

async function loadResults(version: string, runId: string): Promise<{ manifest: RunManifest; results: GovernanceResult[] }> {
  const runDir = join(WORKSPACE_DIR, "output", version, `run-${runId}`);
  const manifestPath = join(runDir, "manifest.json");
  if (!(await Bun.file(manifestPath).exists())) throw new Error(`找不到运行目录：${runDir}`);
  const manifest = JSON.parse(await Bun.file(manifestPath).text()) as RunManifest;
  const treePath = join(WORKSPACE_DIR, "context", version, "category-tree.json");
  const tree = JSON.parse(await Bun.file(treePath).text());
  const categories = categoryById(tree);
  const results: GovernanceResult[] = [];
  for (const responsePath of await latestResponseFiles(runDir)) {
    const requestPath = responsePath.replace(/\.json$/u, ".request.json");
    if (!(await Bun.file(requestPath).exists())) continue;
    const request = JSON.parse(await Bun.file(requestPath).text()) as { categoryIds?: string[] };
    const targets = (request.categoryIds ?? []).map((id) => categories.get(id)).filter((node): node is CategoryNode => Boolean(node));
    if (targets.length === 0) continue;
    results.push(...parseGovernanceResponse(await Bun.file(responsePath).text(), targets));
  }
  results.sort((a, b) => {
    const left = a.category.path.join("\u0001");
    const right = b.category.path.join("\u0001");
    return left.localeCompare(right, "zh-CN") || a.category.id.localeCompare(b.category.id);
  });
  const unique = new Set(results.map((result) => result.category.id));
  if (unique.size !== results.length) throw new Error(`运行 ${runId} 存在重复类目结果：${results.length - unique.size} 条`);
  return { manifest, results };
}

function displayType(type: AttributeProperty["type"]): string {
  if (type === "single") return "单选";
  if (type === "multi") return "多选";
  return "文本";
}

function requirement(property: AttributeProperty): string {
  const base = property.required ? "必填" : "选填";
  return property.scope === "shared" ? `${base}；公共属性` : base;
}

function categoryLevels(path: string[]): [string, string, string, string] {
  const levels = path[0] === "标准类目" ? path.slice(1) : path;
  return [levels[0] ?? "", levels[1] ?? "", levels[2] ?? "", levels[3] ?? ""];
}

function rowsForResults(results: GovernanceResult[]): string[][] {
  const rows: string[][] = [];
  for (const result of results) {
    const levels = categoryLevels(result.category.path);
    for (const property of [...result.shared, ...result.properties]) {
      rows.push([
        ...levels,
        property.name,
        property.description ?? "",
        displayType(property.type),
        requirement(property),
        property.unit ?? "",
        (property.options ?? []).join(";"),
        property.format ?? "",
        property.example ?? "",
      ]);
    }
  }
  return rows;
}

function applyMainSheetFormat(sheet: any, rowCount: number): void {
  const all = sheet.getRange(`A1:L${Math.max(rowCount + 1, 2)}`);
  all.format = {
    font: { name: "Microsoft YaHei", size: 10, color: "#222222" },
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "all", style: "thin", color: "#D9E2F3" },
  };
  const header = sheet.getRange("A1:L1");
  header.format = {
    fill: "#1F4E78",
    font: { name: "Microsoft YaHei", size: 10, bold: true, color: "#FFFFFF" },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "all", style: "thin", color: "#FFFFFF" },
  };
  sheet.getRange(`A2:D${Math.max(rowCount + 1, 2)}`).format.horizontalAlignment = "left";
  sheet.getRange(`G2:J${Math.max(rowCount + 1, 2)}`).format.horizontalAlignment = "center";
  sheet.getRange(`A1:L${Math.max(rowCount + 1, 2)}`).format.rowHeight = 30;
  header.format.rowHeight = 36;
  const widths = [16, 18, 20, 24, 16, 32, 12, 16, 12, 34, 26, 22];
  for (let i = 0; i < widths.length; i += 1) sheet.getRangeByIndexes(0, i, 1, 1).format.columnWidth = widths[i];
  sheet.freezePanes.freezeRows(1);
  sheet.showGridLines = false;
}

async function buildWorkbook(manifest: RunManifest, results: GovernanceResult[]): Promise<any> {
  const { Workbook } = await loadArtifactTool();
  const workbook = Workbook.create();
  const sheet = workbook.worksheets.add("属性模板");
  const rows = rowsForResults(results);
  sheet.getRange("A1:L1").values = [HEADERS as unknown as string[]];
  if (rows.length > 0) sheet.getRangeByIndexes(1, 0, rows.length, HEADERS.length).values = rows;
  applyMainSheetFormat(sheet, rows.length);

  const info = workbook.worksheets.add("导出信息");
  const hit = manifest.usage?.promptCacheHitTokens ?? 0;
  const miss = manifest.usage?.promptCacheMissTokens ?? 0;
  const infoRows = [
    ["运行批次", manifest.runId],
    ["类目版本", manifest.version],
    ["请求数", manifest.requestCount],
    ["成功类目数", manifest.successCount],
    ["失败类目数", manifest.errorCount],
    ["导出类目数", results.length],
    ["属性行数", rows.length],
    ["缓存命中 tokens", hit],
    ["缓存未命中 tokens", miss],
    ["缓存命中率", hit + miss > 0 ? hit / (hit + miss) : 0],
    ["参考格式", DEFAULT_REFERENCE],
  ];
  info.getRangeByIndexes(0, 0, infoRows.length, 2).values = infoRows;
  info.getRange("A1:B1").format = { fill: "#1F4E78", font: { bold: true, color: "#FFFFFF" } };
  info.getRange(`A1:B${infoRows.length}`).format = {
    font: { name: "Microsoft YaHei", size: 10 },
    verticalAlignment: "center",
    borders: { preset: "all", style: "thin", color: "#D9E2F3" },
  };
  info.getRange(`B10`).format.numberFormat = [["0.00%"]];
  info.getRange("A:A").format.columnWidth = 22;
  info.getRange("B:B").format.columnWidth = 70;
  info.showGridLines = false;
  return workbook;
}

export async function exportRunToExcel(options: { version: string; runId: string; output?: string }): Promise<string> {
  const { manifest, results } = await loadResults(options.version, options.runId);
  const workbook = await buildWorkbook(manifest, results);
  workbook.recalculate();
  const outputPath = resolve(options.output ?? join(WORKSPACE_DIR, "output", options.version, "excel", `excel-${options.runId}.xlsx`));
  const { SpreadsheetFile } = await loadArtifactTool();
  const xlsx = await SpreadsheetFile.exportXlsx(workbook);
  await mkdir(resolve(outputPath, ".."), { recursive: true });
  await xlsx.save(outputPath);
  return outputPath;
}

if (import.meta.main) {
  const args = parseArgs(Bun.argv.slice(2));
  const outputPath = await exportRunToExcel(args);
  console.log(`Excel 导出完成：${outputPath}`);
}
