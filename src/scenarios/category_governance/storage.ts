import { createHash } from "node:crypto";
import { mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SQL } from "bun";
import { readJsonFile, readTextFile, writeJsonFile, writeTextFile } from "../../facilities/json/files.ts";
import { makeContextChunks } from "./std-text.ts";
import { shortCategoryId, slugify } from "./util.ts";
import type { CategoryTreeDocument, ContextChunk } from "./types.ts";

export const SCENARIO_NAME = "category_governance";
export const DEFAULT_WORKSPACE = "src/scenarios/category_governance/workspace";

export function workspaceRoot(): string {
  return Bun.env.CATEGORY_GOVERNANCE_DIR || DEFAULT_WORKSPACE;
}

export async function writeContextBundle(
  document: CategoryTreeDocument,
  rootDir: string,
  groupDepth: number,
  options: { importId?: number } = {},
): Promise<{ dir: string; chunks: ContextChunk[] }> {
  const dir = join(rootDir, "context", document.version);
  const chunks = makeContextChunks(document, groupDepth);
  await mkdir(dir, { recursive: true });
  // 一个版本只保留当前分片方案，避免上一次不完整抓取的 level-* 文件混入目录。
  let entries: Array<import("node:fs").Dirent> = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && /^level-\d+$/u.test(entry.name))
      .map((entry) => rm(join(dir, entry.name), { recursive: true, force: true })),
  );
  const bundleDocument = options.importId === undefined
    ? document
    : { ...document, importId: options.importId };
  await writeJsonFile(join(dir, "category-tree.json"), bundleDocument);
  const manifestChunks: Array<Omit<ContextChunk, "text"> & { file: string; sha256: string }> = [];
  for (const chunk of chunks) {
    const readable = slugify(`d${groupDepth}-${chunk.rootPath.join("-")}`).slice(0, 60);
    const file = join(`level-${groupDepth}`, `${readable}-id-${shortCategoryId(chunk.rootId)}.std.txt`);
    const absolute = join(dir, file);
    await writeTextFile(absolute, chunk.text);
    manifestChunks.push({
      key: chunk.key, groupDepth: chunk.groupDepth, rootId: chunk.rootId,
      rootPath: chunk.rootPath, nodeCount: chunk.nodeCount, leafCount: chunk.leafCount,
      file,
      sha256: createHash("sha256").update(chunk.text).digest("hex"),
    });
  }
  await writeJsonFile(join(dir, "manifest.json"), {
    version: bundleDocument.version,
    groupDepth,
    nodeCount: bundleDocument.nodes.length,
    leafCount: bundleDocument.leafCount,
    importId: bundleDocument.importId ?? null,
    source: {
      path: bundleDocument.sourcePath ?? null,
      sha256: bundleDocument.sourceSha256 ?? null,
      url: bundleDocument.sourceUrl ?? null,
      fetchedAt: bundleDocument.fetchedAt ?? null,
    },
    generatedAt: new Date().toISOString(),
    chunks: manifestChunks,
  });
  await writeJsonFile(join(dir, "id-index.json"), Object.fromEntries(
    bundleDocument.nodes.map((node) => [node.id, { path: node.pathNames, level: node.level, leaf: node.isLeaf }]),
  ));
  return { dir, chunks };
}

export async function findLatestVersion(rootDir: string): Promise<string> {
  try {
    const entries = await readdir(join(rootDir, "context"), { withFileTypes: true });
    const versions = entries.map((entry) => entry.name).filter((name) => /^v\d+$/.test(name));
    return versions.sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)))[0] ?? "v1";
  } catch {
    return "v1";
  }
}

export async function nextVersion(rootDir: string): Promise<string> {
  const latest = await findLatestVersion(rootDir);
  return `v${Number(latest.slice(1)) + 1}`;
}

export async function insertCategoryDocument(
  database: SQL,
  document: CategoryTreeDocument,
  sourcePath: string,
): Promise<number> {
  if (document.version !== "v1") {
    throw new Error(`数据库目前只初始化了 category_*_v1 表；导入 ${document.version} 前请新增对应迁移和表，避免覆盖不可变版本`);
  }
  const raw = await readTextFile(sourcePath);
  const sha256 = createHash("sha256").update(raw).digest("hex");
  const rows = await database<{ id: number }[]>`
    INSERT INTO category_imports_v1 (version, source_path, source_sha256, source_url, node_count, leaf_count)
    VALUES (${document.version}, ${sourcePath}, ${sha256}, ${document.sourceUrl ?? null}, ${document.nodes.length}, ${document.leafCount})
    RETURNING id
  `;
  const importId = rows[0]?.id;
  if (!importId) throw new Error("写入类目导入记录失败");
  // v1 表保存当前版本的可查询快照；重新导入时先移除旧快照，
  // 避免上一次不完整抓取残留节点污染总数和层级统计。
  await database`DELETE FROM category_nodes_v1`;
  for (const node of document.nodes) {
    await database`
      INSERT INTO category_nodes_v1
        (id, import_id, parent_id, name, level, path_json, category_id, is_leaf, enabled, payload_json)
      VALUES
        (${node.id}, ${importId}, ${node.parentId}, ${node.name}, ${node.level},
         ${node.pathNames}::jsonb, ${node.categoryId}, ${node.isLeaf}, ${node.enabled},
         ${node.payload}::jsonb)
      ON CONFLICT (id) DO UPDATE SET
        import_id=EXCLUDED.import_id, parent_id=EXCLUDED.parent_id, name=EXCLUDED.name,
        level=EXCLUDED.level, path_json=EXCLUDED.path_json, category_id=EXCLUDED.category_id,
        is_leaf=EXCLUDED.is_leaf, enabled=EXCLUDED.enabled, payload_json=EXCLUDED.payload_json
    `;
  }
  return importId;
}

export async function readContextDocument(rootDir: string, version: string): Promise<CategoryTreeDocument> {
  return readJsonFile<CategoryTreeDocument>(join(rootDir, "context", version, "category-tree.json"));
}

export function contextVersionDir(rootDir: string, version: string): string {
  return join(rootDir, "context", version);
}

export function outputPath(rootDir: string, version: string, ...parts: string[]): string {
  return join(rootDir, "output", version, ...parts);
}

export async function ensureParent(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}
