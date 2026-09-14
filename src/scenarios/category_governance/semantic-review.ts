import type { AttributeProperty } from "./types.ts";
import type { AttributeCandidate, AttributeConsensusDocument, CategoryConsensus } from "./consensus.ts";
import type { OpenAiUsage } from "../../ai/types.ts";
import { createHash } from "node:crypto";
import { candidateProperty, candidateVariants, prepareReviewCategory } from "./review-preparation.ts";
import { propertyToTuple, validateAttributeProperties } from "./template-codec.ts";

export type SemanticAction = "keep" | "drop" | "review" | "add";

export interface SemanticReviewDecision {
  key: string;
  action: SemanticAction;
  reason: string;
  property?: AttributeProperty;
  variantId?: string;
}

export interface SemanticReviewResult {
  categoryId: string;
  decisions: SemanticReviewDecision[];
  notes: string[];
  /** 候选库之外的否定/待核实判断，只留审计记录，不进入属性模板。 */
  evidenceDecisions?: Array<{ key: string; action: "drop" | "review"; reason: string }>;
  provenance?: { requestPath: string; responsePath: string };
  inputFingerprint?: string;
  bulkDrop?: { keys: string[]; reason: string };
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
    variants: candidate.variants?.map((variant) => ({ id: variant.id, property: variant.property })).sort((a, b) => a.id.localeCompare(b.id)),
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
5. 只输出严格 JSON，不要 Markdown。每个候选组以唯一 key 标识，d 字典保存完整定义，g 中的定义引用及轮次只作证据。多个定义必须由你结合语义裁决；keep 时用 variant 指定 d 中的一份定义，或用完整 property 重新定义。不得默认取第一份。若同 key 确实混入不同含义，可 keep 其中一个并用 add 为其他必要属性赋予不同的新 key。
6. 为节省输出 token，正常的 keep、drop、review 决策禁止输出 property 字段；只有 add 决策必须输出 property。若 keep 需要纠正候选已有的类型、单位或枚举，可附上完整且使用同一 key 的 property；不需要纠正时省略。review 不进入正式模板。每条 reason 尽量不超过 30 个汉字，notes 最多 3 条。
7. #CANDIDATES 是待决策清单；#EVIDENCE 只是参考，里面的字段不自动成为候选。不要逐项为未采用的证据输出 drop/review；必要说明写在 notes。采用候选以外的证据字段时必须使用 add 并给出完整 property，不能使用 keep。不得自行翻译或改写已有候选 key。
8. 必须审视全部候选的业务适用性。允许稀疏输出：只列出 keep、review、add 或需单独说明的 drop，再明确返回 drop_remaining=true 和非空 drop_reason，表示你已判断所有未列出的候选均不适用；程序会展开成逐项审计。没有这个明确决定时仍必须逐项覆盖全部 key。不能仅因出现一次而删除有价值字段，也不能因候选很多而机械保留或截断。
9. 本任务制定模板计量规范，有量纲 number 必须选择统一 unit，未知的商品数值不影响单位选择；规格编码和数量要根据语义与物理测量区分。保留的属性不能同义重复，不能将“单位”拆成额外属性来代替 unit。

输入压缩约定：d 的定义顺序是 [key,name,type代码,required,unit,options,description,format,example,scope]；类型 t/n/b/s/m/d/f 对应 text/number/boolean/single/multi/date/file，* 表示必填、空字符串表示可选。g 的顺序是 [候选组key,候选状态,[[定义引用,出现轮数]],覆盖率,必填意见率,公共属性意见率]。状态和频次不是最终决定，完整属性定义之间可能有冲突。

输出结构：
{"category_id":"...","decisions":[{"key":"...","action":"keep|drop|review|add","reason":"简短原因","property":{"key":"...","name":"...","type":"text|number|boolean|single|multi|date|file","required":false,"unit":null,"options":[],"description":"","format":null,"example":null,"scope":"shared|category"}}],"notes":[]}
keep/review/drop 必须使用输入候选组 key；add 才使用新 key。property 仅在 add 必填，或 keep 纠正已有候选时提供；drop/review 通常省略。多定义 keep 示例：{"key":"length","action":"keep","variant":"a2","reason":"选用统一计量单位"}。group key 与所选定义的原 key 不同时，最终 key 仍使用 group key。`;

export function reviewVariantIndex(category: CategoryConsensus) {
  const variants = new Map([...category.shared, ...category.properties].flatMap((candidate) => candidateVariants(candidate).map((variant) => [variant.id, variant] as const)));
  return new Map([...variants.values()].sort((a, b) => a.id.localeCompare(b.id)).map((variant, index) => [`a${index.toString(36)}`, variant]));
}

export function buildSemanticReviewPrompt(input: {
  category: CategoryConsensus;
  evidenceText?: string;
}): string {
  const category = prepareReviewCategory(input.category);
  const references = reviewVariantIndex(category);
  const byVariantId = new Map([...references].map(([reference, variant]) => [variant.id, reference]));
  const candidates = [...category.shared, ...category.properties].sort((a, b) => a.key.localeCompare(b.key)).map((candidate) => [
    candidate.key, candidate.decision, candidateVariants(candidate).map((variant) => [byVariantId.get(variant.id), variant.roundIds.length]),
    candidate.coverage, candidate.requiredRate, candidate.sharedRate,
  ]);
  // 固定协议、类目和证据放在前缀；候选统计可能随新批次变化，放在最后以尽量命中 KV 缓存。
  return `请审阅下面一个三横末级类目的属性候选。

#CATEGORY
${JSON.stringify(category.category)}
#EVIDENCE
${input.evidenceText?.trim() ?? "（暂无京东证据）"}
#CANDIDATES
${JSON.stringify({ rounds: category.runCount, d: Object.fromEntries([...references].map(([reference, variant]) => [reference, propertyToTuple(variant.property)])), g: candidates })}

返回一个 JSON 对象，category_id 必须使用输入类目的完整 ID；不要返回或修改任何类目字段。若明确判断其余未列出候选均不适用，可返回 drop_remaining=true 和 drop_reason 以压缩输出；否则 decisions 必须覆盖每个候选组 key。你可以增加当前类目确有必要但候选缺失的属性。`;
}

export function semanticReviewInputFingerprint(prompt: string, system = SEMANTIC_REVIEW_SYSTEM_PROMPT): string {
  return createHash("sha256").update(system).update("\n").update(prompt).digest("hex");
}

function cleanProperty(value: unknown): AttributeProperty {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("语义审阅新增属性必须是对象");
  const item = value as Record<string, unknown>;
  if (typeof item.key !== "string" || !item.key.trim() || typeof item.name !== "string" || !item.name.trim() ||
      typeof item.type !== "string" || !["text", "number", "boolean", "single", "multi", "date", "file"].includes(item.type) ||
      typeof item.required !== "boolean") throw new Error("property 必须提供完整的 key、name、有效 type 和布尔 required");
  if (item.unit != null && typeof item.unit !== "string") throw new Error("property.unit 必须为字符串或 null");
  if (item.options !== undefined && (!Array.isArray(item.options) || item.options.some((option) => typeof option !== "string"))) throw new Error("property.options 必须是字符串数组");
  return {
    key: item.key, name: item.name,
    type: item.type as AttributeProperty["type"],
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
  category = prepareReviewCategory(category);
  const clean = text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  const data = JSON.parse(clean) as Record<string, unknown>;
  if (data.category_id !== category.category.id) throw new Error("语义审阅 category_id 不匹配");
  if (!Array.isArray(data.decisions)) throw new Error("语义审阅 decisions 必须是数组");
  const keys = new Set([...category.shared, ...category.properties].map((item) => item.key));
  const candidates = new Map([...category.shared, ...category.properties].map((item) => [item.key, item]));
  const references = reviewVariantIndex(category);
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
    let property = action === "add" || action === "keep" && item.property !== undefined ? cleanProperty(item.property) : undefined;
    let variantId: string | undefined;
    if (property && property.key !== key) throw new Error(`语义审阅 property key 不一致：${key}/${property.key}`);
    if (action === "keep") {
      const candidate = candidates.get(key)!;
      const variants = candidateVariants(candidate);
      if (item.variant !== undefined && property) throw new Error(`候选 ${key} 不能同时指定 variant 和 property`);
      if (item.variant !== undefined) {
        const selected = references.get(String(item.variant)) ?? variants.find((variant) => variant.id === item.variant);
        if (!selected || !variants.some((variant) => variant.id === selected.id)) throw new Error(`候选 ${key} 的定义引用无效：${item.variant}`);
        property = { ...selected.property, key };
        variantId = selected.id;
      } else if (!property) {
        if (variants.length > 1) throw new Error(`候选 ${key} 有多个定义，keep 必须指定 variant 或完整 property`);
        property = candidateProperty(candidate);
      }
    }
    decisions.push({ key, action: action as SemanticAction, reason: typeof item.reason === "string" ? item.reason : "", property, ...(variantId ? { variantId } : {}) });
  }
  const remaining = [...keys].filter((key) => !seen.has(key));
  let bulkDrop: SemanticReviewResult["bulkDrop"];
  if (data.drop_remaining === true) {
    if (typeof data.drop_reason !== "string" || !data.drop_reason.trim()) throw new Error("批量删除其余候选必须提供 drop_reason");
    bulkDrop = { keys: remaining, reason: data.drop_reason.trim() };
    for (const key of remaining) decisions.push({ key, action: "drop", reason: bulkDrop.reason });
  } else if (remaining.length) throw new Error(`语义审阅遗漏候选：${remaining[0]}`);
  const selected = decisions.flatMap((decision) => decision.property && (decision.action === "keep" || decision.action === "add") ? [decision.property] : []);
  if (selected.length) validateAttributeProperties(selected);
  const notes = Array.isArray(data.notes) ? data.notes.filter((value): value is string => typeof value === "string").slice(0, 3).map((value) => value.slice(0, 120)) : [];
  return { categoryId: category.category.id, decisions, notes, ...(evidenceDecisions.length ? { evidenceDecisions } : {}), ...(bulkDrop ? { bulkDrop } : {}) };
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
    categories: consensus.categories.map((sourceCategory) => {
      const category = prepareReviewCategory(sourceCategory);
      const review = reviewByCategory.get(category.category.id);
      const candidates = new Map([...category.shared, ...category.properties].map((candidate) => [candidate.key, candidate]));
      const selected: AttributeProperty[] = [];
      if (review) {
        for (const decision of review.decisions) {
          if (decision.action === "keep") {
            const candidate = candidates.get(decision.key);
            if (candidate) {
              if (!decision.property && candidateVariants(candidate).length > 1) throw new Error(`候选 ${candidate.key} 的旧决策没有裁决多个定义`);
              const property = decision.property ?? candidateProperty(candidate);
              selected.push(property);
            }
          } else if (decision.action === "add" && decision.property) selected.push(decision.property);
        }
      } else {
        for (const candidate of [...category.shared, ...category.properties].filter((item) => item.decision === "confirmed" && candidateVariants(item).length === 1)) {
          selected.push(candidateProperty(candidate));
        }
      }
      return {
        category: category.category,
        shared: selected.filter((property) => property.scope === "shared"),
        properties: selected.filter((property) => property.scope !== "shared"),
        notes: [...category.notes, ...(review?.notes ?? [])].slice(0, 10),
      };
    }),
  };
}

/** 小批次只替换本次审阅成功的模板，不把旧 keep 决策套到已经变化的新候选上。 */
export function mergeSemanticTemplates(previous: SemanticTemplateDocument | undefined, incoming: SemanticTemplateDocument): SemanticTemplateDocument {
  const categories = new Map((previous?.categories ?? []).map((category) => [category.category.id, category]));
  for (const category of incoming.categories) categories.set(category.category.id, category);
  return { ...incoming, sourceConsensus: [...new Set([...(previous?.sourceConsensus ?? []), ...incoming.sourceConsensus])].sort(),
    categories: [...categories.values()].sort((a, b) => a.category.path.join("/").localeCompare(b.category.path.join("/"))),
  };
}

export function applySuccessfulSemanticReviews(consensus: AttributeConsensusDocument, incoming: SemanticReviewResult[], previous?: SemanticTemplateDocument): SemanticTemplateDocument {
  const ids = new Set(incoming.map((review) => review.categoryId));
  return mergeSemanticTemplates(previous, applySemanticReviews({ ...consensus, categories: consensus.categories.filter((category) => ids.has(category.category.id)) }, incoming));
}
