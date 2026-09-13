import { isAbsolute, join } from "node:path";
import { writeJsonFile } from "../../facilities/json/files.ts";
import { parseFlags, asInt } from "./util.ts";
import { readContextDocument, workspaceRoot } from "./storage.ts";
import { loadJdCategoryReferences } from "./jd-evidence-entry.ts";
import { buildJdCategoryMapping } from "./jd-mapping.ts";
import type { CategoryNode } from "./types.ts";

const DEFAULT_JD_PROJECT = "/Users/sanheng/Project/sanheng/ai-core";

const HELP = `
生成三横到京东三级类目的可审计映射候选

用法：
  bun run category-governance:jd-mapping
  bun run category-governance:jd-mapping --limit=100

参数：
  --limit=...              只处理排序后的前 N 个末级类目
  --sample-per-group=...   按三横一级类目分层，每组取 N 个末级类目
  --jd-project=...         ai-core 项目目录
  --workspace=...          覆盖类目治理 workspace
  --version=v1             类目上下文版本
`.trim();

function selectTargets(nodes: CategoryNode[], flags: Record<string, string>): CategoryNode[] {
  const leaves = nodes.filter((node) => node.isLeaf && node.enabled).sort((a, b) => a.pathNames.join("/").localeCompare(b.pathNames.join("/")));
  const perGroup = asInt(flags["sample-per-group"], 0, 0);
  if (perGroup > 0) {
    const groups = new Map<string, CategoryNode[]>();
    for (const leaf of leaves) {
      const group = leaf.pathNames[1] ?? leaf.pathNames[0] ?? "";
      (groups.get(group) ?? groups.set(group, []).get(group)!).push(leaf);
    }
    return [...groups.keys()].sort().flatMap((group) => groups.get(group)!.slice(0, perGroup));
  }
  const limit = flags.limit ? asInt(flags.limit, leaves.length) : leaves.length;
  return leaves.slice(0, limit);
}

function resolvePath(root: string, value: string | undefined, fallback: string): string {
  const selected = value ?? fallback;
  return isAbsolute(selected) ? selected : join(root, selected);
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
  const document = await readContextDocument(workspace, version);
  const targets = selectTargets(document.nodes, flags);
  const jdProject = flags["jd-project"] ?? Bun.env.CATEGORY_GOVERNANCE_JD_PROJECT ?? DEFAULT_JD_PROJECT;
  const references = await loadJdCategoryReferences(jdProject);
  if (references.length === 0) throw new Error("没有读取到京东启用三级类目，请检查 ai-core DATABASE_URL");
  const mapping = buildJdCategoryMapping(targets, references);
  const outputPath = resolvePath(workspace, flags.out, join("context", version, "jd-category-mapping-v1.json"));
  await writeJsonFile(outputPath, mapping);
  const runDir = join(workspace, "output", version, "jd-mapping", `run-${runStamp()}`);
  await writeJsonFile(join(runDir, "jd-category-mapping-v1.json"), mapping);
  await writeJsonFile(join(runDir, "manifest.json"), {
    ...mapping.stats,
    version: mapping.version,
    generatedAt: mapping.generatedAt,
    stableOutputPath: outputPath,
    runOutputPath: join(runDir, "jd-category-mapping-v1.json"),
    jdCategoryReferenceCount: references.length,
  });
  console.log(`京东映射已写入：${outputPath}`);
  console.log(`三横类目 ${mapping.stats.targetCount}，自动映射 ${mapping.stats.autoCount}，待审核 ${mapping.stats.reviewCount}，无候选 ${mapping.stats.unmatchedCount}`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
