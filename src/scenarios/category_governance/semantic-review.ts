import type { AttributeProperty } from "./types.ts";
import type { AttributeCandidate, AttributeConsensusDocument, CategoryConsensus } from "./consensus.ts";
import type { OpenAiUsage } from "../../ai/types.ts";

export type SemanticAction = "keep" | "drop" | "review" | "add";

export interface SemanticReviewDecision {
  key: string;
  action: SemanticAction;
  reason: string;
  property?: AttributeProperty;
}

export interface SemanticReviewResult {
  categoryId: string;
  decisions: SemanticReviewDecision[];
  notes: string[];
  /** 候选库之外的否定/待核实判断，只留审计记录，不进入属性模板。 */
  evidenceDecisions?: Array<{ key: string; action: "drop" | "review"; reason: string }>;
  provenance?: { requestPath: string; responsePath: string };
}

export interface SemanticReviewUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptCacheHitTokens: number;
  promptCacheMissTokens: number;
  reasoningTokens?: number;
}

export type SemanticReviewError = { categoryId: string; error: string };

export interface SemanticReviewDocument {
  version: "semantic-review-v1";
  generatedAt: string;
  sourceConsensus: string;
  reviews: SemanticReviewResult[];
  usage?: SemanticReviewUsage;
  errors?: SemanticReviewError[];
}

export function emptySemanticReviewUsage(): SemanticReviewUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, promptCacheHitTokens: 0, promptCacheMissTokens: 0, reasoningTokens: 0 };
}

/** 在校验响应之前计入用量：解析失败和重试的已返回响应同样消耗 token。 */
export function addSemanticReviewUsage(total: SemanticReviewUsage, usage?: OpenAiUsage): void {
  total.promptTokens += usage?.prompt_tokens ?? 0;
  total.completionTokens += usage?.completion_tokens ?? 0;
  total.totalTokens += usage?.total_tokens ?? ((usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0));
  total.promptCacheHitTokens += usage?.prompt_cache_hit_tokens ?? 0;
  total.promptCacheMissTokens += usage?.prompt_cache_miss_tokens ?? 0;
  total.reasoningTokens = (total.reasoningTokens ?? 0) + (usage?.completion_tokens_details?.reasoning_tokens ?? 0);
}

export function mergeSemanticReviewErrors(
  existing: SemanticReviewError[], incoming: SemanticReviewError[], successful: SemanticReviewResult[],
): SemanticReviewError[] {
  const byCategory = new Map(existing.map((item) => [item.categoryId, item]));
  for (const item of successful) byCategory.delete(item.categoryId);
  for (const item of incoming) byCategory.set(item.categoryId, item);
  return [...byCategory.values()].sort((left, right) => left.categoryId.localeCompare(right.categoryId));
}

/**
 * 将本批次终审结果增量合并到稳定结果。相同类目使用最新一次成功结果，
 * 未参与本批次的类目继续保留，适合按小批次反复治理。
 */
export function mergeSemanticReviews(
  existing: SemanticReviewResult[],
  incoming: SemanticReviewResult[],
): SemanticReviewResult[] {
  const byCategory = new Map(existing.map((review) => [review.categoryId, review]));
  for (const review of incoming) byCategory.set(review.categoryId, review);
  return [...byCategory.values()].sort((left, right) => left.categoryId.localeCompare(right.categoryId));
}

export interface SemanticTemplateDocument {
  version: "attribute-template-semantic-v1";
  generatedAt: string;
  sourceConsensus: string[];
  categories: Array<{
    category: CategoryConsensus["category"];
    shared: AttributeProperty[];
    properties: AttributeProperty[];
    notes: string[];
  }>;
}

function comparableCandidate(candidate: AttributeCandidate): Record<string, unknown> {
  // 排除 runCount/coverage/sourceRuns 等运行统计；只有实际属性定义或候选状态变化才触发增量复审。
  return {
    key: candidate.key, name: candidate.name, type: candidate.type, required: candidate.required,
    unit: candidate.unit, options: candidate.options ?? [], description: candidate.description ?? "",
    format: candidate.format ?? null, example: candidate.example ?? null, scope: candidate.scope,
    decision: candidate.decision,
  };
}

export function semanticCategoryFingerprint(category: CategoryConsensus): string {
  const sort = (items: AttributeCandidate[]) => items.map(comparableCandidate).sort((left, right) => `${left.key}`.localeCompare(`${right.key}`));
  return JSON.stringify({ category: category.category, shared: sort(category.shared), properties: sort(category.properties) });
}

export function semanticCategoryChanged(current: CategoryConsensus, baseline: CategoryConsensus | undefined): boolean {
  return !baseline || semanticCategoryFingerprint(current) !== semanticCategoryFingerprint(baseline);
}

export const SEMANTIC_REVIEW_SYSTEM_PROMPT = `你是类目属性治理的最终语义审阅专家。输入是多个批次模型生成的属性候选、候选出现频次和京东商品证据摘要。你要结合三横类目完整路径、行业常识和证据语义，决定哪些属性进入模板。

原则：
0. 第一版只治理属性。类目名称、类目 ID、类目层级和类目树是只读输入，禁止新增、删除、合并、改名或调整类目。
1. 统计频次只是参考，不是决定条件。可以保留低频但对当前类目有明确识别、采购或合规价值的属性，也可以删除高频但属于平台运营、促销或偶然字段的属性。
2. 识别父类公共属性与末级类目属性，消除同义重复，统一 key、类型、单位和枚举。必要时可新增候选属性，但不能编造固定枚举。
3. required 只有在商品资料通常稳定具备且对识别、采购或合规确实关键时才设为 true；品牌、型号、颜色默认可选。
4. 对京东证据中的 weak=1、hint=platform_field、hint=placeholder_values 做语义判断，不要机械保留或机械删除。
5. 只输出严格 JSON，不要 Markdown。必须覆盖输入的每个候选 key；新增属性使用 action=add，删除使用 action=drop，无法确定使用 action=review。
6. 为节省输出 token，正常的 keep、drop、review 决策禁止输出 property 字段；只有 add 决策必须输出 property。若 keep 需要纠正候选已有的类型、单位或枚举，可附上完整且使用同一 key 的 property；不需要纠正时省略。review 不进入正式模板。每条 reason 尽量不超过 30 个汉字，notes 最多 3 条。
7. #CANDIDATES 是待决策清单；#EVIDENCE 只是参考，里面的字段不自动成为候选。不要逐项为未采用的证据输出 drop/review；必要说明写在 notes。采用候选以外的证据字段时必须使用 add 并给出完整 property，不能使用 keep。不得自行翻译或改写已有候选 key。

输出结构：
{"category_id":"...","decisions":[{"key":"...","action":"keep|drop|review|add","reason":"简短原因","property":{"key":"...","name":"...","type":"text|number|boolean|single|multi|date|file","required":false,"unit":null,"options":[],"description":"","format":null,"example":null,"scope":"shared|category"}}],"notes":[]}
keep/review/drop 必须使用输入候选 key；add 才使用新 key。property 仅在 add 必填，或 keep 纠正已有候选时提供；drop/review 通常省略。`;

function compactCandidate(candidate: AttributeCandidate): Record<string, unknown> {
  return {
    key: candidate.key, name: candidate.name, type: candidate.type, required: candidate.required,
    unit: candidate.unit, options: candidate.options ?? [], description: candidate.description ?? "", scope: candidate.scope,
    decision: candidate.decision, coverage: candidate.coverage, observedRuns: candidate.observationCount,
    requiredRate: candidate.requiredRate, sharedRate: candidate.sharedRate, reasons: candidate.reasons,
  };
}

export function buildSemanticReviewPrompt(input: {
  category: CategoryConsensus;
  evidenceText?: string;
}): string {
  const candidates = [...input.category.shared, ...input.category.properties].map(compactCandidate);
  // 固定协议、类目和证据放在前缀；候选统计可能随新批次变化，放在最后以尽量命中 KV 缓存。
  return `请审阅下面一个三横末级类目的属性候选。

#CATEGORY
${JSON.stringify(input.category.category)}
#EVIDENCE
${input.evidenceText?.trim() ?? "（暂无京东证据）"}
#CANDIDATES
${JSON.stringify({ runCount: input.category.runCount, candidates })}

返回一个 JSON 对象，category_id 必须使用输入类目的完整 ID；不要返回或修改任何类目字段。decisions 必须覆盖上面每个候选 key。你可以增加当前类目确有必要但候选缺失的属性。`;
}

function cleanProperty(value: unknown): AttributeProperty {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("语义审阅新增属性必须是对象");
  const item = value as Record<string, unknown>;
  const type = typeof item.type === "string" && ["text", "number", "boolean", "single", "multi", "date", "file"].includes(item.type)
    ? item.type as AttributeProperty["type"] : "text";
  return {
    key: typeof item.key === "string" && item.key ? item.key : "review_attribute",
    name: typeof item.name === "string" && item.name ? item.name : "未命名属性",
    type,
    required: item.required === true,
    unit: typeof item.unit === "string" ? item.unit : null,
    options: Array.isArray(item.options) ? item.options.filter((value): value is string => typeof value === "string") : [],
    description: typeof item.description === "string" ? item.description : "",
    format: typeof item.format === "string" ? item.format : null,
    example: typeof item.example === "string" ? item.example : null,
    scope: item.scope === "shared" ? "shared" : "category",
  };
}

export function parseSemanticReviewResponse(text: string, category: CategoryConsensus): SemanticReviewResult {
  const clean = text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  const data = JSON.parse(clean) as Record<string, unknown>;
  if (data.category_id !== category.category.id) throw new Error("语义审阅 category_id 不匹配");
  if (!Array.isArray(data.decisions)) throw new Error("语义审阅 decisions 必须是数组");
  const keys = new Set([...category.shared, ...category.properties].map((item) => item.key));
  const seen = new Set<string>();
  const decisions: SemanticReviewDecision[] = [];
  const evidenceDecisions: NonNullable<SemanticReviewResult["evidenceDecisions"]> = [];
  for (const value of data.decisions) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("语义审阅 decision 必须是对象");
    const item = value as Record<string, unknown>;
    const key = typeof item.key === "string" ? item.key : "";
    const action = item.action;
    if (!key || typeof action !== "string" || !["keep", "drop", "review", "add"].includes(action)) throw new Error("语义审阅 decision 字段无效");
    if (!keys.has(key) && (action === "drop" || action === "review")) {
      // 不存在的候选没有可删除的属性；保留模型原判断，但不为其臆造属性定义。
      evidenceDecisions.push({ key, action, reason: typeof item.reason === "string" ? item.reason : "" });
      continue;
    }
    if (action !== "add" && !keys.has(key)) throw new Error(`语义审阅包含未知候选：${key}；新增属性必须使用 add 并提供完整 property`);
    if (seen.has(key)) throw new Error(`语义审阅重复候选：${key}`);
    if (action === "add" && keys.has(key)) throw new Error(`语义审阅新增属性与候选 key 重复：${key}`);
    seen.add(key);
    const property = action === "add" || action === "keep" && item.property !== undefined ? cleanProperty(item.property) : undefined;
    if (property && property.key !== key) throw new Error(`语义审阅 property key 不一致：${key}/${property.key}`);
    decisions.push({ key, action: action as SemanticAction, reason: typeof item.reason === "string" ? item.reason : "", property });
  }
  for (const key of keys) if (!seen.has(key)) throw new Error(`语义审阅遗漏候选：${key}`);
  const notes = Array.isArray(data.notes) ? data.notes.filter((value): value is string => typeof value === "string").slice(0, 3).map((value) => value.slice(0, 120)) : [];
  return { categoryId: category.category.id, decisions, notes, ...(evidenceDecisions.length ? { evidenceDecisions } : {}) };
}

export function applySemanticReviews(
  consensus: AttributeConsensusDocument,
  reviews: SemanticReviewResult[],
): SemanticTemplateDocument {
  const reviewByCategory = new Map(reviews.map((review) => [review.categoryId, review]));
  return {
    version: "attribute-template-semantic-v1",
    generatedAt: new Date().toISOString(),
    sourceConsensus: consensus.sourceRuns,
    categories: consensus.categories.map((category) => {
      const review = reviewByCategory.get(category.category.id);
      const candidates = new Map([...category.shared, ...category.properties].map((candidate) => [candidate.key, candidate]));
      const selected: AttributeProperty[] = [];
      if (review) {
        for (const decision of review.decisions) {
          if (decision.action === "keep") {
            const candidate = candidates.get(decision.key);
            if (candidate) {
              const { decision: _decision, runCount: _runCount, observationCount: _observationCount, coverage: _coverage, requiredRate: _requiredRate, sharedRate: _sharedRate, sourceRuns: _sourceRuns, reasons: _reasons, ...candidateProperty } = candidate;
              const property = decision.property ?? candidateProperty;
              selected.push(property);
            }
          } else if (decision.action === "add" && decision.property) selected.push(decision.property);
        }
      } else {
        for (const candidate of [...category.shared, ...category.properties].filter((item) => item.decision === "confirmed")) {
          const { decision: _decision, runCount: _runCount, observationCount: _observationCount, coverage: _coverage, requiredRate: _requiredRate, sharedRate: _sharedRate, sourceRuns: _sourceRuns, reasons: _reasons, ...property } = candidate;
          selected.push(property);
        }
      }
      const sharedKeys = new Set([...category.shared.filter((item) => item.scope === "shared").map((item) => item.key), ...(review?.decisions.filter((item) => item.action === "add" && item.property?.scope === "shared").map((item) => item.key) ?? [])]);
      return {
        category: category.category,
        shared: selected.filter((property) => sharedKeys.has(property.key)),
        properties: selected.filter((property) => !sharedKeys.has(property.key)),
        notes: [...category.notes, ...(review?.notes ?? [])].slice(0, 10),
      };
    }),
  };
}
