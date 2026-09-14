import { acceptedRevision, applyRevisionPatch, hashText, matchesRevisionInput, parseRevisionPatch, revisionInputFingerprint, templateFingerprint, type RevisionInput, type RevisionResult } from "./attribute-revision.ts";
import { emptySemanticReviewUsage } from "./semantic-review.ts";

/** 裁决来自明确的 AI/人工审阅文件，不由关键词规则把模型的拒绝改成通过。 */
export interface AttributeAdjudication {
  version: "attribute-adjudication-v1";
  reviewer: string;
  reviewedAt: string;
  sourceRun: string;
  decisions: Array<{
    categoryId: string;
    sourceInputFingerprint: string;
    sourceTemplateFingerprint: string;
    outcome: "accept" | "hold";
    rationale: string;
    issues: Array<{ index: number; disposition: "dismissed" | "fixed" | "unresolved"; reason: string }>;
    correction?: unknown; // 与提案相同的增量对象，但以 source.proposed 为基准。
    finalTemplateFingerprint: string;
    sources: Array<{ title: string; url: string; supports: string }>;
  }>;
}

export function validateAdjudication(document: AttributeAdjudication): void {
  if (document.version !== "attribute-adjudication-v1" || !document.reviewer?.trim() || !document.sourceRun?.trim() || !Number.isFinite(Date.parse(document.reviewedAt))) throw new Error("裁决文件缺少版本、审阅者、时间或来源运行");
  if (!Array.isArray(document.decisions) || !document.decisions.length) throw new Error("裁决清单不能为空");
  const ids = new Set<string>();
  for (const d of document.decisions) {
    if (!d.categoryId || ids.has(d.categoryId)) throw new Error("裁决类目 ID 为空或重复"); ids.add(d.categoryId);
    if (![d.sourceInputFingerprint, d.sourceTemplateFingerprint, d.finalTemplateFingerprint].every(v => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v))) throw new Error("裁决必须绑定来源输入、来源模板与最终模板指纹");
    if (!["accept", "hold"].includes(d.outcome) || !d.rationale?.trim() || !Array.isArray(d.issues) || !Array.isArray(d.sources)) throw new Error("裁决缺少结论、理由、问题处理或来源清单");
    for (const i of d.issues) if (!Number.isInteger(i.index) || !["dismissed", "fixed", "unresolved"].includes(i.disposition) || !i.reason?.trim()) throw new Error("每个问题必须有明确裁决和理由");
    for (const s of d.sources) if (!s.title?.trim() || !s.supports?.trim() || !/^https?:\/\//u.test(s.url)) throw new Error("来源必须包含标题、链接与支持的具体结论");
  }
}

export function adjudicateRevision(input: RevisionInput, source: RevisionResult, document: AttributeAdjudication, decision: AttributeAdjudication["decisions"][number]): RevisionResult {
  validateAdjudication({ ...document, decisions: [decision] });
  if (decision.categoryId !== input.category.category.id || source.categoryId !== decision.categoryId) throw new Error("裁决类目与来源不一致");
  if (source.baseFingerprint !== templateFingerprint(input.base) || !matchesRevisionInput(source.inputFingerprint, input)) throw new Error("裁决基准、候选或证据已经变化，需要重新核对，禁止覆盖");
  if (source.inputFingerprint !== decision.sourceInputFingerprint || !source.proposed || decision.sourceTemplateFingerprint !== templateFingerprint(source.proposed)) throw new Error("裁决来源模板或输入指纹不一致");
  if (!source.judgment || source.judgment.templateFingerprint !== templateFingerprint(source.proposed)) throw new Error("来源缺少与模板绑定的验收记录");
  const indexes = decision.issues.map(i => i.index).sort((a, b) => a - b);
  if (JSON.stringify(indexes) !== JSON.stringify(source.judgment.issues.map((_, i) => i))) throw new Error("必须逐项处理来源验收问题，不能遗漏或重复");
  if (decision.outcome === "accept" && decision.issues.some(i => i.disposition === "unresolved")) throw new Error("存在未解决的问题，不能采用");
  const patch = decision.correction ? parseRevisionPatch(JSON.stringify(decision.correction), { ...input, base: source.proposed }) : { categoryId: decision.categoryId, scope: "保留已审阅提案", upsert: [], remove: [], defer: [] };
  const proposed = applyRevisionPatch(source.proposed, patch);
  if (templateFingerprint(proposed) !== decision.finalTemplateFingerprint) throw new Error("最终模板不是裁决者确认的内容，禁止采用");
  const accepted = decision.outcome === "accept";
  const reviewedReference = accepted ? JSON.stringify({ rationale: decision.rationale, sources: decision.sources, note: "这是经过审阅的类目参考，仍需核对适用边界；不是具体商品认证或不可质疑的真值。" }) : input.reviewedReference;
  const result: RevisionResult = {
    categoryId: decision.categoryId, status: accepted ? "accepted" : "needs_review",
    inputFingerprint: revisionInputFingerprint(input), baseFingerprint: source.baseFingerprint,
    ...(accepted ? { settledFingerprint: revisionInputFingerprint({ ...input, base: proposed, reviewedReference }), reviewedReference } : { stopReason: "review_required" as const }),
    proposed, judgment: accepted ? { categoryId: decision.categoryId, verdict: "accept", issues: [], templateFingerprint: templateFingerprint(proposed) } : source.judgment,
    adjudication: { reviewer: document.reviewer, sourceRun: document.sourceRun, sourceTemplateFingerprint: decision.sourceTemplateFingerprint, decision },
    requestCount: 0, usage: emptySemanticReviewUsage(),
  };
  acceptedRevision(input.base, result);
  return result;
}

export function adjudicationFingerprint(result: RevisionResult): string | undefined {
  return result.adjudication ? hashText(JSON.stringify(result.adjudication)) : undefined;
}
