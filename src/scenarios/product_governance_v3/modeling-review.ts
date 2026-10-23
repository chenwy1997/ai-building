import { normalized, type AttributeDefinition, type AttributeBinding, type ExtensionCandidate } from "./core.ts";

type Proposal = { categoryId: string; category: string; attributes: AttributeDefinition[];
  bindings: AttributeBinding[]; extensionCandidates: ExtensionCandidate[] };
export interface ModelingReviewSignal {
  ruleId: "R02" | "R07";
  kind: "requiredness_evidence_language" | "different_disposition";
  categoryIds: string[];
  question: string;
  evidence: { categoryId: string; category: string; attributeId: string; name: string;
    conceptKey: string; scope: string; disposition: string; text: string }[];
}

// Review routing, NOT a semantic validator. These signals never change values,
// block a proposal, or establish that two fields have the same business meaning.
export function modelingReviewSignals(proposals: Proposal[]): ModelingReviewSignal[] {
  const signals: ModelingReviewSignal[] = [];
  for (const p of proposals) for (const b of p.bindings) {
    const a = p.attributes.find(a => a.id === b.attributeId);
    if (!a) continue;
    const clauses = b.requirednessReason.split(/[。；;，,]/);
    const evidenceLanguage = clauses.some(c =>
      /取证|标注|样本|商品资料|SKU资料|商品展示数据|可得性|稳定取得/.test(c) &&
      !/不是.{0,8}判据|不按.{0,12}设必填|不作为.{0,8}判据|不能.{0,8}决定|无关/.test(c));
    if (evidenceLanguage) signals.push({ ruleId: "R02", kind: "requiredness_evidence_language",
      categoryIds: [p.categoryId],
      question: "填写要求理由涉及资料可得性：是否混用了取值缺口与业务必要性？按缺失对选型的影响裁定；本线索未自动判错。",
      evidence: [{ categoryId: p.categoryId, category: p.category, attributeId: a.id, name: a.name,
        conceptKey: a.conceptKey, scope: a.scope, disposition: b.requiredness, text: b.requirednessReason }] });
  }
  const items = proposals.flatMap(p => [
    ...p.attributes.map(a => ({ categoryId: p.categoryId, category: p.category, attributeId: a.id,
      name: a.name, conceptKey: a.conceptKey, scope: a.scope, disposition: "attribute", text: a.rationale })),
    ...p.extensionCandidates.map(a => ({ categoryId: p.categoryId, category: p.category, attributeId: a.id,
      name: a.name, conceptKey: a.conceptKey, scope: a.scope, disposition: "extension", text: a.deferReason })),
  ]);
  const groups = new Map<string, typeof items>();
  for (const item of items) for (const key of ["concept:" + normalized(item.conceptKey), "name:" + normalized(item.name)])
    groups.set(key, [...groups.get(key) ?? [], item]);
  const seen = new Set<string>();
  for (const evidence of groups.values()) {
    if (new Set(evidence.map(e => e.disposition)).size < 2 || new Set(evidence.map(e => e.categoryId)).size < 2) continue;
    const identity = evidence.map(e => e.categoryId + ":" + e.attributeId).sort().join("|");
    if (seen.has(identity)) continue;
    seen.add(identity);
    signals.push({ ruleId: "R07", kind: "different_disposition", categoryIds: [...new Set(evidence.map(e => e.categoryId))],
      question: "跨类同概念键或同名候选有不同取舍：核实计量对象、适用场景及维护价值是否解释差异；相同名称不证明同义，不自动合并或统一准入。",
      evidence });
  }
  return signals;
}
