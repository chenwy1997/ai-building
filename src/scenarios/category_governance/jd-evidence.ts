import { join } from "node:path";
import { readJsonFile } from "../../facilities/json/files.ts";
import type { CategoryNode } from "./types.ts";
import { shortCategoryId } from "./util.ts";

export interface JdAttributeEvidence {
  name: string;
  type?: string | null;
  unit?: string | null;
  values?: string[];
  observed?: number;
  groups?: string[];
  sources?: string[];
}

export interface JdCategoryEvidence {
  id?: string;
  path: string[];
  attributes: JdAttributeEvidence[];
  targetIds?: string[];
  sampleSkuIds?: string[];
  confidence?: number;
}

export interface JdEvidenceDocument {
  version?: string;
  source?: string;
  generatedAt?: string;
  sampling?: Record<string, unknown>;
  categories: JdCategoryEvidence[];
}

export interface JdEvidenceOptions {
  maxCategoriesPerTarget?: number;
  maxAttributesPerCategory?: number;
  minObserved?: number;
}

const PLACEHOLDER_VALUES = new Set(["无", "未公布", "暂无", "不详", "未知"]);
const PLATFORM_ATTRIBUTE_NAMES = [/^国补备案型号$/u, /国补备案/u, /^上市时间$/u, /^上市日期$/u];

function cleanValues(values: string[] | undefined): string[] {
  return [...new Set(values ?? [])].slice(0, 20);
}

function isPlatformAttribute(name: string): boolean {
  return PLATFORM_ATTRIBUTE_NAMES.some((pattern) => pattern.test(name.trim()));
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\s\-_/·（）()]+/gu, "");
}

function score(target: CategoryNode, candidate: JdCategoryEvidence): number {
  if (candidate.targetIds?.includes(target.id) || candidate.targetIds?.includes(shortCategoryId(target.id))) return 1.2;
  const targetLeaf = normalize(target.name);
  const candidateLeaf = normalize(candidate.path.at(-1) ?? "");
  if (!targetLeaf || !candidateLeaf) return 0;
  if (targetLeaf === candidateLeaf) return 1;
  const targetPath = target.pathNames.map(normalize);
  const candidatePath = candidate.path.map(normalize);
  const leafContains = targetLeaf.includes(candidateLeaf) || candidateLeaf.includes(targetLeaf);
  const shared = targetPath.filter((part) => candidatePath.includes(part)).length;
  const pathScore = shared / Math.max(targetPath.length, candidatePath.length, 1);
  return leafContains ? 0.68 + Math.min(pathScore, 0.25) : pathScore >= 0.5 ? 0.45 + pathScore / 4 : 0;
}

function cleanAttribute(value: unknown): JdAttributeEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const name = text(item.name ?? item.attributeName ?? item.attrName);
  if (!name) return null;
  const rawValues = Array.isArray(item.values) ? item.values : Array.isArray(item.options) ? item.options : [];
  const values = [...new Set(rawValues.map(text).filter(Boolean))].slice(0, 20);
  const observed = typeof item.observed === "number" && Number.isFinite(item.observed) ? item.observed : undefined;
  const groups = Array.isArray(item.groups) ? item.groups.map(text).filter(Boolean).slice(0, 4) : undefined;
  const sources = Array.isArray(item.sources) ? item.sources.map(text).filter(Boolean).slice(0, 4) : undefined;
  return {
    name,
    type: text(item.type ?? item.valueType) || null,
    unit: text(item.unit) || null,
    values,
    observed,
    groups,
    sources,
  };
}

function cleanCategory(value: unknown): JdCategoryEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const rawPath = item.path ?? item.pathNames ?? item.categoryPath;
  const path = Array.isArray(rawPath) ? rawPath.map(text).filter(Boolean) : [];
  if (path.length === 0 && text(item.name)) path.push(text(item.name));
  if (path.length === 0) return null;
  const rawAttributes = item.attributes ?? item.attrs ?? item.attributeList;
  const attributes = Array.isArray(rawAttributes)
    ? rawAttributes.map(cleanAttribute).filter((item): item is JdAttributeEvidence => Boolean(item))
    : [];
  if (attributes.length === 0) return null;
  const targetIds = Array.isArray(item.targetIds) ? item.targetIds.map(text).filter(Boolean) : undefined;
  const sampleSkuIds = Array.isArray(item.sampleSkuIds) ? item.sampleSkuIds.map(text).filter(Boolean).slice(0, 50) : undefined;
  const confidence = typeof item.confidence === "number" && Number.isFinite(item.confidence) ? item.confidence : undefined;
  return { id: text(item.id) || undefined, path, attributes, targetIds, sampleSkuIds, confidence };
}

export function normalizeJdEvidence(raw: unknown): JdEvidenceDocument {
  const root = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const values = Array.isArray(raw) ? raw : root.categories ?? root.items ?? root.data;
  const categories = Array.isArray(values)
    ? values.map(cleanCategory).filter((item): item is JdCategoryEvidence => Boolean(item))
    : [];
  return {
    version: text(root.version) || undefined,
    source: text(root.source) || undefined,
    generatedAt: text(root.generatedAt) || undefined,
    sampling: root.sampling && typeof root.sampling === "object" && !Array.isArray(root.sampling)
      ? root.sampling as Record<string, unknown>
      : undefined,
    categories,
  };
}

export async function loadJdEvidence(path: string): Promise<JdEvidenceDocument> {
  return normalizeJdEvidence(await readJsonFile<unknown>(path));
}

export async function findJdEvidencePath(rootDir: string, version: string, explicit?: string): Promise<string | null> {
  const candidates = explicit
    ? [explicit]
    : [
      join(rootDir, "context", version, "jd-attribute-evidence.json"),
      join(rootDir, "reference", `jd-attribute-evidence-${version}.json`),
    ];
  for (const candidate of candidates) {
    try {
      await Bun.file(candidate).json();
      return candidate;
    } catch {
      // Optional evidence; absence must not block a governance run.
    }
  }
  return null;
}

export function buildJdEvidenceText(
  targets: CategoryNode[],
  document: JdEvidenceDocument | undefined,
  options: JdEvidenceOptions = {},
): string {
  if (!document?.categories.length) return "";
  const maxCategories = options.maxCategoriesPerTarget ?? 2;
  const maxAttributes = options.maxAttributesPerCategory ?? 16;
  const lines: string[] = [];
  for (const target of targets) {
    const scored = document.categories
      .map((candidate) => ({ candidate, score: score(target, candidate) }))
      .filter((item) => item.score >= 0.45);
    // 有明确 targetIds 时只信任直接绑定的证据，避免同名或相邻路径的京东类目串入当前目标。
    // 只有历史证据没有 targetIds 时，才使用精确叶子名或较高置信度的路径兜底。
    const direct = scored.filter((item) => item.score >= 1.19);
    const unbound = scored.filter((item) => !item.candidate.targetIds?.length);
    const exact = unbound.filter((item) => item.score >= 1 && item.score < 1.19);
    const fallback = unbound.filter((item) => item.score >= 0.68 && item.score < 1);
    const matches = (direct.length > 0 ? direct : exact.length > 0 ? exact : fallback)
      .sort((a, b) => b.score - a.score || a.candidate.path.join("/").localeCompare(b.candidate.path.join("/")))
      .slice(0, maxCategories);
    for (const match of matches) {
      const sampleCount = match.candidate.sampleSkuIds?.length;
      lines.push(`#JD-EVIDENCE|target=${shortCategoryId(target.id)}|match=${match.candidate.path.join(">")}|confidence=${match.score.toFixed(2)}${sampleCount ? `|sample=${sampleCount}` : ""}`);
      const inferredSampleCount = (sampleCount ?? Math.max(...match.candidate.attributes.map((attribute) => attribute.observed ?? 0), 0)) || undefined;
      const minObserved = options.minObserved;
      const attributes = match.candidate.attributes
        .filter((attribute) => minObserved === undefined || attribute.observed === undefined || attribute.observed >= minObserved)
        .map((attribute) => ({ attribute, values: cleanValues(attribute.values) }))
        .slice(0, maxAttributes);
      for (const { attribute, values } of attributes) {
        const parts = [`attr=${attribute.name}`];
        if (attribute.type) parts.push(`type=${attribute.type}`);
        if (attribute.unit) parts.push(`unit=${attribute.unit}`);
        if (values.length) parts.push(`values=${values.join(",")}`);
        if (attribute.observed !== undefined) {
          parts.push(`seen=${attribute.observed}${inferredSampleCount ? `/${inferredSampleCount}` : ""}`);
          if (attribute.observed <= 1) parts.push("weak=1");
        }
        if (isPlatformAttribute(attribute.name)) parts.push("hint=platform_field");
        if (values.length > 0 && values.every((value) => PLACEHOLDER_VALUES.has(value.trim()))) parts.push("hint=placeholder_values");
        if (attribute.groups?.length) parts.push(`groups=${attribute.groups.join(",")}`);
        if (attribute.sources?.length) parts.push(`source=${attribute.sources.join(",")}`);
        lines.push(parts.join("|"));
      }
    }
  }
  return lines.join("\n");
}
