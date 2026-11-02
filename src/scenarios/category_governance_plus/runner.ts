import { join, resolve } from "node:path";
import type { SQL } from "bun";
import { readTextFile, writeJsonFile, writeTextFile } from "../../facilities/json/files.ts";
import { asInt, boolFlag, parseFlags } from "../category_governance/util.ts";
import { normalizeCategories } from "../category_governance/category-tree.ts";
import { toStdText } from "../category_attributes_governance/context.ts";
import type { Attribute, Category } from "../category_attributes_governance/types.ts";
import { applyOps, materialize, treeHash } from "./engine.ts";
import { ulid, validateOpShape } from "./ops.ts";
import type { OpParams, OpType } from "./ops.ts";
import { buildLeafQuery, buildScopeQuery, esConfigFromEnv, leafMountCounts, searchProducts } from "./es.ts";
import { productHubCookie, queryProductHub } from "./product-hub.ts";
import { suggestOps } from "./suggest.ts";
import type { LeafSample, ScopeStats } from "./suggest.ts";
import { auditTree } from "./audit.ts";
import { renderSubtree } from "./tree.ts";
import { renderTrace, resolveTombstone } from "./trace.ts";
import type { TraceHopView, TraceReport, TraceVersionState } from "./trace.ts";
import {
  adjudicateAll,
  buildEvidencePack,
  buildSystemPrompt,
  computeAgreement,
  involvedIds,
  renderAdjudicateReport,
  renderCalibrationReport,
  specSections,
  usageSummaryLine,
  EXAMPLE_CASE_IDS,
} from "./adjudicate.ts";
import type { AdjudicateItem, AgreementRow, ChatFn, ProductEvidenceItem } from "./adjudicate.ts";
import { deepseekRuntime } from "../../ai/deepseek-runtime.ts";
import { analyzeZeroMounts, buildDisableOps, mountDistribution, sampleEvenly } from "./mount-scan.ts";
import { scanNearDuplicates } from "./near-dup.ts";
import {
  allTombstonesWithOps,
  allVersionNos,
  approvedOps,
  insertTombstones,
  insertVersion,
  insertVersionNodes,
  latestNameOf,
  latestVersionNo,
  loadVersionNodes,
  migrationMapForVersion,
  versionPresence,
} from "./storage.ts";

const leafCount = (nodes: Category[]): number => nodes.filter((node) => node.isLeaf).length;

export async function importCommand(database: SQL, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const source = flags.source;
  if (!source) throw new Error("缺少 --source=<类目树 JSON 路径>");
  const existing = await latestVersionNo(database);
  if (existing !== null) throw new Error(`已存在版本 v${existing}；import 只用于初始化 version 1`);
  const raw = await readTextFile(source);
  const document = normalizeCategories(JSON.parse(raw), "v1");
  const nodes = materialize(document.nodes.map((node) => ({
    id: node.id,
    parentId: node.parentId,
    name: node.name,
    enabled: node.enabled,
    isLeaf: node.isLeaf,
    pathIds: node.pathIds,
    pathNames: node.pathNames,
    categoryId: node.categoryId,
  })));
  const hashValue = treeHash(nodes);
  await database.begin(async (tx) => {
    await insertVersion(tx, {
      versionNo: 1, baseVersionNo: null, appliedOpCount: 0, treeHash: hashValue,
      nodeCount: nodes.length, leafCount: leafCount(nodes), note: flags["version-note"] ?? null,
    });
    await insertVersionNodes(tx, 1, nodes);
  });
  console.log(`已导入 v1：节点 ${nodes.length}，末级 ${leafCount(nodes)}，tree_hash=${hashValue}`);
}

export async function proposeCommand(database: SQL, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const file = flags.file;
  if (!file) throw new Error("缺少 --file=<ops.json>");
  const base = await latestVersionNo(database);
  if (base === null) throw new Error("请先 import 初始化版本 1");
  const entries = JSON.parse(await readTextFile(file)) as unknown;
  if (!Array.isArray(entries)) throw new Error("ops 文件必须是 JSON 数组");
  let accepted = 0;
  for (const [index, entry] of entries.entries()) {
    const errors = validateOpShape(entry);
    if (errors.length > 0) {
      console.log(`跳过第 ${index + 1} 条：${errors.join("；")}`);
      continue;
    }
    const op = entry as { type: OpType; params: unknown; evidence?: unknown };
    const opId = `op-${ulid()}`;
    await database`
      INSERT INTO category_ops (op_id, base_version_no, type, params, evidence)
      VALUES (${opId}, ${base}, ${op.type}, ${JSON.stringify(op.params)}::jsonb,
              ${op.evidence === undefined ? null : JSON.stringify(op.evidence)}::jsonb)
    `;
    accepted += 1;
  }
  console.log(`已导入 ${accepted} 条提案（base=v${base}），跳过 ${entries.length - accepted} 条`);
}

async function decide(database: SQL, args: string[], status: "approved" | "rejected"): Promise<void> {
  const { flags } = parseFlags(args);
  const opId = flags.op;
  if (!opId) throw new Error("缺少 --op=<op_id>");
  const rows = await database<Array<{ status: string }>>`
    SELECT status FROM category_ops WHERE op_id = ${opId}
  `;
  const op = rows[0];
  if (!op) throw new Error(`op 不存在：${opId}`);
  // apply 整批拒绝后 op 保持 approved，必须能再 reject 掉，否则会永远阻塞后续 apply。
  const allowed = status === "approved" ? ["proposed", "rejected"] : ["proposed", "approved"];
  if (!allowed.includes(op.status)) throw new Error(`op 当前状态为 ${op.status}，只能从 ${allowed.join("/")} 变更为 ${status}`);
  await database`
    UPDATE category_ops SET status = ${status}, decided_by = ${flags.by ?? null}, decided_at = NOW()
    WHERE op_id = ${opId}
  `;
  console.log(`${opId} → ${status}${flags.by ? `（${flags.by}）` : ""}`);
}

export const approveCommand = (database: SQL, args: string[]): Promise<void> => decide(database, args, "approved");
export const rejectCommand = (database: SQL, args: string[]): Promise<void> => decide(database, args, "rejected");

export async function applyCommand(database: SQL, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const latest = await latestVersionNo(database);
  if (latest === null) throw new Error("请先 import 初始化版本 1");
  const ops = await approvedOps(database);
  if (ops.length === 0) {
    console.log("没有待应用的 approved op");
    return;
  }
  const base = await loadVersionNodes(database, latest);
  // 校验失败会抛「整批拒绝」及全部原因；op 保持 approved 状态，修正后可重试。
  const result = applyOps(base, ops, latest + 1);
  const hashValue = treeHash(result.nodes);
  await database.begin(async (tx) => {
    await insertVersion(tx, {
      versionNo: latest + 1, baseVersionNo: latest, appliedOpCount: ops.length, treeHash: hashValue,
      nodeCount: result.nodes.length, leafCount: leafCount(result.nodes), note: flags.note ?? null,
    });
    await insertVersionNodes(tx, latest + 1, result.nodes);
    await insertTombstones(tx, result.tombstones);
    for (const op of ops) {
      await tx`UPDATE category_ops SET status = 'applied', base_version_no = ${latest} WHERE op_id = ${op.opId}`;
    }
  });
  console.log(`已物化 v${latest + 1}：应用 ${ops.length} 个 op，节点 ${result.nodes.length}，末级 ${leafCount(result.nodes)}，新增墓碑 ${result.tombstones.length}`);
  console.log(`tree_hash=${hashValue}`);
}

export async function exportCommand(database: SQL, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const latest = await latestVersionNo(database);
  if (latest === null) throw new Error("还没有任何版本");
  const versionNo = flags.version ? asInt(flags.version, latest) : latest;
  const nodes = await loadVersionNodes(database, versionNo);
  const outDir = flags.out ?? resolve(import.meta.dir, "workspace", "export", `v${versionNo}`);
  await writeJsonFile(join(outDir, "category-tree.json"), { version: `v${versionNo}`, nodes });
  await writeTextFile(join(outDir, "categories.std.txt"), toStdText(nodes));
  const map = await migrationMapForVersion(database, versionNo);
  await writeJsonFile(join(outDir, "migration-map.json"), {
    fromVersion: versionNo > 1 ? `v${versionNo - 1}` : null,
    toVersion: `v${versionNo}`,
    map: map.map,
    chains: map.chains,
  });
  console.log(`已导出 v${versionNo} 到 ${outDir}：树 JSON、std text、迁移地图 ${Object.keys(map.map).length} 条（链式解析到最终存活节点）`);
}

export async function statusCommand(database: SQL): Promise<void> {
  const versions = await database<Array<{ count: number }>>`SELECT COUNT(*)::int AS count FROM category_versions`;
  const ops = await database<Array<{ status: string; count: number }>>`
    SELECT status, COUNT(*)::int AS count FROM category_ops GROUP BY status ORDER BY status
  `;
  const tombstones = await database<Array<{ count: number }>>`SELECT COUNT(*)::int AS count FROM category_tombstones`;
  console.log(`版本数：${versions[0]?.count ?? 0}`);
  console.log(`op：${ops.length === 0 ? "无" : ops.map((row) => `${row.status} ${row.count}`).join("，")}`);
  console.log(`墓碑数：${tombstones[0]?.count ?? 0}`);
}

const isSample = (value: unknown): value is LeafSample => {
  if (typeof value !== "object" || value === null) return false;
  const sample = value as Record<string, unknown>;
  return typeof sample.title === "string";
};

/** 与旧场景 context.ts 一致：id / name / 去根路径 三种选择方式，命中必须唯一。 */
function resolveScope(nodes: Category[], scopeText: string): Category {
  const matches = nodes.filter(
    (node) => node.enabled
      && (node.id === scopeText || node.name === scopeText || node.pathNames.slice(1).join("/") === scopeText),
  );
  if (matches.length !== 1) throw new Error(`范围选择必须唯一，命中 ${matches.length} 个：${scopeText}`);
  return matches[0]!;
}

export async function auditCommand(database: SQL, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const latest = await latestVersionNo(database);
  if (latest === null) throw new Error("请先 import 初始化版本 1");
  const nodes = await loadVersionNodes(database, latest);
  const scope = flags.scope ? resolveScope(nodes, flags.scope) : null;
  const { ops, report, summary } = auditTree(nodes, scope);
  const out = flags.out ?? "audit-ops.json";
  await writeJsonFile(out, ops);
  const reportPath = `${out.replace(/\.json$/u, "")}.md`;
  await writeTextFile(reportPath, report);
  console.log(
    `audit（${scope ? scope.pathNames.join(" > ") : "全树"}，v${latest}）：`
    + `重名合并 ${summary.duplicateMerges}，空壳合并 ${summary.shellMerges}，`
    + `括号变体 ${summary.bracketVariantGroups}，杂类命名 ${summary.genericNameNodes}，`
    + `禁用 ${summary.disabledNodes}，深度异常 ${summary.deepNodes + summary.mixedDepthParents}`,
  );
  console.log(`ops：${resolve(out)}\n报告：${resolve(reportPath)}`);
  console.log(`下一步：人工审阅报告后 bun run category-governance-plus propose --file=${out}（空壳合并请逐条确认再 approve）`);
}

export async function traceCommand(database: SQL, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const id = flags.id;
  if (!id) throw new Error("缺少 --id=<类目id>");
  const versionNos = await allVersionNos(database);
  if (versionNos.length === 0) throw new Error("请先 import 初始化版本 1");
  const latest = versionNos.at(-1)!;
  const presence = await versionPresence(database, id);
  const tombstones = await allTombstonesWithOps(database);
  if (presence.length === 0 && !tombstones.some((tombstone) => tombstone.oldId === id)) {
    console.log(renderTrace({ id, versions: [], hops: [], finalStatus: "never" }).join("\n"));
    return;
  }
  const byVersion = new Map(presence.map((row) => [row.versionNo, row]));
  const versions: TraceVersionState[] = versionNos.map((versionNo) => {
    const row = byVersion.get(versionNo);
    return row
      ? { versionNo, present: true, enabled: row.enabled, path: row.path }
      : { versionNo, present: false };
  });
  const resolution = resolveTombstone(tombstones, id);
  const hops: TraceHopView[] = [];
  for (const hop of resolution.hops) {
    const withOp = tombstones.find((tombstone) => tombstone.oldId === hop.oldId)!;
    hops.push({
      oldId: hop.oldId,
      oldName: await latestNameOf(database, hop.oldId),
      newId: hop.newId,
      newName: hop.newId === null ? null : await latestNameOf(database, hop.newId),
      opType: withOp.opType,
      versionNo: withOp.versionNo,
      decidedAt: withOp.decidedAt === null
        ? null
        : new Date(withOp.decidedAt).toLocaleString("zh-CN", { hour12: false }),
      reason: hop.reason,
    });
  }
  let finalPath: string[] | undefined;
  let goneReason: string | undefined;
  if (resolution.status === "alive") {
    const finalPresence = await versionPresence(database, resolution.finalId!);
    finalPath = finalPresence.find((row) => row.versionNo === latest)?.path ?? finalPresence.at(-1)?.path;
  } else {
    const last = hops.at(-1)!;
    goneReason = `${last.opType}：${last.reason}`;
  }
  const report: TraceReport = { id, versions, hops, finalStatus: resolution.status, finalPath, goneReason };
  for (const line of renderTrace(report)) console.log(line);
}

export async function treeCommand(database: SQL, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const scopeText = flags.scope;
  if (!scopeText) throw new Error("缺少 --scope=<类目名或id>");
  const latest = await latestVersionNo(database);
  if (latest === null) throw new Error("请先 import 初始化版本 1");
  const versionNo = flags.version ? asInt(flags.version, latest) : latest;
  const nodes = await loadVersionNodes(database, versionNo);
  const scope = resolveScope(nodes, scopeText);
  const maxDepth = flags["max-depth"] === undefined ? undefined : asInt(flags["max-depth"], 1, 0);

  let counts: Map<string, number> | undefined;
  if (boolFlag(flags.counts)) {
    let config: ReturnType<typeof esConfigFromEnv> | null = null;
    try {
      config = esConfigFromEnv();
    } catch {
      console.log("提示：--counts 需要 ES 配置（.env 的 ES_NODE/ES_USERNAME/ES_PASSWORD），本次仅渲染结构、不带挂载量");
    }
    if (config) {
      counts = new Map();
      const { visibleIds } = renderSubtree(nodes, scope, { maxDepth });
      for (const id of visibleIds) {
        const node = nodes.find((candidate) => candidate.id === id)!;
        // 末级查直接挂载量，分支查 idPath 子树总量
        const query = node.isLeaf ? buildLeafQuery(id, 0) : buildScopeQuery(id, 0);
        counts.set(id, (await searchProducts(config, query)).total);
      }
    }
  }

  const { lines, truncatedBranches, hiddenDescendants } = renderSubtree(nodes, scope, { maxDepth, counts });
  console.log(`范围：${scope.pathNames.join(" > ")}（v${versionNo}）`);
  for (const line of lines) console.log(line);
  if (truncatedBranches > 0) {
    console.log(`（--max-depth=${maxDepth} 截断 ${truncatedBranches} 个分支，共隐藏 ${hiddenDescendants} 个后代）`);
  }
  if (lines.length > 500) console.log(`共 ${lines.length} 行，建议用 --max-depth 截断或缩小 --scope`);
}

async function collectStatsFromEs(
  scope: Category,
  leaves: Category[],
  size: number,
): Promise<ScopeStats> {
  const config = esConfigFromEnv();
  const stats: ScopeStats = {
    leaves: [],
    scopeSamples: [],
    sourceNote: "商品库（isStdProduct=true，standardCategory.id/idPath 匹配）",
  };
  for (const leaf of leaves) {
    // 直接挂载量：total 与样本同一次查询拿回（track_total_hits）
    const { total, samples } = await searchProducts(config, buildLeafQuery(leaf.id, size));
    stats.leaves.push({
      id: leaf.id, name: leaf.name, path: leaf.pathNames, productCount: total, samples,
    });
  }
  const scoped = await searchProducts(config, buildScopeQuery(scope.id, size));
  stats.scopeSamples = scoped.samples;
  return stats;
}

function validateFixtureStats(value: unknown, validLeafIds: Set<string>): ScopeStats {
  if (typeof value !== "object" || value === null) throw new Error("fixture 必须是对象");
  const stats = value as { leaves?: unknown; scopeSamples?: unknown };
  if (!Array.isArray(stats.leaves) || !Array.isArray(stats.scopeSamples)) {
    throw new Error("fixture 必须是 {leaves:[{id,name,path,productCount,samples}], scopeSamples:[...]} 结构");
  }
  const leaves = stats.leaves.map((entry, index) => {
    const leaf = entry as Record<string, unknown>;
    if (typeof leaf.id !== "string" || typeof leaf.name !== "string"
      || !Array.isArray(leaf.path) || typeof leaf.productCount !== "number"
      || !Array.isArray(leaf.samples) || !leaf.samples.every(isSample)) {
      throw new Error(`fixture leaves 第 ${index + 1} 条结构不合法`);
    }
    if (!validLeafIds.has(leaf.id)) throw new Error(`fixture 类目不在当前版本范围内：${leaf.id}（${leaf.name}）`);
    return {
      id: leaf.id,
      name: leaf.name,
      path: leaf.path.map(String),
      productCount: leaf.productCount,
      samples: leaf.samples,
    };
  });
  if (!stats.scopeSamples.every(isSample)) throw new Error("fixture scopeSamples 结构不合法");
  return { leaves, scopeSamples: stats.scopeSamples };
}

export async function suggestCommand(database: SQL, args: string[]): Promise<void> {  const { flags } = parseFlags(args);
  const scopeText = flags.scope;
  if (!scopeText) throw new Error("缺少 --scope=<类目名或id>");
  const latest = await latestVersionNo(database);
  if (latest === null) throw new Error("请先 import 初始化版本 1");
  const nodes = await loadVersionNodes(database, latest);
  const scope = resolveScope(nodes, scopeText);
  const leaves = nodes
    .filter((node) => node.enabled && node.isLeaf && node.pathIds.includes(scope.id))
    .sort((a, b) => a.pathIds.join("/").localeCompare(b.pathIds.join("/")));
  if (leaves.length === 0) throw new Error(`范围 ${scope.name} 下没有启用的末级类目`);

  const size = asInt(flags.size, 200);
  const minProducts = asInt(flags["min-products"], 50);
  let stats: ScopeStats;
  let skipped = 0;
  if (flags.fixture) {
    stats = validateFixtureStats(
      JSON.parse(await readTextFile(flags.fixture)),
      new Set(leaves.map((leaf) => leaf.id)),
    );
    const covered = new Set(stats.leaves.map((leaf) => leaf.id));
    skipped = leaves.filter((leaf) => !covered.has(leaf.id)).length;
  } else {
    stats = await collectStatsFromEs(scope, leaves, size);
  }
  const baseTemplate = flags["base-template"]
    ? JSON.parse(await readTextFile(flags["base-template"])) as { rows: Array<{ categoryId: string; attributes: Attribute[] }> }
    : undefined;

  const { ops, report } = suggestOps(
    { id: scope.id, name: scope.name, path: scope.pathNames },
    stats,
    { minProducts, baseTemplate },
  );
  const out = flags.out ?? "ops.json";
  await writeJsonFile(out, ops);
  const reportPath = `${out.replace(/\.json$/u, "")}.md`;
  await writeTextFile(reportPath, report);
  const count = (type: string): number => ops.filter((op) => op.type === type).length;
  console.log(
    `候选：merge ${count("merge")}，split ${count("split")}，disable ${count("disable")}，add ${count("add")}`
    + `（范围 ${scope.pathNames.join(" > ")}，v${latest}${flags.fixture ? "，fixture 模式" : ""}）`,
  );
  if (skipped > 0) console.log(`注意：范围内 ${skipped} 个末级类目在 fixture 中没有 stats，已跳过`);
  console.log(`ops：${resolve(out)}\n报告：${resolve(reportPath)}`);
  console.log(`下一步：bun run category-governance-plus propose --file=${out}`);
}

// ---------------------------------------------------------------- LLM 裁决器

const SPEC_PATH = resolve(import.meta.dir, "CATEGORY-DESIGN-SPEC.md");

/** 商品证据：优先商品库管理后台 SKU 口径（PRODUCT_HUB_COOKIE），缺失/失败回退 ES std 口径。
 * 末级拉挂载量+5 条样本标题，分支用子树查询只取量；dedupe 后 8 并发。 */
async function collectProductEvidence(nodes: Category[], involved: string[]): Promise<ProductEvidenceItem[]> {
  const hubCookie = productHubCookie();
  const config = hubCookie ? null : esConfigFromEnv();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ids = [...new Set(involved)].filter((id) => byId.has(id));
  const evidence = new Array<ProductEvidenceItem | null>(ids.length).fill(null);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= ids.length) return;
      const id = ids[index]!;
      if (hubCookie) {
        const { count, samples } = await queryProductHub(hubCookie, id, 5);
        evidence[index] = { id, productCount: count, sampleTitles: samples.map((s) => s.title) };
      } else {
        const node = byId.get(id)!;
        if (node.isLeaf) {
          const { total, samples } = await searchProducts(config!, buildLeafQuery(id, 5));
          evidence[index] = { id, productCount: total, sampleTitles: samples.map((sample) => sample.title) };
        } else {
          const { total } = await searchProducts(config!, buildScopeQuery(id, 0));
          evidence[index] = { id, productCount: total, sampleTitles: [] };
        }
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, () => worker()));
  return evidence.map((item) => item!);
}

interface OpsFileEntry {
  type: OpType;
  params: OpParams;
  evidence?: unknown;
}

async function loadOpsFile(file: string): Promise<OpsFileEntry[]> {
  const entries = JSON.parse(await readTextFile(file)) as unknown;
  if (!Array.isArray(entries)) throw new Error("ops 文件必须是 JSON 数组");
  return entries as OpsFileEntry[];
}

function modelName(flag: string | undefined, fallback: string): string {
  if (!flag || flag === "flash") return fallback;
  if (flag === "pro") return "deepseek-v4-pro";
  return flag;
}

export async function adjudicateCommand(database: SQL, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const file = flags.file;
  if (!file) throw new Error("缺少 --file=<ops.json>");
  const latest = await latestVersionNo(database);
  if (latest === null) throw new Error("请先 import 初始化版本 1");
  const nodes = await loadVersionNodes(database, latest);
  const ops = await loadOpsFile(file);
  const specText = await readTextFile(SPEC_PATH);
  const sections = specSections(specText);

  let productEvidence: ProductEvidenceItem[] = [];
  try {
    const involved = ops.flatMap((op) => involvedIds(op).map(({ id }) => id));
    console.log(`拉取商品证据：${new Set(involved).size} 个节点…`);
    productEvidence = await collectProductEvidence(nodes, involved);
  } catch (error) {
    console.log(`提示：商品证据拉取失败（${error instanceof Error ? error.message : String(error)}），本次仅靠结构证据裁决`);
  }

  const items: AdjudicateItem[] = ops.map((op, index) => ({
    id: `op-${index + 1}`,
    op,
    pack: buildEvidencePack(op, nodes, sections,
      productEvidence.filter((item) => involvedIds(op).some(({ id }) => id === item.id))),
  }));

  const runtime = await deepseekRuntime(flags.direct === "true");
  const batch = await adjudicateAll(runtime.chat as ChatFn, items, {
    model: modelName(flags.model, runtime.model),
    systemPrompt: buildSystemPrompt(specText),
    concurrency: asInt(flags.concurrency, 8),
    budgetCny: Number(flags["budget-cny"] ?? 10),
  });

  const outDir = flags.out ?? resolve(import.meta.dir, "workspace", `adjudicate-${new Date().toISOString().replaceAll(":", "-")}`);
  const jsonl = batch.outcomes.map((outcome) => {
    const item = items.find((candidate) => candidate.id === outcome.id)!;
    return JSON.stringify({ id: outcome.id, op: item.op, pack: item.pack, outcome });
  }).join("\n");
  await writeTextFile(join(outDir, "verdicts.jsonl"), `${jsonl}\n`);
  const report = renderAdjudicateReport(items, batch, `adjudicate 裁决报告（${file}，v${latest}）`);
  await writeTextFile(join(outDir, "report.md"), report);
  const counts = { approve: 0, reject: 0, uncertain: 0 };
  for (const outcome of batch.outcomes) counts[outcome.verdict.verdict] += 1;
  console.log(`裁决完成：approve ${counts.approve}，reject ${counts.reject}，uncertain ${counts.uncertain}（共 ${batch.outcomes.length} 条${batch.stoppedByBudget ? "，预算停止" : ""}）`);
  console.log(usageSummaryLine(batch.usage));
  console.log(`产物：${resolve(outDir)}（verdicts.jsonl + report.md）。未改 DB、未 propose/apply，请抽验后再走人工流程`);
}

interface CalibrationCaseFile {
  examples?: string[];
  cases: Array<{
    id: string;
    label: string;
    op: OpsFileEntry;
    pack: AdjudicateItem["pack"];
    expected: { verdict: "approve" | "reject"; targetOverride?: string; reason?: string };
  }>;
}

export async function adjudicateCalibrateCommand(args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const casesPath = flags.cases ?? resolve(import.meta.dir, "calibration", "cases.json");
  const data = JSON.parse(await readTextFile(casesPath)) as CalibrationCaseFile;
  const exampleIds = new Set(data.examples ?? EXAMPLE_CASE_IDS);
  const scored = data.cases.filter((entry) => !exampleIds.has(entry.id));
  const specText = await readTextFile(SPEC_PATH);

  const items: AdjudicateItem[] = scored.map((entry) => ({ id: entry.id, op: entry.op, pack: entry.pack }));
  const runtime = await deepseekRuntime(flags.direct === "true");
  const batch = await adjudicateAll(runtime.chat as ChatFn, items, {
    model: modelName(flags.model, runtime.model),
    systemPrompt: buildSystemPrompt(specText),
    concurrency: asInt(flags.concurrency, 8),
    budgetCny: Number(flags["budget-cny"] ?? 5),
  });

  const outcomeById = new Map(batch.outcomes.map((outcome) => [outcome.id, outcome]));
  const rows: AgreementRow[] = scored.map((entry) => ({
    id: `${entry.id} ${entry.label}`,
    expected: entry.expected,
    actual: outcomeById.get(entry.id)?.verdict ?? null,
  }));
  const result = computeAgreement(rows);

  const outDir = flags.out ?? resolve(import.meta.dir, "workspace", "calibration");
  const { readdir } = await import("node:fs/promises");
  const existing = await readdir(outDir).catch(() => [] as string[]);
  const round = existing.filter((name) => /^round-\d+\.md$/u.test(name)).length + 1;
  await writeTextFile(join(outDir, `round-${round}.md`), renderCalibrationReport(result, rows, round));
  const jsonl = batch.outcomes.map((outcome) => {
    const item = items.find((candidate) => candidate.id === outcome.id)!;
    return JSON.stringify({ id: outcome.id, op: item.op, outcome });
  }).join("\n");
  await writeTextFile(join(outDir, `round-${round}.verdicts.jsonl`), `${jsonl}\n`);

  console.log(`校准第 ${round} 轮：计分 ${result.total} 案（示例 ${exampleIds.size} 案不计分），一致 ${result.agreed}，一致率 ${(result.rate * 100).toFixed(1)}%`);
  console.log(`targetOverride：${result.targetChecked} 案考察，命中 ${result.targetAgreed}`);
  for (const mismatch of result.mismatches) {
    console.log(`不一致：${mismatch.id}｜expected ${mismatch.expectedVerdict} / actual ${mismatch.actualVerdict}｜${mismatch.actualReason.slice(0, 80)}`);
  }
  console.log(usageSummaryLine(batch.usage));
  console.log(`报告：${resolve(join(outDir, `round-${round}.md`))}`);
}

// ---------------------------------------------------------------- 挂载扫描与近似名重复扫描

export async function mountScanCommand(database: SQL, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const latest = await latestVersionNo(database);
  if (latest === null) throw new Error("请先 import 初始化版本 1");
  const nodes = await loadVersionNodes(database, latest);
  const leaves = nodes.filter((node) => node.enabled && node.isLeaf);
  const config = esConfigFromEnv();
  const counts = await leafMountCounts(config);

  const outDir = flags.out ?? resolve(import.meta.dir, "workspace", "mount-scan");
  await writeJsonFile(join(outDir, "counts.json"),
    Object.fromEntries(leaves.map((leaf) => [leaf.id, counts.get(leaf.id) ?? 0])));

  const dist = mountDistribution(leaves, counts);
  const zero = analyzeZeroMounts(nodes, counts);
  await writeJsonFile(join(outDir, "zero-mount.json"), zero);

  const genericCount = zero.filter((item) => item.generic).length;
  const deadCount = zero.filter((item) => item.branchDead).length;
  const lines: string[] = [
    `# 全树挂载分布扫描（v${latest}）`,
    ``,
    `enabled 末级 ${leaves.length}，商品库挂载合计 ${dist.mountedTotal}`,
    ``,
    `## 分布`,
    ``,
    `- 0：${dist.zero}`,
    `- 1-5：${dist.oneToFive}`,
    `- 6-20：${dist.sixToTwenty}`,
    `- 21-99：${dist.twentyOneToNinetyNine}`,
    `- 100+：${dist.hundredPlus}`,
    `- 中位数：${dist.median}`,
    ``,
    `## 挂载量 top20`,
    ``,
    ...dist.top.map((entry) => `- ${entry.count}｜${entry.path.join(" > ")}`),
    ``,
    `## 零挂载（${zero.length}）：枯枝 ${deadCount}，单独裸奔 ${zero.length - deadCount}，杂类词表命中 ${genericCount}`,
    ``,
    `零挂载 ≠ 直接 disable：全量过裁决器区分「建议 disable」vs「保留观察」。`,
  ];
  await writeTextFile(join(outDir, "report.md"), `${lines.join("\n")}\n`);
  console.log(lines.slice(2, 11).join("\n"));
  console.log(`零挂载 ${zero.length}（枯枝 ${deadCount}，裸奔 ${zero.length - deadCount}，杂类 ${genericCount}）`);
  console.log(`产物：${resolve(outDir)}（counts.json / report.md / zero-mount.json）`);

  // 零挂载 disable 提案全量过裁决器；>1500 先跑 500 等距样本
  const ops = buildDisableOps(zero);
  const sampled = ops.length > 1500;
  const judged = sampled ? sampleEvenly(ops, 500) : ops;
  if (sampled) console.log(`零挂载 ${ops.length} 条 > 1500，先跑等距样本 500 条，由人决定是否全量`);
  const specText = await readTextFile(SPEC_PATH);
  const sections = specSections(specText);
  const items: AdjudicateItem[] = judged.map((op, index) => {
    const evidence = op.evidence as { siblingMounts: Record<string, number>; siblingMountTotal: number; branchDead: boolean; generic: boolean };
    const siblingText = Object.entries(evidence.siblingMounts).map(([name, mount]) => `${name} ${mount}`).join("、") || "（无 enabled 兄弟）";
    const notes = [
      `兄弟挂载：${siblingText}`,
      `分支判断：${evidence.branchDead ? "整支无货（枯枝）" : `单独裸奔（兄弟合计挂载 ${evidence.siblingMountTotal}）`}`,
      `杂类词表命中：${evidence.generic ? "是" : "否"}`,
    ];
    return {
      id: `zero-${index + 1}`,
      op,
      pack: buildEvidencePack(op, nodes, sections,
        [{ id: op.params.id, productCount: 0, sampleTitles: [] }], notes),
    };
  });
  const runtime = await deepseekRuntime(flags.direct === "true");
  const batch = await adjudicateAll(runtime.chat as ChatFn, items, {
    model: modelName(flags.model, runtime.model),
    systemPrompt: buildSystemPrompt(specText),
    concurrency: asInt(flags.concurrency, 8),
    budgetCny: Number(flags["budget-cny"] ?? 10),
  });
  const verdictDir = join(outDir, "disable-verdicts");
  const jsonl = batch.outcomes.map((outcome) => {
    const item = items.find((candidate) => candidate.id === outcome.id)!;
    return JSON.stringify({ id: outcome.id, op: item.op, pack: item.pack, outcome });
  }).join("\n");
  await writeTextFile(join(verdictDir, "verdicts.jsonl"), `${jsonl}\n`);
  await writeTextFile(join(verdictDir, "report.md"), renderAdjudicateReport(items, batch,
    `零挂载 disable 裁决报告（v${latest}${sampled ? "，等距样本 500/" + ops.length : "，全量"}）`));
  const counts2 = { approve: 0, reject: 0, uncertain: 0 };
  for (const outcome of batch.outcomes) counts2[outcome.verdict.verdict] += 1;
  console.log(`零挂载裁决：approve ${counts2.approve}，reject ${counts2.reject}，uncertain ${counts2.uncertain}（${batch.outcomes.length} 条）`);
  console.log(usageSummaryLine(batch.usage));
  console.log(`裁决产物：${resolve(verdictDir)}。未 propose/approve/apply，人抽验后再走流程`);
}

export async function nearDupCommand(database: SQL, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const latest = await latestVersionNo(database);
  if (latest === null) throw new Error("请先 import 初始化版本 1");
  const nodes = await loadVersionNodes(database, latest);
  const leaves = nodes.filter((node) => node.enabled && node.isLeaf);
  let threshold = Number(flags.threshold ?? 0.75);
  let pairs = scanNearDuplicates(leaves, { threshold });
  if (pairs.length > 800 && threshold < 0.85) {
    console.log(`候选 ${pairs.length} 对 > 800，收紧阈值到 0.85 重扫`);
    threshold = 0.85;
    pairs = scanNearDuplicates(leaves, { threshold });
  }
  console.log(`近似名候选 ${pairs.length} 对（阈值 ${threshold}，同域 ${pairs.filter((pair) => pair.sameDomain).length} / 跨域 ${pairs.filter((pair) => !pair.sameDomain).length}）`);

  const involved = pairs.flatMap((pair) => [pair.aId, pair.bId]);
  const productEvidence = await collectProductEvidence(nodes, involved);
  const evidenceById = new Map(productEvidence.map((item) => [item.id, item]));

  const outDir = flags.out ?? resolve(import.meta.dir, "workspace", "near-dup");
  await writeJsonFile(join(outDir, "candidates.json"), pairs.map((pair) => ({
    ...pair,
    aMount: evidenceById.get(pair.aId)?.productCount ?? 0,
    bMount: evidenceById.get(pair.bId)?.productCount ?? 0,
    aSamples: evidenceById.get(pair.aId)?.sampleTitles ?? [],
    bSamples: evidenceById.get(pair.bId)?.sampleTitles ?? [],
  })));

  // merge 提案：target 取挂载多者（并列取 id 小者），仅作建议（校准结论：target 机器判不准）
  const ops = pairs.map((pair) => {
    const aMount = evidenceById.get(pair.aId)?.productCount ?? 0;
    const bMount = evidenceById.get(pair.bId)?.productCount ?? 0;
    const target = aMount === bMount ? (pair.aId < pair.bId ? pair.aId : pair.bId) : (aMount > bMount ? pair.aId : pair.bId);
    return {
      type: "merge" as const,
      params: { sources: [pair.aId, pair.bId], target, reason: `近似名重复（相似度 ${pair.similarity}），建议合并（target 仅作建议）` },
      evidence: {
        kind: "近似名重复",
        similarity: pair.similarity,
        sameDomain: pair.sameDomain,
        aPath: pair.aPath,
        bPath: pair.bPath,
        aMount,
        bMount,
      },
    };
  });
  const specText = await readTextFile(SPEC_PATH);
  const sections = specSections(specText);
  const items: AdjudicateItem[] = ops.map((op, index) => {
    const evidence = op.evidence as { similarity: number; sameDomain: boolean };
    const notes = [
      `同域/跨域：${evidence.sameDomain ? "同域" : "跨域（高风险，参照奶粉案：同名不同物）"}`,
      `bigram 相似度 ${evidence.similarity}`,
      `target 仅作建议（校准结论：存续者机器判不准，人审定夺）`,
    ];
    return {
      id: `dup-${index + 1}`,
      op,
      pack: buildEvidencePack(op, nodes, sections,
        productEvidence.filter((item) => item.id === op.params.sources[0] || item.id === op.params.sources[1]),
        notes),
    };
  });
  const runtime = await deepseekRuntime(flags.direct === "true");
  const batch = await adjudicateAll(runtime.chat as ChatFn, items, {
    model: modelName(flags.model, runtime.model),
    systemPrompt: buildSystemPrompt(specText),
    concurrency: asInt(flags.concurrency, 8),
    budgetCny: Number(flags["budget-cny"] ?? 10),
  });

  const verdictDir = join(outDir, "verdicts");
  const jsonl = batch.outcomes.map((outcome) => {
    const item = items.find((candidate) => candidate.id === outcome.id)!;
    return JSON.stringify({ id: outcome.id, op: item.op, pack: item.pack, outcome });
  }).join("\n");
  await writeTextFile(join(verdictDir, "verdicts.jsonl"), `${jsonl}\n`);
  // 同域/跨域分组报告
  const sameItems = items.filter((item) => (item.op.evidence as { sameDomain: boolean }).sameDomain);
  const crossItems = items.filter((item) => !(item.op.evidence as { sameDomain: boolean }).sameDomain);
  const subBatch = (sub: AdjudicateItem[]): typeof batch => ({
    ...batch,
    outcomes: batch.outcomes.filter((outcome) => sub.some((item) => item.id === outcome.id)),
  });
  const report = [
    renderAdjudicateReport(sameItems, subBatch(sameItems), `近似名重复裁决（同域 ${sameItems.length} 对，v${latest}，阈值 ${threshold}）`),
    renderAdjudicateReport(crossItems, subBatch(crossItems), `近似名重复裁决（跨域 ${crossItems.length} 对，高风险）`),
  ].join("\n---\n\n");
  await writeTextFile(join(verdictDir, "report.md"), report);
  const counts3 = { approve: 0, reject: 0, uncertain: 0 };
  for (const outcome of batch.outcomes) counts3[outcome.verdict.verdict] += 1;
  console.log(`近似名裁决：approve ${counts3.approve}，reject ${counts3.reject}，uncertain ${counts3.uncertain}（${batch.outcomes.length} 条）`);
  console.log(usageSummaryLine(batch.usage));
  console.log(`产物：${resolve(outDir)}（candidates.json + verdicts/）。target 仅作建议；未 propose/approve/apply`);
}
