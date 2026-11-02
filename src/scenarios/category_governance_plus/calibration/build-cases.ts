/**
 * 校准考卷生成：8 组重名（audit-ops.json 结构 + review-decisions.json 答案）+ pet-v3 15 条（全 approve）。
 * 裁决包快照基于 v1 树（裁决作出时的树状态）+ 商品库证据（生成时拉一次 ES 冻结，校准跑不再查）。
 * 用法：bun run src/scenarios/category_governance_plus/calibration/build-cases.ts
 */
import { resolve } from "node:path";
import { DatabaseHub } from "../../../platform/database/index.ts";
import { loadAppConfig } from "../../../config/env.ts";
import { readJsonFile, writeJsonFile } from "../../../facilities/json/files.ts";
import { buildLeafQuery, buildScopeQuery, esConfigFromEnv, searchProducts } from "../es.ts";
import { loadVersionNodes } from "../storage.ts";
import { buildEvidencePack, involvedIds, specSections } from "../adjudicate.ts";
import type { EvidencePack, ProductEvidenceItem } from "../adjudicate.ts";
import type { OpParams, OpType } from "../ops.ts";
import type { Category } from "../../category_attributes_governance/types.ts";

const SCENARIO_DIR = resolve(import.meta.dir, "..");
const SAMPLE_SIZE = 5;

interface OpEntry { type: OpType; params: OpParams; evidence?: unknown }

interface CalibrationCase {
  id: string;
  label: string;
  op: OpEntry;
  pack: EvidencePack;
  expected: { verdict: "approve" | "reject"; targetOverride?: string; reason?: string };
}

async function productEvidenceFor(
  ids: string[],
  nodes: Category[],
): Promise<ProductEvidenceItem[]> {
  const config = esConfigFromEnv();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const evidence: ProductEvidenceItem[] = [];
  for (const id of ids) {
    const node = byId.get(id);
    if (!node) continue;
    if (node.isLeaf) {
      const { total, samples } = await searchProducts(config, buildLeafQuery(id, SAMPLE_SIZE));
      evidence.push({ id, productCount: total, sampleTitles: samples.map((sample) => sample.title) });
    } else {
      const { total } = await searchProducts(config, buildScopeQuery(id, 0));
      evidence.push({ id, productCount: total, sampleTitles: [] });
    }
  }
  return evidence;
}

async function main(): Promise<void> {
  const hub = new DatabaseHub(loadAppConfig().postgresUrl);
  const database = hub.scenarioDatabase("category_governance_plus");
  // 裁决作出时的树状态是 v1（8 组重名 2026-09-21 上午裁决后物化 v2；pet-v3 提案同样面向 v1 结构）
  const nodes = await loadVersionNodes(database, 1);
  await hub.closeAll();
  const specText = await Bun.file(resolve(SCENARIO_DIR, "CATEGORY-DESIGN-SPEC.md")).text();
  const sections = specSections(specText);

  const auditOps = await readJsonFile(resolve(SCENARIO_DIR, "workspace/audit/audit-ops.json")) as OpEntry[];
  const decisions = await readJsonFile(resolve(SCENARIO_DIR, "workspace/audit/review-decisions.json")) as {
    decisions: Array<{ group: string; decision: "approve" | "reject"; target?: string; reason: string }>;
  };
  const petOps = await readJsonFile(resolve(SCENARIO_DIR, "workspace/pet-v3/ops.json")) as OpEntry[];

  const dupOps = auditOps.filter((op) => (op.evidence as { kind?: string })?.kind === "归一化重名");
  const allOps: Array<{ caseId: string; label: string; op: OpEntry; expected: CalibrationCase["expected"] }> = [];
  for (const op of dupOps) {
    const name = (op.evidence as { normalizedName: string }).normalizedName;
    const decision = decisions.decisions.find((entry) => entry.group.startsWith(name));
    if (!decision) throw new Error(`review-decisions 缺少「${name}」组`);
    const target = (op.params as { target: string }).target;
    allOps.push({
      caseId: `dup:${name}`,
      label: `重名「${name}」`,
      op,
      expected: {
        verdict: decision.decision,
        ...(decision.target && decision.target !== target ? { targetOverride: decision.target } : {}),
        reason: decision.reason,
      },
    });
  }
  petOps.forEach((op, index) => {
    const reason = ((op.evidence as { reason?: string })?.reason ?? "").slice(0, 30);
    allOps.push({
      caseId: `pet:${String(index + 1).padStart(2, "0")}`,
      label: `pet-v3 ${op.type}（${reason}）`,
      op,
      expected: { verdict: "approve", reason: (op.evidence as { reason?: string })?.reason },
    });
  });

  const evidenceIds = [...new Set(allOps.flatMap(({ op }) => involvedIds(op).map(({ id }) => id)))];
  console.log(`拉取商品证据：${evidenceIds.length} 个节点…`);
  const productEvidence = await productEvidenceFor(evidenceIds, nodes);

  const cases: CalibrationCase[] = allOps.map(({ caseId, label, op, expected }) => ({
    id: caseId,
    label,
    op,
    pack: buildEvidencePack(op, nodes, sections, productEvidence.filter((item) =>
      involvedIds(op).some(({ id }) => id === item.id))),
    expected,
  }));

  const out = resolve(import.meta.dir, "cases.json");
  await writeJsonFile(out, {
    version: "calibration-v1",
    builtAt: new Date().toISOString(),
    treeVersion: "v1",
    examples: ["dup:警示灯", "dup:警戒带", "dup:奶粉", "dup:静电消除剂"],
    cases,
  });
  console.log(`已写 ${out}：${cases.length} 案（dup ${dupOps.length} + pet ${petOps.length}）`);
}

await main();
