import type { AttributeProperty, CategoryNode, CategoryTreeDocument, GovernanceResult } from "../types.ts";
import type { JdEvidenceDocument } from "../jd-evidence.ts";

export type KnowledgeSource = { id: string; title: string; url?: string; kind: "manufacturer" | "standard" | "domain-knowledge"; supports: string };
export type KnowledgeProperty = AttributeProperty & { condition?: string; requiredWhenApplicable?: boolean; reason?: string; sources?: string[]; suggestedValues?: string[] };
export interface KnowledgePack {
  id: string;
  title: string;
  // Each path is an array: slashes inside real category names remain unambiguous.
  paths?: string[][];
  leafNames?: string[];
  excludeNames?: string[];
  mode: "replace" | "augment";
  reason: string;
  sources: string[];
  properties: KnowledgeProperty[];
  removeNames?: string[];
  scopeNote?: string;
}
export interface PropertyOrigin {
  kind: "curated" | "historical-candidate";
  packId?: string;
  sources: string[];
  reviews?: string[];
  jdFields?: Array<{ evidenceId: string; name: string; observed?: number }>;
}
export interface DraftCategory extends GovernanceResult {
  properties: KnowledgeProperty[];
  shared: KnowledgeProperty[];
  provenance: Record<string, PropertyOrigin>;
  knowledgePacks: string[];
  treatment: "curated-template" | "curated-core" | "historical-draft";
  changes: string[];
  cautions: string[];
}
export interface DraftDocument {
  schema: "sanheng-attribute-draft-v1";
  categoryVersion: string;
  edition: string;
  categories: DraftCategory[];
}
export interface InputSnapshot {
  schema: "sanheng-attribute-input-v1";
  capturedAt: string;
  tree: CategoryTreeDocument;
  candidates: { categories: GovernanceResult[] };
  evidence: JdEvidenceDocument;
  hashes: Record<string, string>;
}
export type BoundPack = { pack: KnowledgePack; targets: CategoryNode[] };
