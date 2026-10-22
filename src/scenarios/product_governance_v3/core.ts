import {
  canonical,
  hash,
  save,
  lock,
  read,
  exists,
} from "../product_governance_v2/runtime/store.ts";
export { canonical, hash, save, lock, read, exists };

export type Stage =
  | "family-modeling"
  | "sku-filling"
  | "review-assistance"
  | "fact-extraction"
  | "domain-research";
export const STAGES: Stage[] = [
  "family-modeling",
  "sku-filling",
  "review-assistance",
  "fact-extraction",
  "domain-research",
];
export type Scalar = string | number | boolean | null;
export type BusinessValue = Scalar | string[];
export type Schema = {
  type?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
  enum?: unknown[];
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  anyOf?: Schema[];
};
export const text = (...values: string[]): Schema => ({
  type: "string",
  ...(values.length ? { enum: values } : { minLength: 1 }),
});
export const nullable = (s: Schema): Schema => ({
  anyOf: [s, { type: "null" }],
});
export const list = (items: Schema, minItems = 0): Schema => ({
  type: "array",
  items,
  minItems,
});
export const object = (
  properties: Record<string, Schema>,
  required = Object.keys(properties),
): Schema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
export const numeric: Schema = { type: "number" };
export const integer: Schema = { type: "integer" };
export const bool: Schema = { type: "boolean" };

export function validate(schema: Schema, value: unknown, path = "$"): string[] {
  if (schema.anyOf)
    return schema.anyOf.some((s) => !validate(s, value, path).length)
      ? []
      : [`${path}: no allowed type`];
  const errors: string[] = [];
  if (schema.type === "null")
    return value === null ? [] : [`${path}: null required`];
  if (schema.type === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return [`${path}: object required`];
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? [])
      if (!Object.hasOwn(obj, key)) errors.push(`${path}.${key}: missing`);
    for (const [key, v] of Object.entries(obj)) {
      if (!schema.properties?.[key]) {
        if (schema.additionalProperties === false)
          errors.push(`${path}.${key}: unexpected`);
      } else
        errors.push(...validate(schema.properties[key]!, v, `${path}.${key}`));
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) return [`${path}: array required`];
    if (
      value.length < (schema.minItems ?? 0) ||
      value.length > (schema.maxItems ?? Infinity)
    )
      errors.push(`${path}: array length`);
    value.forEach((v, i) => {
      if (schema.items)
        errors.push(...validate(schema.items, v, `${path}[${i}]`));
    });
  } else {
    if (
      schema.type === "integer"
        ? !Number.isInteger(value)
        : typeof value !== schema.type
    )
      return [`${path}: ${schema.type} required`];
    if (
      typeof value === "number" &&
      (!Number.isFinite(value) ||
        value < (schema.minimum ?? -Infinity) ||
        value > (schema.maximum ?? Infinity))
    )
      errors.push(`${path}: invalid number`);
    if (typeof value === "string" && value.length < (schema.minLength ?? 0))
      errors.push(`${path}: string too short`);
    if (
      typeof value === "string" &&
      (schema.minLength ?? 0) > 0 &&
      !value.trim()
    )
      errors.push(`${path}: blank string`);
    if (
      typeof value === "string" &&
      value.length > (schema.maxLength ?? Infinity)
    )
      errors.push(`${path}: string too long`);
  }
  if (
    schema.enum &&
    !schema.enum.some((x) => canonical(x) === canonical(value))
  )
    errors.push(`${path}: enum mismatch`);
  return errors;
}
export function assertSchema(schema: Schema, value: unknown, label: string) {
  const errors = validate(schema, value);
  if (errors.length) throw new Error(`${label}: ${errors.join("; ")}`);
}
export function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const v of Object.values(value)) freeze(v);
  }
  return value;
}
export function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
export function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
export const normalized = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
export class Blocked extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "Blocked";
  }
}

export interface ModelReference {
  kind: "knowledge" | "sku-source";
  id: string;
  version: string;
  quote: string;
}
export interface AttributeDefinition {
  id: string;
  name: string;
  conceptKey: string;
  definition: string;
  scope: string;
  fieldType: "text" | "number" | "boolean" | "option" | "date";
  unit: string | null;
  enumValues: string[];
  multi: boolean;
  valueLevel: "SKU";
  numberConfig: {
    isInt: boolean;
    precision: number | null;
    min: number | null;
    max: number | null;
  } | null;
  textConfig: {
    format: string | null;
    minLength: number | null;
    maxLength: number | null;
    displayMethod: string | null;
    trim: boolean;
  } | null;
  optionConfig: { minCount: number | null; maxCount: number | null } | null;
  defaultValue: null;
  rationale: string;
  references: ModelReference[];
}
export interface AttributeBinding {
  attributeId: string;
  // null is the family template; a leaf override has a concrete categoryId.
  categoryId: string | null;
  requiredness: "required" | "optional";
  requirednessReason: string;
  isKeySpec: boolean;
  isPublic: boolean;
  searchable: boolean;
  displayInTitle: boolean;
  displayInList: boolean;
  sortIndex: number;
  uses: string[];
  baselineAttributeId: string | null;
  differenceReason: string | null;
}
// Resolved runtime view. Authoritative storage/output keeps definitions and bindings separate.
export type Attribute = AttributeDefinition & { binding: AttributeBinding };
export interface Fact {
  id: string;
  conceptKey: string;
  value: BusinessValue;
  unit: string | null;
  scope: string;
  quote: string;
  kind: "direct";
}
export interface Source {
  id: string;
  productId: string;
  salesUnitId: string;
  version: string;
  text: string;
  facts: Fact[];
  origin?: {
    sourceId: string;
    productId: string;
    productInstanceId: string;
    governanceCategoryId: string;
    standardCategoryId: string;
    categoryInstanceId: string | null;
    stableMountedCategoryId: string | null;
    propertyId: string;
    propertyInstanceId: string;
    propertyValueInstanceId: string;
    jsonPointer: string;
    capturePath: string;
    captureHash: string;
    rawValueHash: string;
    capturedAt: string;
    sourceKind: string;
    derivedText: boolean;
  };
  factPreparation: {
    status: "candidate" | "reviewed";
    kind: "fixture" | "human" | "agent";
    recordId: string;
    contentHash: string;
  };
}
export function factPreparationHash(s: Source) {
  return hash({
    id: s.id,
    productId: s.productId,
    salesUnitId: s.salesUnitId,
    version: s.version,
    text: s.text,
    facts: s.facts,
    ...(s.origin ? { origin: s.origin } : {}),
  });
}
export interface Product {
  id: string;
  categoryId: string;
  salesUnitId: string;
  composition: "homogeneous" | "mixed" | "unknown";
  giftState: "none" | "present" | "unknown";
  assumptionSourceIds: string[];
  sourceIds: string[];
}
export interface Family {
  id: string;
  version: string;
  members: string[];
  status: "confirmed" | "candidate" | "in_progress" | "failed";
  runId: string | null;
  attributes: AttributeDefinition[];
  bindings: AttributeBinding[];
}
// Minimum known responsibilities, established by the approved supply-chain contract.
// This is not a complete production field inventory; snapshots must supply and review the rest.
export const REQUIRED_SYSTEM_OWNERS = freeze([
  { key: "brandId", names: ["品牌"], conceptKeys: ["common.brand"] },
  { key: "supplierId", names: ["供应商"], conceptKeys: ["common.supplier"] },
  { key: "salesUnit", names: ["销售单位"], conceptKeys: ["sales.unit"] },
  { key: "specName", names: ["规格名称"], conceptKeys: ["sales.spec"] },
]);
export interface Snapshot {
  format: 2;
  version: string;
  kind: "fixture" | "local";
  tree: { nodes: unknown[]; rootId?: string; externalParentIds?: string[] };
  systemFields: { key: string; names: string[]; conceptKeys: string[] }[];
  systemFieldCoverage: {
    version: string;
    source: string;
    sourceHash: string;
    status: "complete" | "partial";
    coveredKeys: string[];
  };
  families: Family[];
  attributes: AttributeDefinition[];
  sources: Source[];
  products: Product[];
  knowledgeIds: string[];
  knowledgeRequirements: {
    id: string;
    categoryIds: string[];
    stages: Stage[];
    knowledgeIds: string[];
    reason: string;
  }[];
  derivationPolicies: DerivationPolicy[];
}
export interface DerivationPolicy {
  id: string;
  version: string;
  rationale: string;
  operator: "multiply" | "divide" | "convert";
  targetConceptKey: string;
  inputConceptKeys: string[];
  targetUnit: string;
  factors: {
    conceptKey: string;
    unit: string;
    kind: "count" | "measurement";
    min: number | null;
    max: number | null;
  }[];
  resultKind: "count" | "measurement";
}
export interface Task {
  runId: string;
  stage: Stage;
  categoryId: string;
  productId: string | null;
  question: string;
  candidate: unknown | null;
}
export interface Finding {
  ruleId: string;
  objectId: string;
  message: string;
}
export interface CheckReport {
  status: "program_pass_pending_human" | "program_blocked";
  errors: Finding[];
  humanReviewRules: string[];
  executedChecks: string[];
  knowledgeGaps: string[];
}
