import type { AttributeProperty, GovernanceResult } from "./types.ts";
import { createHash } from "node:crypto";
import { propertyToTuple } from "./template-codec.ts";

export type AttributeDecisionStatus = "confirmed" | "candidate" | "review";

export interface GovernanceObservation {
  runId: string;
  /** 补跑沿用原全量运行的轮次，避免同一轮重复计票。 */
  roundId?: string;
  result: GovernanceResult;
}

export interface AttributeVariant {
  id: string;
  property: AttributeProperty;
  sourceRuns: string[];
  roundIds: string[];
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
  variants?: AttributeVariant[];
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
  variants: Map<string, { property: AttributeProperty; sourceRuns: Set<string>; roundIds: Set<string> }>;
  runIds: Set<string>;
  sourceRuns: Set<string>;
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

export function propertyVariantId(property: AttributeProperty): string {
  return `v${createHash("sha256").update(JSON.stringify(propertyToTuple(property))).digest("hex").slice(0, 16)}`;
}

function representative(group: PropertyGroup): AttributeProperty {
  // 仅选一份完整定义作为显示值，不能将多个版本的 type/unit/options 拼成不存在的定义。
  return [...group.variants.entries()].sort((a, b) => b[1].roundIds.size - a[1].roundIds.size || a[0].localeCompare(b[0]))[0]![1].property;
}

function toCandidate(group: PropertyGroup, runCount: number, thresholds: AttributeConsensusDocument["thresholds"]): AttributeCandidate {
  const property = representative(group);
  const observationCount = group.runIds.size;
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
    sourceRuns: [...group.sourceRuns].sort(),
    reasons,
    variants: [...group.variants.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, value]) => ({
      id, property: value.property, sourceRuns: [...value.sourceRuns].sort(), roundIds: [...value.roundIds].sort(),
    })),
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
    const roundId = observation.roundId ?? observation.runId;
    current.runs.add(roundId);
    observation.result.notes.forEach((note) => current.notes.add(note));
    // 一个运行中同一属性只计一次，避免重试或重复文件人为抬高覆盖率。
    const properties = [...observation.result.shared, ...observation.result.properties];
    for (const property of properties) {
      const key = groupKey(property);
      const group = current.groups.get(key) ?? { variants: new Map(), runIds: new Set<string>(), sourceRuns: new Set<string>(), requiredRuns: new Set<string>(), sharedRuns: new Set<string>() } satisfies PropertyGroup;
      const id = propertyVariantId(property);
      const variant = group.variants.get(id) ?? { property, sourceRuns: new Set<string>(), roundIds: new Set<string>() };
      variant.sourceRuns.add(observation.runId);
      variant.roundIds.add(roundId);
      group.variants.set(id, variant);
      group.runIds.add(roundId);
      group.sourceRuns.add(observation.runId);
      if (property.required) group.requiredRuns.add(roundId);
      if (observation.result.shared.includes(property)) group.sharedRuns.add(roundId);
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
      shared: category.shared.filter((property) => property.decision === "confirmed" && (property.variants?.length ?? 1) === 1).map(({ decision: _decision, runCount: _runCount, observationCount: _observationCount, coverage: _coverage, requiredRate: _requiredRate, sharedRate: _sharedRate, sourceRuns: _sourceRuns, reasons: _reasons, variants: _variants, ...property }) => property),
      properties: category.properties.filter((property) => property.decision === "confirmed" && (property.variants?.length ?? 1) === 1).map(({ decision: _decision, runCount: _runCount, observationCount: _observationCount, coverage: _coverage, requiredRate: _requiredRate, sharedRate: _sharedRate, sourceRuns: _sourceRuns, reasons: _reasons, variants: _variants, ...property }) => property),
      notes: category.notes,
    })),
  };
}
