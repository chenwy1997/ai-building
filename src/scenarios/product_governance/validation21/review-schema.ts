import type { ProductEvidence, CategoryDecision, EvidenceReference } from '../expansion/rules.ts';
import type { ConditionFact } from '../revision/conditions.ts';
import type { RevisionClaim, RevisionDefinition, RevisionStandard } from '../revision/semantic-guards.ts';

export const MODELS = ['deepseek', 'kimi', 'glm', 'qwen'] as const;
export type ModelId = typeof MODELS[number];
export interface SourceProduct {
  key: string; id: string; categoryId: string; categoryName?: string; categoryPath?: string; sampleRank?: number;
  oldKey?: string; batch?: string; cohort?: string; title?: string; saleSpec?: string; brand?: string;
  evidence: ProductEvidence[]; images?: Array<{ url: string; [key: string]: unknown }>;
  mainImageLocal?: string; imageSha256?: string; verifiedVisualEvidenceIds?: string[];
  [key: string]: unknown;
}
export interface CategoryReview extends CategoryDecision {
  reason: string;
  categoryReasonCode?: 'needs_product_evidence' | 'category_strategy_pending';
  gapAssessment?: { status: 'confirmed_missing_category'; proposedName: string; reason: string; fullTreeChecked: true; treeHash: string; evidence: EvidenceReference[] };
}
export interface RuleDecision {
  attributeId: string; code: string; decision: 'accepted' | 'corrected'; reason: string;
  evidence?: EvidenceReference[]; evidenceId?: string; quote?: string;
}
export interface CodexReview {
  key: string; category: CategoryReview; fields: Record<string, RevisionClaim>; conditionFacts: ConditionFact[];
  evidence?: ProductEvidence[]; visualEvidence?: ProductEvidence[]; imageVerified?: boolean;
  ruleDecisions?: RuleDecision[]; reviewNotes: string[]; standardHash?: string; productHash?: string;
  [key: string]: unknown;
}
export interface ReviewEnvelope { schema?: string; reviewer?: 'Codex'; standardHash?: string; products: CodexReview[] }
export interface ModelAttempt {
  key: string; model: ModelId; sourceFile: string; sourceRecord?: string; stage: string; requestHash?: string;
  originalStatus?: string; syntaxRecovery?: unknown; modelIdentity?: unknown; modifiedAt: number; opinion: Record<string, any>;
}
export interface V2Leaf { id: string; name: string; path: string; isLeaf: boolean; [key: string]: unknown }
export interface RunContext {
  deliveryPolicy?: { id: 'available-opinions-20261020'; standardHash: string; productsHash: string; requiredModels: ModelId[]; optionalModels: ModelId[]; authorization: string };
  runDir: string; runId: string; standard: Omit<RevisionStandard, 'definitions'> & { definitions: readonly (RevisionDefinition & { rule?: string })[]; categories: V2Leaf[]; [key: string]: any };
  standardHash: string; products: SourceProduct[]; productsHash: string; leaves: V2Leaf[]; treeHash: string;
  modelAttempts: ModelAttempt[]; modelDiagnostics: Array<Record<string, any>>;
  manifests: Record<string, any>; universeBlockers: Array<Record<string, any>>;
  visualRegistry: Array<Record<string, any>>; brandNames: string[];
}
export interface LoadedReview { review: CodexReview; sourceFile: string; envelopeStandardHash?: string }
export const isObject = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
