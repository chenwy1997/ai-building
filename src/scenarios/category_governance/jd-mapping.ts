import { shortCategoryId } from "./util.ts";
import type { CategoryNode } from "./types.ts";
import type { JdCategoryReference } from "./jd-collector.ts";

export type JdMappingStatus = "auto_exact" | "auto_exact_path" | "auto_parent" | "review" | "unmatched";

export interface JdMappingCandidate {
  id: string;
  name: string;
  path: string[];
  score: number;
  reasons: string[];
}

export interface JdCategoryMapping {
  targetId: string;
  targetShortId: string;
  targetName: string;
  targetPath: string[];
  status: JdMappingStatus;
  candidates: JdMappingCandidate[];
}

export interface JdCategoryMappingDocument {
  version: "jd-mapping-v1";
  generatedAt: string;
  source: string;
  stats: {
    targetCount: number;
    autoCount: number;
    reviewCount: number;
    unmatchedCount: number;
  };
  mappings: JdCategoryMapping[];
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\s\-_/·（）()]+/gu, "");
}

function pathOverlap(target: CategoryNode, candidate: JdCategoryReference): number {
  const targetAncestors = new Set(target.pathNames.slice(1, -1).map(normalize));
  return candidate.path.slice(0, -1).map(normalize).filter((part) => targetAncestors.has(part)).length;
}

function isGenericName(value: string): boolean {
  return new Set(["手机", "配件", "附件", "配套", "设备", "产品", "工具", "材料", "用品", "服务", "其他", "其它", "家具", "电器", "耗材", "零件", "包装"]).has(value);
}

function scoreContainment(target: CategoryNode, candidate: JdCategoryReference): JdMappingCandidate | null {
  const targetName = normalize(target.name);
  const candidateName = normalize(candidate.name);
  if (candidateName.length < 2 || targetName === candidateName) return null;
  if (!targetName.includes(candidateName) && !candidateName.includes(targetName)) return null;
  const overlap = pathOverlap(target, candidate);
  let score = 0.58;
  const reasons = ["名称存在包含关系"];
  if (candidateName.length >= 3) score += 0.06;
  if (overlap > 0) {
    score += Math.min(0.2, overlap * 0.12);
    reasons.push(`父级路径重合${overlap}段`);
  }
  if (targetName.includes(candidateName) && targetName.length - candidateName.length <= 6) {
    score += 0.06;
    reasons.push("京东名称是三横类目的核心词");
  }
  if (isGenericName(candidateName)) {
    score -= 0.25;
    reasons.push("京东名称过于泛化");
  }
  return {
    id: candidate.id,
    name: candidate.name,
    path: candidate.path,
    score: Number(Math.max(0, Math.min(score, 0.95)).toFixed(3)),
    reasons,
  };
}

function exactCandidates(target: CategoryNode, references: JdCategoryReference[]): JdMappingCandidate[] {
  const name = normalize(target.name);
  return references.filter((reference) => normalize(reference.name) === name).map((reference) => ({
    id: reference.id,
    name: reference.name,
    path: reference.path,
    score: 1,
    reasons: ["末级名称完全一致"],
  })).sort((left, right) => pathOverlap(target, references.find((item) => item.id === right.id)!) - pathOverlap(target, references.find((item) => item.id === left.id)!));
}

export function buildJdCategoryMapping(
  targets: CategoryNode[],
  references: JdCategoryReference[],
): JdCategoryMappingDocument {
  const mappings = targets.map((target): JdCategoryMapping => {
    const exact = exactCandidates(target, references);
    if (exact.length === 1) {
      return { targetId: target.id, targetShortId: shortCategoryId(target.id), targetName: target.name, targetPath: target.pathNames, status: "auto_exact", candidates: exact };
    }
    if (exact.length > 1) {
      const bestOverlap = pathOverlap(target, references.find((item) => item.id === exact[0]!.id)!);
      const nextOverlap = pathOverlap(target, references.find((item) => item.id === exact[1]!.id)!);
      const status: JdMappingStatus = bestOverlap > nextOverlap && bestOverlap > 0 ? "auto_exact_path" : "review";
      return { targetId: target.id, targetShortId: shortCategoryId(target.id), targetName: target.name, targetPath: target.pathNames, status, candidates: exact.slice(0, 5) };
    }
    const candidates = references.map((reference) => scoreContainment(target, reference)).filter((item): item is JdMappingCandidate => Boolean(item))
      .sort((left, right) => right.score - left.score || left.path.join(">").localeCompare(right.path.join(">"))).slice(0, 5);
    const margin = (candidates[0]?.score ?? 0) - (candidates[1]?.score ?? 0);
    const status: JdMappingStatus = candidates.length === 0
      ? "unmatched"
      : candidates[0]!.score >= 0.75 && margin >= 0.1 && candidates[0]!.reasons.some((reason) => reason.startsWith("父级路径重合"))
        ? "auto_parent"
        : "review";
    return { targetId: target.id, targetShortId: shortCategoryId(target.id), targetName: target.name, targetPath: target.pathNames, status, candidates };
  });
  const autoCount = mappings.filter((item) => item.status.startsWith("auto_")).length;
  return {
    version: "jd-mapping-v1",
    generatedAt: new Date().toISOString(),
    source: "sanheng-category-tree + ai-core jdvop_categories",
    stats: {
      targetCount: mappings.length,
      autoCount,
      reviewCount: mappings.filter((item) => item.status === "review").length,
      unmatchedCount: mappings.filter((item) => item.status === "unmatched").length,
    },
    mappings,
  };
}

export function autoJdCategoryReferences(document: JdCategoryMappingDocument): JdCategoryReference[] {
  return document.mappings.filter((mapping) => mapping.status.startsWith("auto_") && mapping.candidates[0]).map((mapping) => ({
    id: mapping.candidates[0]!.id,
    name: mapping.targetName,
    path: mapping.candidates[0]!.path,
    targetIds: [mapping.targetId, mapping.targetShortId],
  }));
}
