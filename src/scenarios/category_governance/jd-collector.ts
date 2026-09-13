import type { CategoryNode } from "./types.ts";
import { shortCategoryId } from "./util.ts";
import type { JdAttributeEvidence, JdCategoryEvidence, JdEvidenceDocument } from "./jd-evidence.ts";

interface JdSearchItem {
  skuId?: string | number;
  skuName?: string;
  categoryId1?: string | number;
  categoryId2?: string | number;
  categoryId3?: string | number;
  categoryName1?: string;
  categoryName2?: string;
  categoryName3?: string;
}

interface JdSearchResult {
  skuHitResultPaging?: { items?: JdSearchItem[] };
}

interface JdDetailResult {
  skuId?: string | number;
  categoryAttrList?: unknown[];
  paramGroupAttrList?: unknown[];
}

export interface JdGoodsApi {
  searchSku(request: Record<string, unknown>): Promise<JdSearchResult>;
  getSkuDetailInfo(request: Record<string, unknown>): Promise<JdDetailResult | JdDetailResult[]>;
}

export interface JdCollectorOptions {
  targetCategories: CategoryNode[];
  goodsApi: JdGoodsApi;
  skusPerCategory: number;
  searchPageSize: number;
  concurrency: number;
  attempts: number;
  onProgress?: (progress: { completed: number; total: number; matched: number; failed: number }) => void;
}

export interface JdCollectorStats {
  targetCount: number;
  matchedTargetCount: number;
  unmatchedTargetCount: number;
  sampledSkuCount: number;
  detailSuccessCount: number;
  detailErrorCount: number;
}

export interface JdCollectorResult {
  document: JdEvidenceDocument;
  stats: JdCollectorStats;
  unmatchedTargetIds: string[];
  errors: Array<{ categoryId: string; error: string }>;
}

interface Candidate {
  item: JdSearchItem;
  score: number;
  path: string[];
}

interface AttributeAccumulator {
  name: string;
  values: Map<string, number>;
  groups: Set<string>;
  sources: Set<string>;
  skuIds: Set<string>;
}

interface CategoryAccumulator {
  id?: string;
  path: string[];
  targetIds: Set<string>;
  sampleSkuIds: Set<string>;
  confidence: number;
  attributes: Map<string, AttributeAccumulator>;
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return "";
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\s\-_/·（）()]+/gu, "");
}

function uniqueText(values: unknown[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value && typeof value === "object") {
      for (const item of Object.values(value as Record<string, unknown>)) visit(item);
      return;
    }
    const valueText = text(value);
    if (!valueText || seen.has(valueText)) return;
    seen.add(valueText);
    output.push(valueText.slice(0, 120));
  };
  for (const value of values) visit(value);
  return output;
}

function categoryPath(item: JdSearchItem): string[] {
  return [item.categoryName1, item.categoryName2, item.categoryName3].map(text).filter(Boolean);
}

function candidateScore(target: CategoryNode, item: JdSearchItem): number {
  const targetName = normalize(target.name);
  if (!targetName) return 0;
  const title = normalize(text(item.skuName));
  const path = categoryPath(item).map(normalize);
  let value = 0;
  if (title.includes(targetName)) value += 0.7;
  else if (targetName.length >= 2 && [...targetName].filter((char) => title.includes(char)).length / targetName.length >= 0.7) value += 0.45;
  if (path.some((part) => part === targetName)) value += 0.3;
  else if (path.some((part) => part.includes(targetName) || targetName.includes(part))) value += 0.2;
  const pathOverlap = target.pathNames
    .map(normalize)
    .filter((part) => part && path.includes(part)).length;
  value += Math.min(pathOverlap * 0.05, 0.1);
  return Math.min(value, 1);
}

function attrName(record: Record<string, unknown>, prefix: "cate" | "param"): string {
  return text(record[`${prefix}AttrName`] ?? record.attrName ?? record.attName ?? record.name ?? record.label ?? record.key);
}

function attrValues(record: Record<string, unknown>, prefix: "cate" | "param"): string[] {
  return uniqueText([
    record[`${prefix}AttrValList`], record[`${prefix}AttrValue`], record.attrValue,
    record.attValue, record.value, record.values, record.text,
  ]);
}

function addAttribute(
  accumulator: CategoryAccumulator,
  name: string,
  values: string[],
  group: string,
  source: string,
  skuId: string,
): void {
  if (!name) return;
  const key = normalize(name);
  const current = accumulator.attributes.get(key) ?? {
    name, values: new Map<string, number>(), groups: new Set<string>(), sources: new Set<string>(), skuIds: new Set<string>(),
  } satisfies AttributeAccumulator;
  current.skuIds.add(skuId);
  if (group) current.groups.add(group);
  current.sources.add(source);
  for (const value of values) current.values.set(value, (current.values.get(value) ?? 0) + 1);
  accumulator.attributes.set(key, current);
}

function extractCategoryAttributes(accumulator: CategoryAccumulator, detail: JdDetailResult, skuId: string): void {
  if (!Array.isArray(detail.categoryAttrList)) return;
  for (const item of detail.categoryAttrList) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    addAttribute(accumulator, attrName(record, "cate"), attrValues(record, "cate"), "", "category", skuId);
  }
}

function extractParamAttributes(accumulator: CategoryAccumulator, detail: JdDetailResult, skuId: string): void {
  if (!Array.isArray(detail.paramGroupAttrList)) return;
  for (const groupValue of detail.paramGroupAttrList) {
    if (!groupValue || typeof groupValue !== "object" || Array.isArray(groupValue)) continue;
    const group = groupValue as Record<string, unknown>;
    const groupName = text(group.paramGroupName ?? group.groupName ?? group.name);
    const list = ["paramAttributeList", "paramAttrList", "attrList", "attrs", "list", "children"]
      .map((key) => group[key]).find(Array.isArray);
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const record = item as Record<string, unknown>;
      addAttribute(accumulator, attrName(record, "param"), attrValues(record, "param"), groupName, "param", skuId);
    }
  }
}

function inferType(name: string, values: string[]): string | null {
  if (/日期|时间/u.test(name) || values.some((value) => /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/u.test(value))) return "date";
  if (values.length > 0 && values.every((value) => /^(是|否|支持|不支持|有|无)$/u.test(value))) return "boolean";
  return null;
}

function toEvidenceAttributes(accumulator: CategoryAccumulator): JdAttributeEvidence[] {
  return [...accumulator.attributes.values()]
    .sort((a, b) => b.skuIds.size - a.skuIds.size || a.name.localeCompare(b.name))
    .map((attribute) => {
      const values = [...attribute.values.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 30)
        .map(([value]) => value);
      return {
        name: attribute.name,
        type: inferType(attribute.name, values),
        values,
        observed: attribute.skuIds.size,
        groups: [...attribute.groups].slice(0, 6),
        sources: [...attribute.sources].slice(0, 4),
      };
    });
}

async function withRetry<T>(operation: () => Promise<T>, attempts: number): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= Math.max(1, attempts); attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await Bun.sleep(Math.min(1500, 250 * 2 ** (attempt - 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function mapLimit<T>(items: T[], limit: number, mapper: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = cursor++;
      const item = items[index];
      if (item === undefined) return;
      await mapper(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), Math.max(1, items.length)) }, () => worker()));
}

function asDetail(value: JdDetailResult | JdDetailResult[]): JdDetailResult | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export async function collectJdEvidence(options: JdCollectorOptions): Promise<JdCollectorResult> {
  const categoryAccumulators = new Map<string, CategoryAccumulator>();
  const errors: Array<{ categoryId: string; error: string }> = [];
  const matchedTargetIds = new Set<string>();
  const sampledSkuIds = new Set<string>();
  let detailSuccessCount = 0;
  let detailErrorCount = 0;
  let completed = 0;

  await mapLimit(options.targetCategories, options.concurrency, async (target) => {
    try {
      const search = await withRetry(() => options.goodsApi.searchSku({
        keyword: target.name,
        needMergeSku: 0,
        extAttrCollect: 1,
        priceCollect: 0,
        useCacheStore: 1,
        sortType: 1,
        pageIndex: 1,
        pageSize: options.searchPageSize,
      }), options.attempts);
      const candidates: Candidate[] = (search.skuHitResultPaging?.items ?? [])
        .filter((item): item is JdSearchItem => Boolean(item?.skuId))
        .map((item) => ({ item, score: candidateScore(target, item), path: categoryPath(item) }))
        .filter((candidate) => candidate.score >= 0.65)
        .sort((a, b) => b.score - a.score || String(a.item.skuId).localeCompare(String(b.item.skuId)));
      const selected = [...new Map(candidates.map((candidate) => [String(candidate.item.skuId), candidate])).values()]
        .slice(0, options.skusPerCategory);
      if (selected.length === 0) {
        completed += 1;
        options.onProgress?.({ completed, total: options.targetCategories.length, matched: matchedTargetIds.size, failed: errors.length });
        return;
      }
      matchedTargetIds.add(target.id);
      const targetIdList = [target.id, shortCategoryId(target.id)];
      for (const candidate of selected) {
        const skuId = String(candidate.item.skuId);
        sampledSkuIds.add(skuId);
        const jdCategoryId = text(candidate.item.categoryId3) || undefined;
        const key = `${target.id}|${jdCategoryId ?? candidate.path.join(">")}`;
        const accumulator = categoryAccumulators.get(key) ?? {
          id: jdCategoryId,
          path: candidate.path.length > 0 ? candidate.path : [target.name],
          targetIds: new Set<string>(),
          sampleSkuIds: new Set<string>(),
          confidence: 0,
          attributes: new Map<string, AttributeAccumulator>(),
        } satisfies CategoryAccumulator;
        targetIdList.forEach((id) => accumulator.targetIds.add(id));
        accumulator.sampleSkuIds.add(skuId);
        accumulator.confidence = Math.max(accumulator.confidence, candidate.score);
        categoryAccumulators.set(key, accumulator);
        try {
          const raw = await withRetry(() => options.goodsApi.getSkuDetailInfo({
            skuId,
            queryExtSet: [1, 2, 3, 5, 6, 9, 10, 11],
          }), options.attempts);
          const detail = asDetail(raw);
          if (!detail) throw new Error("详情接口返回空数据");
          extractCategoryAttributes(accumulator, detail, skuId);
          extractParamAttributes(accumulator, detail, skuId);
          detailSuccessCount += 1;
        } catch (error) {
          detailErrorCount += 1;
          errors.push({ categoryId: target.id, error: `SKU ${skuId}：${error instanceof Error ? error.message : String(error)}` });
        }
      }
    } catch (error) {
      errors.push({ categoryId: target.id, error: error instanceof Error ? error.message : String(error) });
    } finally {
      completed += 1;
      options.onProgress?.({ completed, total: options.targetCategories.length, matched: matchedTargetIds.size, failed: errors.length });
    }
  });

  const categories: JdCategoryEvidence[] = [...categoryAccumulators.values()]
    .filter((item) => item.attributes.size > 0)
    .map((item) => ({
      id: item.id,
      path: item.path,
      targetIds: [...item.targetIds],
      sampleSkuIds: [...item.sampleSkuIds].slice(0, 50),
      confidence: Number(item.confidence.toFixed(3)),
      attributes: toEvidenceAttributes(item),
    }));
  const unmatchedTargetIds = options.targetCategories
    .map((target) => target.id)
    .filter((id) => !matchedTargetIds.has(id));
  return {
    document: {
      version: "jd-vop-v1",
      source: "jd-vop-sampled",
      generatedAt: new Date().toISOString(),
      sampling: {
        targetCount: options.targetCategories.length,
        skusPerCategory: options.skusPerCategory,
        searchPageSize: options.searchPageSize,
        detailQueryExtSet: [1, 2, 3, 5, 6, 9, 10, 11],
      },
      categories,
    },
    stats: {
      targetCount: options.targetCategories.length,
      matchedTargetCount: matchedTargetIds.size,
      unmatchedTargetCount: unmatchedTargetIds.length,
      sampledSkuCount: sampledSkuIds.size,
      detailSuccessCount,
      detailErrorCount,
    },
    unmatchedTargetIds,
    errors,
  };
}

export function mergeJdEvidenceDocuments(
  existing: JdEvidenceDocument | undefined,
  incoming: JdEvidenceDocument,
): JdEvidenceDocument {
  const mergeCategory = (left: JdCategoryEvidence, right: JdCategoryEvidence): JdCategoryEvidence => {
    const attributes = new Map<string, JdAttributeEvidence>();
    for (const attribute of left.attributes) attributes.set(normalize(attribute.name), attribute);
    for (const attribute of right.attributes) {
      const key = normalize(attribute.name);
      const previous = attributes.get(key);
      if (!previous) {
        attributes.set(key, attribute);
        continue;
      }
      attributes.set(key, {
        ...previous,
        type: previous.type ?? attribute.type,
        values: [...new Set([...(previous.values ?? []), ...(attribute.values ?? [])])].slice(0, 30),
        groups: [...new Set([...(previous.groups ?? []), ...(attribute.groups ?? [])])].slice(0, 6),
        sources: [...new Set([...(previous.sources ?? []), ...(attribute.sources ?? [])])].slice(0, 4),
        observed: Math.max(previous.observed ?? 0, attribute.observed ?? 0) || undefined,
      });
    }
    return {
      ...left,
      ...right,
      targetIds: [...new Set([...(left.targetIds ?? []), ...(right.targetIds ?? [])])],
      sampleSkuIds: [...new Set([...(left.sampleSkuIds ?? []), ...(right.sampleSkuIds ?? [])])].slice(0, 50),
      confidence: Math.max(left.confidence ?? 0, right.confidence ?? 0) || undefined,
      attributes: [...attributes.values()],
    };
  };
  const categories = new Map<string, JdCategoryEvidence>();
  for (const category of existing?.categories ?? []) {
    const key = `${category.targetIds?.join(",") ?? ""}|${category.id ?? category.path.join(">")}`;
    categories.set(key, category);
  }
  for (const category of incoming.categories) {
    const key = `${category.targetIds?.join(",") ?? ""}|${category.id ?? category.path.join(">")}`;
    const previous = categories.get(key);
    categories.set(key, previous ? mergeCategory(previous, category) : category);
  }
  return {
    version: incoming.version ?? existing?.version,
    source: incoming.source ?? existing?.source,
    generatedAt: incoming.generatedAt,
    sampling: incoming.sampling,
    categories: [...categories.values()],
  };
}
