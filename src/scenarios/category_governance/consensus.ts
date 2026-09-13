import type { AttributeProperty, GovernanceResult } from "./types.ts";

export type AttributeDecisionStatus = "confirmed" | "candidate" | "review";

export interface GovernanceObservation {
  runId: string;
  result: GovernanceResult;
}

export interface AttributeCandidate extends AttributeProperty {
  decision: AttributeDecisionStatus;
  runCount: number;
  observationCount: number;
  coverage: number;
  requiredRate: number;
  sharedRate: number;
  sourceRuns: string[];
  reasons: string[];
}

export interface CategoryConsensus {
  category: GovernanceResult["category"];
  runCount: number;
  shared: AttributeCandidate[];
  properties: AttributeCandidate[];
  notes: string[];
}

export interface AttributeConsensusDocument {
  version: "attribute-consensus-v1";
  generatedAt: string;
  sourceRuns: string[];
  thresholds: {
    confirmedCoverage: number;
    candidateCoverage: number;
    minConfirmedRuns: number;
  };
  stats: {
    categoryCount: number;
    candidateCount: number;
    confirmedCount: number;
    candidateStatusCount: number;
    reviewCount: number;
  };
  categories: CategoryConsensus[];
}

export interface ConfirmedTemplateDocument {
  version: "attribute-template-v1";
  generatedAt: string;
  sourceRuns: string[];
  categories: Array<{
    category: GovernanceResult["category"];
    shared: AttributeProperty[];
    properties: AttributeProperty[];
    notes: string[];
  }>;
}

interface PropertyGroup {
  values: AttributeProperty[];
  runIds: Set<string>;
  requiredRuns: Set<string>;
  sharedRuns: Set<string>;
}

const CANONICAL_NAMES: Record<string, string> = {
  "品牌": "brand",
  "型号": "model",
  "颜色": "color",
  "材质": "material",
  "操作系统": "operating_system",
  "运行内存": "ram",
  "网络制式": "network_standard",
  "屏幕尺寸": "screen_size",
  "存储容量": "storage_capacity",
  "电池容量": "battery_capacity",
  "上市日期": "release_date",
  "长度": "length",
  "宽度": "width",
  "高度": "height",
  "厚度": "thickness",
  "重量": "weight",
  "功率": "power",
  "电压": "voltage",
};

function normalizeName(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\s\-_\/·（）()]+/gu, "");
}

function groupKey(property: AttributeProperty): string {
  return CANONICAL_NAMES[property.name.trim()] ?? normalizeName(property.name);
}

function frequency<T>(values: T[], fallback: T): T {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback;
}

function representative(group: PropertyGroup): AttributeProperty {
  const first = group.values[0]!;
  const type = frequency(group.values.map((value) => value.type), first.type);
  const unit = frequency(group.values.map((value) => value.unit ?? ""), first.unit ?? "") || null;
  const description = frequency(group.values.map((value) => value.description ?? "").filter(Boolean), first.description ?? "");
  const format = frequency(group.values.map((value) => value.format ?? "").filter(Boolean), first.format ?? "") || null;
  const example = frequency(group.values.map((value) => value.example ?? "").filter(Boolean), first.example ?? "") || null;
  const options = [...new Set(group.values.flatMap((value) => value.options ?? []))].slice(0, 30);
  return {
    ...first,
    key: frequency(group.values.map((value) => value.key), first.key),
    name: frequency(group.values.map((value) => value.name), first.name),
    type, unit, options, description, format, example,
  };
}

function toCandidate(group: PropertyGroup, runCount: number, thresholds: AttributeConsensusDocument["thresholds"]): AttributeCandidate {
  const property = representative(group);
  const observationCount = group.values.length;
  const coverage = observationCount / Math.max(1, runCount);
  const requiredRate = group.requiredRuns.size / Math.max(1, runCount);
  const sharedRate = group.sharedRuns.size / Math.max(1, runCount);
  const decision: AttributeDecisionStatus = observationCount >= thresholds.minConfirmedRuns && coverage >= thresholds.confirmedCoverage
    ? "confirmed"
    : coverage >= thresholds.candidateCoverage
      ? "candidate"
      : "review";
  const reasons = [
    `覆盖${observationCount}/${runCount}批`,
    `必填意见${group.requiredRuns.size}/${runCount}批`,
    `公共属性意见${group.sharedRuns.size}/${runCount}批`,
  ];
  if (decision !== "confirmed") reasons.push("多批次共识不足，暂不作为稳定属性");
  return {
    ...property,
    required: decision === "confirmed" && requiredRate >= 0.75,
    scope: sharedRate >= 0.5 ? "shared" : "category",
    decision, runCount, observationCount,
    coverage: Number(coverage.toFixed(3)),
    requiredRate: Number(requiredRate.toFixed(3)),
    sharedRate: Number(sharedRate.toFixed(3)),
    sourceRuns: [...new Set(group.values.flatMap(() => [...group.runIds]))].sort(),
    reasons,
  };
}

export function buildAttributeConsensus(
  observations: GovernanceObservation[],
  options: Partial<AttributeConsensusDocument["thresholds"]> = {},
): AttributeConsensusDocument {
  const thresholds = {
    confirmedCoverage: options.confirmedCoverage ?? 0.6,
    candidateCoverage: options.candidateCoverage ?? 0.3,
    minConfirmedRuns: options.minConfirmedRuns ?? 2,
  };
  const sourceRuns = [...new Set(observations.map((item) => item.runId))].sort();
  const byCategory = new Map<string, { category: GovernanceResult["category"]; runs: Set<string>; groups: Map<string, PropertyGroup>; notes: Set<string> }>();
  for (const observation of observations) {
    const current = byCategory.get(observation.result.category.id) ?? {
      category: observation.result.category, runs: new Set<string>(), groups: new Map<string, PropertyGroup>(), notes: new Set<string>(),
    };
    current.runs.add(observation.runId);
    observation.result.notes.forEach((note) => current.notes.add(note));
    // 一个运行中同一属性只计一次，避免重试或重复文件人为抬高覆盖率。
    const properties = [...observation.result.shared, ...observation.result.properties];
    const seen = new Set<string>();
    for (const property of properties) {
      const key = groupKey(property);
      if (seen.has(key)) continue;
      seen.add(key);
      const group = current.groups.get(key) ?? { values: [], runIds: new Set<string>(), requiredRuns: new Set<string>(), sharedRuns: new Set<string>() } satisfies PropertyGroup;
      group.values.push(property);
      group.runIds.add(observation.runId);
      if (property.required) group.requiredRuns.add(observation.runId);
      if (observation.result.shared.some((item) => groupKey(item) === key)) group.sharedRuns.add(observation.runId);
      current.groups.set(key, group);
    }
    byCategory.set(observation.result.category.id, current);
  }
  const categories = [...byCategory.values()].sort((a, b) => a.category.path.join("/").localeCompare(b.category.path.join("/"))).map((item): CategoryConsensus => {
    const all = [...item.groups.values()].map((group) => toCandidate(group, item.runs.size, thresholds));
    return {
      category: item.category,
      runCount: item.runs.size,
      shared: all.filter((property) => property.scope === "shared").sort((a, b) => b.coverage - a.coverage || a.name.localeCompare(b.name)),
      properties: all.filter((property) => property.scope !== "shared").sort((a, b) => b.coverage - a.coverage || a.name.localeCompare(b.name)),
      notes: [...item.notes].slice(0, 10),
    };
  });
  const allProperties = categories.flatMap((category) => [...category.shared, ...category.properties]);
  return {
    version: "attribute-consensus-v1",
    generatedAt: new Date().toISOString(),
    sourceRuns,
    thresholds,
    stats: {
      categoryCount: categories.length,
      candidateCount: allProperties.length,
      confirmedCount: allProperties.filter((property) => property.decision === "confirmed").length,
      candidateStatusCount: allProperties.filter((property) => property.decision === "candidate").length,
      reviewCount: allProperties.filter((property) => property.decision === "review").length,
    },
    categories,
  };
}

export function buildConfirmedTemplateDocument(consensus: AttributeConsensusDocument): ConfirmedTemplateDocument {
  return {
    version: "attribute-template-v1",
    generatedAt: new Date().toISOString(),
    sourceRuns: consensus.sourceRuns,
    categories: consensus.categories.map((category) => ({
      category: category.category,
      shared: category.shared.filter((property) => property.decision === "confirmed").map(({ decision: _decision, runCount: _runCount, observationCount: _observationCount, coverage: _coverage, requiredRate: _requiredRate, sharedRate: _sharedRate, sourceRuns: _sourceRuns, reasons: _reasons, ...property }) => property),
      properties: category.properties.filter((property) => property.decision === "confirmed").map(({ decision: _decision, runCount: _runCount, observationCount: _observationCount, coverage: _coverage, requiredRate: _requiredRate, sharedRate: _sharedRate, sourceRuns: _sourceRuns, reasons: _reasons, ...property }) => property),
      notes: category.notes,
    })),
  };
}
