import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { readJsonFile, writeJsonFile } from "../../facilities/json/files.ts";
import { parseFlags } from "./util.ts";
import { workspaceRoot } from "./storage.ts";

const HELP = `
冻结类目治理版本基线（只读快照，不调用模型）

用法：
  bun run category-governance:freeze --version=v1

参数：
  --version=v1      要冻结的类目治理版本
  --workspace=...   覆盖类目治理 workspace
`.trim();

const FILES: Array<{ source: string; target: string; required: boolean }> = [
  { source: "context/{version}/category-tree.json", target: "category-tree.json", required: true },
  { source: "context/{version}/id-index.json", target: "id-index.json", required: true },
  { source: "context/{version}/manifest.json", target: "context-manifest.json", required: false },
  { source: "context/{version}/jd-attribute-evidence.json", target: "jd-attribute-evidence.json", required: false },
  { source: "context/{version}/jd-category-mapping-v1.json", target: "jd-category-mapping-v1.json", required: false },
  { source: "output/{version}/consensus/attribute-candidates-v1.json", target: "attribute-candidates-v1.json", required: true },
  { source: "output/{version}/consensus/attribute-decisions-v1.json", target: "attribute-decisions-v1.json", required: false },
  { source: "output/{version}/semantic-review/attribute-reviews-v1.json", target: "attribute-reviews-v1.json", required: true },
  { source: "output/{version}/semantic-review/attribute-templates-v1.json", target: "attribute-templates-v1.json", required: true },
];

async function sha256(path: string): Promise<{ bytes: number; sha256: string }> {
  const data = await Bun.file(path).arrayBuffer();
  return { bytes: data.byteLength, sha256: createHash("sha256").update(new Uint8Array(data)).digest("hex") };
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
  const baselineDir = join(workspace, "output", version, "baseline");
  try {
    if ((await readdir(baselineDir)).length > 0) throw new Error(`基线已存在：${baselineDir}；基线不可覆盖，请新建版本`);
  } catch (error) {
    if (error instanceof Error && !error.message.startsWith("ENOENT")) throw error;
  }
  const selected: Array<{ source: string; target: string; bytes: number; sha256: string }> = [];
  for (const item of FILES) {
    const source = join(workspace, item.source.replace("{version}", version));
    try { await stat(source); } catch {
      if (item.required) throw new Error(`冻结所需文件不存在：${source}`);
      continue;
    }
    const target = join(baselineDir, item.target);
    await mkdir(baselineDir, { recursive: true });
    await copyFile(source, target);
    const digest = await sha256(target);
    selected.push({ source, target: item.target, ...digest });
  }
  const categoryTree = await readJsonFile<{ leafCount?: number; nodes?: unknown[] }>(join(baselineDir, "category-tree.json"));
  const candidates = await readJsonFile<{ categories?: unknown[]; stats?: unknown }>(join(baselineDir, "attribute-candidates-v1.json"));
  const reviews = await readJsonFile<{ reviews?: unknown[]; errors?: unknown[] }>(join(baselineDir, "attribute-reviews-v1.json"));
  const templates = await readJsonFile<{ categories?: unknown[] }>(join(baselineDir, "attribute-templates-v1.json"));
  await writeJsonFile(join(baselineDir, "manifest.json"), {
    baseline: "category-governance-baseline-v1",
    version,
    frozenAt: new Date().toISOString(),
    immutable: true,
    counts: {
      categoryNodes: categoryTree.nodes?.length ?? null,
      standardLeafCount: categoryTree.leafCount ?? null,
      candidateCategories: candidates.categories?.length ?? null,
      reviewedCategories: reviews.reviews?.length ?? null,
      reviewErrors: reviews.errors?.length ?? null,
      templateCategories: templates.categories?.length ?? null,
    },
    files: selected,
  });
  console.log(`v${version.replace(/^v/u, "")} 基线已冻结：${baselineDir}`);
  console.log(`文件 ${selected.length} 个；类目 ${categoryTree.leafCount ?? "?"}；终审 ${reviews.reviews?.length ?? "?"}；失败 ${reviews.errors?.length ?? "?"}`);
}

if (import.meta.main) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
