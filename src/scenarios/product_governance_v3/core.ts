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
  | "domain-research";
export const STAGES: Stage[] = [
  "family-modeling",
  "sku-filling",
  "review-assistance",
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
    if (typeof value !== schema.type)
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

export interface Attribute {
  id: string;
  name: string;
  conceptKey: string;
  definition: string;
  scope: string;
  fieldType: "text" | "number" | "boolean" | "option" | "date";
  unit: string | null;
  enumValues: string[];
  multi: boolean;
  requiredness: "required" | "optional";
  valueLevel: "SKU";
  isKeySpec: boolean;
  isPublic: boolean;
  searchable: boolean;
  uses: string[];
  rationale: string;
  baselineAttributeId: string | null;
  differenceReason: string | null;
  sourceIds: string[];
}
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
  attributes: Attribute[];
}
export interface Snapshot {
  version: string;
  kind: "fixture" | "local";
  tree: { nodes: unknown[]; rootId?: string; externalParentIds?: string[] };
  systemFields: { key: string; names: string[]; conceptKeys: string[] }[];
  families: Family[];
  attributes: Attribute[];
  sources: Source[];
  products: Product[];
  knowledgeIds: string[];
  derivationPolicies: {
    id: string;
    operator: "multiply" | "divide" | "convert";
    targetConceptKey: string;
    inputConceptKeys: string[];
    targetUnit: string;
  }[];
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
}
