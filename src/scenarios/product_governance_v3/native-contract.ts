import {
  Blocked,
  assertSchema,
  type AttributeDefinition,
  type AttributeBinding,
} from "./core.ts";
import { attributeSchema, bindingSchema } from "./contracts.ts";

// Read-only projection, verified against uece-base schema.prisma and product/(list)/tools.ts.
// It is not an API payload and carries no native object identity or authority to write.
export const TEXT_FORMATS: Record<string, RegExp | null> = {
  ANY: null,
  NUMBER: /^\d+$/,
  NUMBER_LETTER: /^[A-Za-z0-9]+$/,
  NUMBER_LETTER_DASH: /^[A-Za-z0-9-]+$/,
  NUMBER_LETTER_DASH_SLASH: /^[A-Za-z0-9/\-]+$/,
  EMAIL: /^\w+([-+.]\w+)*@\w+([-.]\w+)*\.\w+([-.]\w+)*$/,
  PHONE: /^1[3456789]\d{9}$/,
  URL: /^(https?|ftp):\/\/[^\s]+$/,
  IP_ADDRESS: /^((25[0-5]|2[0-4]\d|[01]?\d\d?)($|(?!\.$)\.)){4}$/,
  ID_CARD: /(^\d{15}$)|(^\d{18}$)|(^\d{17}(\d|X|x)$)/,
  POST_CODE: /^[1-9]\d{5}(?!\d)$/,
};
export const TEXT_DISPLAYS = ["link", "html", "jdsku", "longtext"];
export function definitionConfigErrors(a: AttributeDefinition): string[] {
  const errors: string[] = [];
  for (const [type, config] of [
    ["number", a.numberConfig],
    ["text", a.textConfig],
    ["option", a.optionConfig],
  ] as const)
    if ((a.fieldType === type) !== (config !== null))
      errors.push(`${type} configuration must match field type`);
  const n = a.numberConfig;
  if (
    n &&
    ((n.isInt && n.precision !== null) ||
      (n.min !== null && n.max !== null && n.min > n.max) ||
      (n.isInt &&
        [n.min, n.max].some((v) => v !== null && !Number.isInteger(v))))
  )
    errors.push("invalid numeric precision/range");
  const s = a.textConfig;
  if (
    s &&
    ((s.format !== null && !Object.hasOwn(TEXT_FORMATS, s.format)) ||
      (s.displayMethod !== null && !TEXT_DISPLAYS.includes(s.displayMethod)) ||
      (s.minLength !== null &&
        s.maxLength !== null &&
        s.minLength > s.maxLength))
  )
    errors.push(
      "invalid text preset/display/length; arbitrary regex is not supported",
    );
  const o = a.optionConfig;
  if (
    o &&
    ((!a.multi && (o.minCount !== null || o.maxCount !== null)) ||
      (o.minCount !== null && o.maxCount !== null && o.minCount > o.maxCount) ||
      (o.maxCount !== null && o.maxCount > a.enumValues.length) ||
      (o.minCount !== null && o.minCount > a.enumValues.length))
  )
    errors.push("invalid multi-option count constraints");
  if (a.enumValues.some((v) => v !== v.trim() || /[\r\n]/.test(v)))
    errors.push("option items cannot contain newlines or edge spaces");
  return errors;
}
export function strictDate(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  if (y < 1 || m < 1 || m > 12 || d < 1) return false;
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  return (
    d <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!
  );
}
export function valueConstraintErrors(
  a: AttributeDefinition,
  value: unknown,
): string[] {
  const errors: string[] = [];
  if (a.fieldType === "number" && typeof value === "number" && a.numberConfig) {
    const c = a.numberConfig;
    if (
      (c.isInt && !Number.isInteger(value)) ||
      value < (c.min ?? -Infinity) ||
      value > (c.max ?? Infinity)
    )
      errors.push("number outside integer/range constraints");
    if (!c.isInt && c.precision !== null) {
      const scaled = value * 10 ** c.precision;
      // Floating point tolerance, capped so large values cannot hide a fractional digit.
      if (
        Math.abs(scaled - Math.round(scaled)) >
        Math.min(1e-7, Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4)
      )
        errors.push("number exceeds configured precision");
    }
  }
  if (a.fieldType === "text" && typeof value === "string" && a.textConfig) {
    const c = a.textConfig,
      format = c.format === null ? null : TEXT_FORMATS[c.format];
    if (
      (c.trim && value !== value.trim()) ||
      value.length < (c.minLength ?? 0) ||
      value.length > (c.maxLength ?? Infinity) ||
      (format && !format.test(value))
    )
      errors.push("text outside trim/length/preset constraints");
  }
  if (a.multi && Array.isArray(value) && a.optionConfig) {
    const c = a.optionConfig;
    if (
      new Set(value).size !== value.length ||
      value.length < (c.minCount ?? 0) ||
      value.length > (c.maxCount ?? Infinity)
    )
      errors.push("option selection outside count/uniqueness constraints");
  }
  if (a.fieldType === "date" && !strictDate(value))
    errors.push("invalid ISO calendar date");
  return errors;
}
export function projectNative(a: AttributeDefinition, b: AttributeBinding) {
  assertSchema(attributeSchema, a, "native definition");
  assertSchema(bindingSchema, b, "native binding");
  const errors = definitionConfigErrors(a);
  if (b.searchable && !["text", "option"].includes(a.fieldType))
    errors.push("keyword indexing only supports text/option");
  if (a.fieldType === "number" && !a.unit) errors.push("numeric unit required");
  if (b.attributeId !== a.id || errors.length)
    throw new Blocked(
      "native_contract",
      errors.join("; ") || "binding does not reference definition",
    );
  const n = a.numberConfig,
    s = a.textConfig,
    o = a.optionConfig;
  return {
    kind: "offline_configuration_projection" as const,
    governanceAttributeId: a.id,
    categoryId: b.categoryId,
    fields: {
      title: a.name,
      description: a.definition,
      key: a.conceptKey,
      valueType: (
        {
          text: "STRING",
          number: "NUMBER",
          boolean: "BOOLEAN",
          date: "DATE",
          option: "OPTION",
        } as const
      )[a.fieldType],
      required: b.requiredness === "required",
      asSpec: true,
      isKeySpec: b.isKeySpec,
      isPublic: b.isPublic,
      isSearchable: b.searchable,
      displayInTitle: b.displayInTitle,
      displayInList: b.displayInList,
      sortIndex: b.sortIndex,
      metaNumberUnit: a.unit,
      metaNumberIsInt: n?.isInt ?? null,
      metaNumberPrecision: n?.precision ?? null,
      metaNumberMinValue: n?.min ?? null,
      metaNumberMaxValue: n?.max ?? null,
      metaStringRegex: s?.format ?? null,
      metaStringMinLength: s?.minLength ?? null,
      metaStringMaxLength: s?.maxLength ?? null,
      metaStringDisplayMethod: s?.displayMethod ?? null,
      needToTrim: s?.trim ?? true,
      metaOptionItems:
        a.fieldType === "option" ? a.enumValues.join("\n") : null,
      metaOptionIsMulti: a.fieldType === "option" ? a.multi : null,
      metaOptionMinCount: o?.minCount ?? null,
      metaOptionMaxCount: o?.maxCount ?? null,
      metaStringDefault: null,
      metaNumberDefault: null,
      metaBooleanDefault: null,
      metaOptionDefault: null,
    },
    unresolved: [
      "native IDs/key conflicts/effective category version need reviewed mapping; this object cannot be applied",
      "binding settings live on native PropertyInstance; different leaf settings may require separate effective instances/versions or backend changes",
    ],
  };
}
