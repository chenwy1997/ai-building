import {
  object,
  text,
  list,
  nullable,
  numeric,
  bool,
  integer,
  type Schema,
  type Stage,
} from "./core.ts";

const strings = list(text());
export const modelReferenceSchema = object({
  kind: text("knowledge", "sku-source"),
  id: text(),
  version: text(),
  quote: text(),
});
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
  valueLevel: text("SKU"),
  numberConfig: nullable(
    object({
      isInt: bool,
      precision: nullable({ ...integer, minimum: 0, maximum: 15 }),
      min: nullable(numeric),
      max: nullable(numeric),
    }),
  ),
  textConfig: nullable(
    object({
      format: nullable(text()),
      minLength: nullable({ ...integer, minimum: 0 }),
      maxLength: nullable({ ...integer, minimum: 0 }),
      displayMethod: nullable(text()),
      trim: bool,
    }),
  ),
  optionConfig: nullable(
    object({
      minCount: nullable({ ...integer, minimum: 0 }),
      maxCount: nullable({ ...integer, minimum: 0 }),
    }),
  ),
  defaultValue: { type: "null" },
  rationale: text(),
  references: list(modelReferenceSchema),
});
export const bindingSchema = object({
  attributeId: text(),
  categoryId: nullable(text()),
  requiredness: text("required", "optional"),
  requirednessReason: text(),
  isKeySpec: bool,
  isPublic: bool,
  searchable: bool,
  displayInTitle: bool,
  displayInList: bool,
  sortIndex: integer,
  uses: list(text("selection", "comparison", "search", "display"), 1),
  baselineAttributeId: nullable(text()),
  differenceReason: nullable(text()),
});
export const extensionCandidateSchema = object({
  id: text(),
  name: text(),
  conceptKey: text(),
  scope: text(),
  potentialUse: text(),
  deferReason: text(),
  activationCriteria: text(),
  references: list(modelReferenceSchema),
});
// Decisions concern business modeling, not the availability of values in sampled SKUs.
export const modelingDecisionSchema = object({
  objectId: text(),
  disposition: text("admitted", "extension", "system_owned", "not_needed"),
  businessNeed: text("confirmed", "pending", "not_needed"),
  admissionBasis: text("business_need", "sample_availability"),
  businessReason: text(),
  requiredNecessity: text("confirmed", "pending", "optional"),
  requirednessBasis: text("business_need", "sample_availability"),
  professionalReadiness: text("defined", "pending"),
  professionalReason: text(),
  valueEvidence: text("available", "missing", "unassessed"),
  quantity: nullable(object({
    measure: text("contents_per_package", "sales_unit_count", "other_count"),
    countedObject: text(),
    denominator: text("package", "sales_unit", "other"),
    countTerms: list(text(), 1),
    systemFieldKeys: list(text(), 1),
    relation: text("same", "distinct", "conditional", "unresolved"),
    sameWhen: nullable(text()),
    differentWhen: nullable(text()),
    overlapAction: text("reuse_system_field", "not_applicable"),
    reason: text(),
  })),
});
export const factRefSchema = object({ sourceId: text(), factId: text() });
export const derivationSchema = object({
  policyId: text(),
  policyVersion: text(),
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
  "fact-extraction": object({
    categoryId: text(),
    productId: text(),
    candidates: list(
      object({
        id: text(),
        attributeId: text(),
        sourceId: text(),
        sourceVersion: text(),
        start: { ...integer, minimum: 0 },
        end: { ...integer, minimum: 1 },
        quote: text(),
        value: valueSchema,
        normalization: text("identity", "kg-to-g", "cm-to-mm", "m-to-mm"),
        rationale: text(),
      }),
    ),
    unresolved: strings,
  }),
  "family-modeling": object({
    categoryId: text(),
    baselineVersion: nullable(text()),
    attributes: list(attributeSchema),
    bindings: list(bindingSchema),
    extensionCandidates: list(extensionCandidateSchema),
    decisions: list(modelingDecisionSchema),
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
        references: list(modelReferenceSchema),
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
        references: list(modelReferenceSchema),
        needsProfessionalReview: bool,
      }),
    ),
    proposedFamilyIds: strings,
    unresolved: strings,
  }),
};
export interface Derivation {
  policyId: string;
  policyVersion: string;
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
