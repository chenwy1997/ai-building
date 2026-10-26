import { hash, type Snapshot } from "./core.ts";
import { attachPilotCoreReview } from "./pilot-core.ts";

export const PILOT_KNOWLEDGE_ID = "wash-tissue-research-20261026";
export const PILOT_CATEGORIES = [
  { id: "7a1ea510-8777-46ba-bfa0-955b472a0d61", name: "洗脸巾" },
  { id: "640b5b8b-9d6e-4784-a8e2-53c291f0b7f7", name: "盒装抽纸" },
  { id: "ce3a9f67-613c-4707-bf3a-95193edb8a2d", name: "软包抽纸" },
] as const;

// Called only while creating a NEW default-profile input/round. Never rewrite a
// historical snapshot or enrich an explicit custom snapshot. The separately
// released offline core review supplies exact proposal-only applicability.
export function attachPilotKnowledge(data: Snapshot, selectedIds: string[]) {
  const targets = PILOT_CATEGORIES.filter(c => selectedIds.includes(c.id) &&
    data.tree.nodes.some(n => (n as { id: string; name: string }).id === c.id && (n as { id: string; name: string }).name === c.name));
  if (!targets.length) return null;
  if (!data.knowledgeIds.includes(PILOT_KNOWLEDGE_ID)) data.knowledgeIds.push(PILOT_KNOWLEDGE_ID);
  data.knowledgeRequirements ??= [];
  const requirement = {
    id: PILOT_KNOWLEDGE_ID, categoryIds: targets.map(c => c.id),
    stages: ["family-modeling", "domain-research", "review-assistance"] as const,
    knowledgeIds: [PILOT_KNOWLEDGE_ID],
    reason: "三个试点的冻结专业研究与待审边界；品牌样本不是全类标准，也不授予跨类复用范围",
  };
  data.knowledgeRequirements = data.knowledgeRequirements.filter(r => r.id !== requirement.id);
  data.knowledgeRequirements.push({ ...requirement, stages: [...requirement.stages] });
  const coreReview = attachPilotCoreReview(data, targets.map(c => c.id));
  return { knowledgeId: PILOT_KNOWLEDGE_ID, targetCategoryIds: targets.map(c => c.id), requirementHash: hash(requirement), coreReview };
}
