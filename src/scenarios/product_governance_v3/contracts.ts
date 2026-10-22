import {
  object,
  text,
  list,
  nullable,
  numeric,
  bool,
  type Schema,
  type Stage,
} from "./core.ts";

const strings = list(text());
export const valueSchema: Schema = {
  anyOf: [{ type: "string" }, numeric, bool, { type: "null" }, list(text())],
};
export const attributeSchema = object({
  id: text(),
  name: text(),
  conceptKey: text(),
  definition: text(),
  scope: text(),
  fieldType: text("text", "number", "boolean", "option", "date"),
  unit: nullable(text()),
  enumValues: strings,
  multi: bool,
  requiredness: text("required", "optional"),
  valueLevel: text("SKU"),
  isKeySpec: bool,
  isPublic: bool,
  searchable: bool,
  uses: list(text("selection", "comparison", "search", "display"), 1),
  rationale: text(),
  baselineAttributeId: nullable(text()),
  differenceReason: nullable(text()),
  sourceIds: strings,
});
export const factRefSchema = object({ sourceId: text(), factId: text() });
export const derivationSchema = object({
  operator: text("multiply", "divide", "convert"),
  inputs: list(factRefSchema, 1),
  targetUnit: text(),
});
export const evidenceSchema = object({
  sourceId: text(),
  quote: text(),
  factId: nullable(text()),
});
export const filledValueSchema = object({
  attributeId: text(),
  status: text("known", "unknown", "not_applicable", "conflict"),
  value: valueSchema,
  evidence: list(evidenceSchema),
  derivation: nullable(derivationSchema),
  reason: text(),
});
export const outputSchemas: Record<Stage, Schema> = {
  "family-modeling": object({
    categoryId: text(),
    baselineVersion: nullable(text()),
    attributes: list(attributeSchema, 1),
    unresolved: strings,
  }),
  "sku-filling": object({
    categoryId: text(),
    productId: text(),
    values: list(filledValueSchema, 1),
    unresolved: strings,
  }),
  "review-assistance": object({
    categoryId: text(),
    findings: list(
      object({
        ruleId: text(),
        objectId: text(),
        severity: text("high", "medium", "low"),
        issue: text(),
        sourceIds: strings,
      }),
    ),
    unresolved: strings,
  }),
  "domain-research": object({
    categoryId: text(),
    knowledgeIdsConsulted: strings,
    questions: list(
      object({
        topic: text(),
        impact: text(),
        sourceIds: strings,
        needsProfessionalReview: bool,
      }),
    ),
    proposedFamilyIds: strings,
    unresolved: strings,
  }),
};
export interface Derivation {
  operator: "multiply" | "divide" | "convert";
  inputs: { sourceId: string; factId: string }[];
  targetUnit: string;
}
export interface FilledValue {
  attributeId: string;
  status: "known" | "unknown" | "not_applicable" | "conflict";
  value: unknown;
  evidence: { sourceId: string; quote: string; factId: string | null }[];
  derivation: Derivation | null;
  reason: string;
}
